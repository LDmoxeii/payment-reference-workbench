import { describe, expect, it } from "vitest";
import { BusinessError } from "../domain/errors";
import type {
  BackendId,
  BusinessCommand,
  ManualReviewItem,
  Operation,
  OperationReceipt,
  Payment,
  Settlement,
  TimelineEntry,
} from "../domain/models";
import { createMoney, type Money } from "../domain/money";
import { isRecord } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import { createPaymentBackendAdapter } from "./factory";

type ProcessEnv = { env?: Record<string, string | undefined> };
const environment = (globalThis as typeof globalThis & { process?: ProcessEnv }).process?.env ?? {};
const enabled = ["1", "true"].includes((environment.LIVE_PAIRED_CONSISTENCY ?? "").toLowerCase());
const wowBaseUrl = environment.LIVE_WOW_BASE_URL;
const cap4kBaseUrl = environment.LIVE_CAP4K_BASE_URL;

interface ScenarioConfig {
  backend: BackendId;
  apiBaseUrl: string;
  channelId: string;
  paymentMethod: string;
}

interface NormalizedSnapshot {
  configured: {
    clock: string | null;
    paymentExpiry: string | null;
    unknownResultReviewAfter: string | null;
  };
  unknown: {
    status: string;
    finality: string;
    money: Money;
    budget: NormalizedBudget | null;
    attemptStatus: string | null;
    result: string | null;
    attemptCount: number;
    submissionCount: number;
    resultIdentityCount: number;
    reviewCount: number;
    reviewStatus: string;
    reviewFinality: string;
    reviewBlocking: boolean;
    relatedResourceKinds: string[];
  };
  resolved: {
    paymentStatus: string;
    paymentFinality: string;
    money: Money;
    budget: NormalizedBudget | null;
    reviewStatus: string;
    reviewFinality: string;
    reviewBlocking: boolean;
    dispositionCount: number;
    dispositionOutcome: string | null;
    responsibilityRecorded: boolean;
    reason: string | null;
    evidenceCount: number;
  };
  replay: {
    create: boolean;
    attempt: boolean;
    submission: boolean;
    paymentCount: number;
    attemptCount: number;
    submissionCount: number;
    resultIdentityCount: number;
    reviewCount: number;
    dispositionCount: number;
  };
  conflict: {
    code: string;
    retryable: boolean;
    paymentCountAfterConflict: number;
  };
}

interface NormalizedBudget {
  original: Money;
  succeeded: Money;
  reserved: Money;
  available: Money;
}

interface SuccessfulClosureSnapshot {
  payment: {
    status: string;
    finality: string;
    money: Money;
    attemptCount: number;
    submissionCount: number;
    successReceiptCount: number;
    budget: NormalizedBudget | null;
  };
  refund: {
    status: string;
    finality: string;
    money: Money;
    belongsToPayment: boolean;
    attemptCount: number;
    submissionAccepted: boolean;
    successReceiptCount: number;
  };
  bill: {
    revision: string;
    revisionCount: number;
    records: Array<{ kind: string; money: Money; status: string; linkedTo: string }>;
  };
  reconciliation: {
    billLinked: boolean;
    revision: string;
    initialDifferenceTypes: string[];
    initiallyBlocked: boolean;
    channelOnlyResolved: boolean;
    dispositionCount: number;
    finallyBlocked: boolean;
    finality: string;
  };
  settlement: {
    merchantLinked: boolean;
    status: string;
    finality: string;
    gross: Money | null;
    refund: Money | null;
    fee: Money | null;
    net: Money | null;
    paymentAfterFeeImpact: Money;
    refundImpact: Money;
    itemsLinkedToRun: boolean;
    itemsLinkedToPaymentOrRefund: boolean;
    executionCount: number;
    executionMoney: Money | null;
    successReceiptCount: number;
  };
  lists: {
    payments: number;
    refunds: number;
    reconciliationRuns: number;
    settlements: number;
    openReviews: number;
    notifications: number;
    includesAllResources: boolean;
    runBillLinked: boolean;
  };
  timeline: {
    stableOrder: boolean;
    repeatableOrder: boolean;
    keyCategories: string[];
  };
  replay: {
    payment: boolean;
    refund: boolean;
    settlementExecution: boolean;
    paymentCount: number;
    refundCount: number;
    settlementCount: number;
    paymentAttemptCount: number;
    refundAttemptCount: number;
    settlementExecutionCount: number;
  };
}

describe.skipIf(!enabled || !wowBaseUrl || !cap4kBaseUrl)("paired real-backend normalized consistency smoke", () => {
  it("keeps an equivalent payment UNKNOWN/manual-review branch consistent across WOW and CAP4K", async () => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const scenarioInstant = "2051-05-06T00:00:00Z";
    const shared = {
      fixtureId: `paired-fixture-${unique}`,
      merchantId: `paired-merchant-${unique}`,
      merchantOrderId: `paired-order-${unique}`,
      scenarioInstant,
    };

    // Run sequentially: CAP4K's reference policy and logical clock are process-wide controls.
    const wow = await runUnknownReviewScenario({
      backend: "wow",
      apiBaseUrl: wowBaseUrl!,
      channelId: environment.LIVE_WOW_CHANNEL_ID ?? "fake",
      paymentMethod: environment.LIVE_WOW_PAYMENT_METHOD ?? "DEFAULT",
    }, shared);
    const cap4k = await runUnknownReviewScenario({
      backend: "cap4k",
      apiBaseUrl: cap4kBaseUrl!,
      channelId: environment.LIVE_CAP4K_CHANNEL_ID ?? "C-001",
      paymentMethod: environment.LIVE_CAP4K_PAYMENT_METHOD ?? "CARD",
    }, shared);

    expect(cap4k).toEqual(wow);
  }, 120_000);

  it("compares a complete successful payment-to-settlement closure on both real backends", async () => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const scenarioDay = new Date(Date.UTC(2040, 0, 1) + (Date.now() % 3650) * 86_400_000);
    const businessDate = scenarioDay.toISOString().slice(0, 10);
    const shared = {
      fixtureId: `paired-success-fixture-${unique}`,
      merchantId: `paired-success-merchant-${unique}`,
      merchantOrderId: `paired-success-order-${unique}`,
      businessDate,
      scenarioInstant: `${businessDate}T00:00:00Z`,
      periodStart: new Date(scenarioDay.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(scenarioDay.getTime() + 16 * 60 * 60 * 1000).toISOString(),
    };
    // Process-wide reference clocks and policies require sequential runs.
    const wow = await runSuccessfulClosureScenario({
      backend: "wow",
      apiBaseUrl: wowBaseUrl!,
      channelId: environment.LIVE_WOW_CHANNEL_ID ?? "fake",
      paymentMethod: environment.LIVE_WOW_PAYMENT_METHOD ?? "DEFAULT",
    }, shared);
    const cap4k = await runSuccessfulClosureScenario({
      backend: "cap4k",
      apiBaseUrl: cap4kBaseUrl!,
      channelId: environment.LIVE_CAP4K_CHANNEL_ID ?? "C-001",
      paymentMethod: environment.LIVE_CAP4K_PAYMENT_METHOD ?? "CARD",
    }, shared);

    expect(wow.payment).toMatchObject({
      status: "SUCCEEDED", finality: "FINAL", money: createMoney("CNY", "1000"),
      attemptCount: 1, submissionCount: 1, successReceiptCount: 1,
      budget: { original: createMoney("CNY", "1000"), succeeded: createMoney("CNY", "200"),
        reserved: createMoney("CNY", "0"), available: createMoney("CNY", "800") },
    });
    expect(wow.refund).toMatchObject({
      status: "SUCCEEDED", finality: "FINAL", money: createMoney("CNY", "200"),
      belongsToPayment: true, attemptCount: 1, submissionAccepted: true, successReceiptCount: 1,
    });
    expect(wow.bill).toMatchObject({ revision: "1", revisionCount: 1 });
    expect(wow.bill.records).toHaveLength(3);
    expect(wow.bill.records.map((record) => record.linkedTo).sort()).toEqual(["channel-only", "payment", "refund"]);
    expect(wow.reconciliation).toMatchObject({
      billLinked: true, revision: "1", initiallyBlocked: true, channelOnlyResolved: true,
      dispositionCount: 1, finallyBlocked: false, finality: "FINAL",
    });
    expect(wow.reconciliation.initialDifferenceTypes).toContain("CHANNEL_ONLY");
    expect(wow.settlement).toMatchObject({
      merchantLinked: true, status: "SETTLED", finality: "FINAL", net: createMoney("CNY", "794"),
      paymentAfterFeeImpact: createMoney("CNY", "994"), refundImpact: createMoney("CNY", "-200"),
      itemsLinkedToRun: true, itemsLinkedToPaymentOrRefund: true,
      executionCount: 1, successReceiptCount: 1,
    });
    expect(wow.lists).toMatchObject({
      payments: 1, refunds: 1, reconciliationRuns: 1, settlements: 1,
      openReviews: 0, includesAllResources: true, runBillLinked: true,
    });
    expect(wow.lists.notifications).toBeGreaterThan(0);
    expect(wow.timeline).toEqual({
      stableOrder: true, repeatableOrder: true,
      keyCategories: ["bill", "notification", "payment", "reconciliation", "refund", "settlement"],
    });
    expect(wow.replay).toMatchObject({
      payment: true, refund: true, settlementExecution: true,
      paymentCount: 1, refundCount: 1, settlementCount: 1,
      paymentAttemptCount: 1, refundAttemptCount: 1, settlementExecutionCount: 1,
    });
    expect(cap4k).toEqual(wow);
  }, 180_000);
});

async function runSuccessfulClosureScenario(
  config: ScenarioConfig,
  shared: {
    fixtureId: string;
    merchantId: string;
    merchantOrderId: string;
    businessDate: string;
    scenarioInstant: string;
    periodStart: string;
    periodEnd: string;
  },
): Promise<SuccessfulClosureSnapshot> {
  const { fixtureId, merchantId, merchantOrderId, businessDate, scenarioInstant, periodStart, periodEnd } = shared;
  const service = createPaymentBackendAdapter({
    backend: config.backend,
    apiBaseUrl: config.apiBaseUrl,
    fixtureId,
    actorAlias: "fixture-payment-reviewer",
    now: () => new Date(scenarioInstant),
  });
  const registered = await service.executeReference({
    type: "REGISTER_ENVIRONMENT",
    input: {
      fixtureId, merchantId, currentTime: scenarioInstant, policy: {},
      channelId: config.channelId, paymentMethod: config.paymentMethod,
      actorAlias: "fixture-payment-reviewer",
    },
  });
  if (registered.receipt) await waitForTerminal(service, registered.receipt);
  expect(registered.effect).toBe("applied");
  expect((await service.executeReference({
    type: "CONFIGURE_CHANNEL", input: { fixtureId, channelId: config.channelId, outcome: "NO_RESULT" },
  })).effect).toBe("applied");

  const money = createMoney("CNY", "1000");
  const refundMoney = createMoney("CNY", "200");
  const paymentCommand = {
    type: "CREATE_PAYMENT",
    input: {
      merchantId, merchantOrderId, idempotencyKey: `paired-success-payment-${merchantOrderId}`,
      money, paymentMethod: config.paymentMethod, fixtureId,
    },
  } satisfies BusinessCommand;
  const created = await service.execute(paymentCommand);
  await waitForTerminal(service, created);
  const paymentId = requiredResourceId(created, "success payment");
  const paymentReplay = await service.execute(paymentCommand);
  await waitForTerminal(service, paymentReplay);
  expect(paymentReplay.resource?.resourceId).toBe(paymentId);

  const attemptReceipt = await service.execute({
    type: "CREATE_PAYMENT_ATTEMPT",
    input: { resourceId: paymentId, idempotencyKey: `paired-success-attempt-${merchantOrderId}`,
      paymentMethod: config.paymentMethod, fixtureId },
  });
  await waitForTerminal(service, attemptReceipt);
  const withAttempt = await eventually(() => service.getPayment(paymentId), (payment) => payment.attempts.length === 1);
  const attemptId = withAttempt.attempts[0]!.attemptId;
  const submission = await service.execute({
    type: "SUBMIT_PAYMENT_ATTEMPT",
    input: { resourceId: paymentId, attemptId, idempotencyKey: `paired-success-submission-${merchantOrderId}`,
      submissionId: `paired-success-submission-${merchantOrderId}` },
  });
  await waitForTerminal(service, submission);
  const submittedPayment = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.attempts[0]?.submissions.length === 1,
  );
  const externalTransactionId = submittedPayment.attempts[0]?.externalTransactionId
    ?? `paired-success-external-${merchantOrderId}`;
  const paymentResult = await service.execute({
    type: "RECEIVE_PAYMENT_RESULT",
    input: { resourceType: "PAYMENT", resourceId: paymentId, attemptId, channelId: config.channelId,
      resultIdentity: `paired-success-result-${merchantOrderId}`, externalTransactionId,
      money, outcome: "SUCCESS", occurredAt: scenarioInstant, fixtureId },
  });
  await waitForTerminal(service, paymentResult);
  const succeeded = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.status === "SUCCEEDED" && payment.finality === "FINAL",
  );

  const refundCommand = {
    type: "REQUEST_REFUND",
    input: { merchantId, paymentId, merchantRefundId: `paired-success-refund-${merchantOrderId}`,
      idempotencyKey: `paired-success-refund-request-${merchantOrderId}`,
      money: refundMoney, reason: "paired successful partial refund", requestedAt: scenarioInstant, fixtureId },
  } satisfies BusinessCommand;
  const requested = await service.execute(refundCommand);
  await waitForTerminal(service, requested);
  const refundId = requiredResourceId(requested, "success refund");
  const refundReplay = await service.execute(refundCommand);
  await waitForTerminal(service, refundReplay);
  expect(refundReplay.resource?.resourceId).toBe(refundId);
  const refundAttemptReceipt = await service.execute({
    type: "CREATE_REFUND_ATTEMPT",
    input: { resourceId: refundId, idempotencyKey: `paired-success-refund-attempt-${merchantOrderId}`, fixtureId },
  });
  await waitForTerminal(service, refundAttemptReceipt);
  const refundAttempt = await eventually(() => service.getRefund(refundId), (refund) => refund.attempts.length === 1);
  const refundAttemptId = refundAttempt.attempts[0]!.attemptId;
  const refundSubmissionCommand = {
    type: "SUBMIT_REFUND_ATTEMPT",
    input: { resourceId: refundId, attemptId: refundAttemptId,
      idempotencyKey: `paired-success-refund-submission-${merchantOrderId}`,
      submissionId: `paired-success-refund-submission-${merchantOrderId}` },
  } satisfies BusinessCommand;
  const refundSubmission = await service.execute(refundSubmissionCommand);
  await waitForTerminal(service, refundSubmission);
  const refundSubmissionReplay = await service.execute(refundSubmissionCommand);
  await waitForTerminal(service, refundSubmissionReplay);
  expect(isReplay(refundSubmissionReplay)).toBe(true);
  const submittedRefund = await eventually(
    () => service.getRefund(refundId),
    (refund) => refund.attempts[0]?.status !== "CREATED",
  );
  const externalRefundId = submittedRefund.attempts[0]?.externalTransactionId
    ?? `paired-success-external-refund-${merchantOrderId}`;
  const refundResult = await service.execute({
    type: "RECEIVE_REFUND_RESULT",
    input: { resourceType: "REFUND", resourceId: refundId, attemptId: refundAttemptId, channelId: config.channelId,
      resultIdentity: `paired-success-refund-result-${merchantOrderId}`, externalTransactionId: externalRefundId,
      money: refundMoney, outcome: "SUCCESS", occurredAt: scenarioInstant, fixtureId },
  });
  await waitForTerminal(service, refundResult);
  const succeededRefund = await eventually(
    () => service.getRefund(refundId),
    (refund) => refund.status === "SUCCEEDED" && refund.finality === "FINAL",
  );
  const paymentAfterRefund = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.refundBudget?.succeededAmount.amountMinor === "200",
  );

  const billId = `paired-success-bill-${fixtureId.slice(-20)}`;
  const channelOnlyExternalId = `paired-success-channel-only-${merchantOrderId}`;
  const billRegistration = await service.executeReference({
    type: "REGISTER_BILL",
    input: {
      billId, revision: 1, channelId: config.channelId, merchantId, currency: "CNY",
      businessDate, businessTimezone: "Asia/Shanghai", idempotencyKey: `paired-success-bill-${merchantOrderId}`,
      fixtureId, unavailableReadCount: 0,
      records: [
        { recordId: `paired-success-bill-payment-${merchantOrderId}`, transactionKind: "PAYMENT",
          externalTransactionId: succeeded.externalTransactionId!, money, status: "SUCCEEDED", occurredAt: scenarioInstant },
        { recordId: `paired-success-bill-refund-${merchantOrderId}`, transactionKind: "REFUND",
          externalTransactionId: succeededRefund.externalTransactionId!, money: refundMoney,
          status: "SUCCEEDED", occurredAt: scenarioInstant },
        { recordId: `paired-success-bill-channel-only-${merchantOrderId}`, transactionKind: "PAYMENT",
          externalTransactionId: channelOnlyExternalId, money: createMoney("CNY", "100"),
          status: "SUCCEEDED", occurredAt: scenarioInstant },
      ],
    },
  });
  if (billRegistration.receipt) await waitForTerminal(service, billRegistration.receipt);
  const authoritativeBillId = isRecord(billRegistration.data) && typeof billRegistration.data.billId === "string"
    ? billRegistration.data.billId : billId;
  const bill = await eventually(
    () => service.getBill(authoritativeBillId),
    (value) => value.revisions?.some((revision) => String(revision.revision) === "1" && revision.records.length === 3) ?? false,
  );
  const billRevision = bill.revisions!.find((revision) => String(revision.revision) === "1")!;

  const runReceipt = await service.execute({
    type: "RUN_RECONCILIATION",
    input: { merchantId, billId, revision: 1, idempotencyKey: `paired-success-run-${merchantOrderId}`,
      channelId: config.channelId, currency: "CNY", businessDate, businessTimezone: "Asia/Shanghai",
      publishedAt: `${businessDate}T12:00:00Z` },
  });
  await waitForTerminal(service, runReceipt);
  const runId = requiredResourceId(runReceipt, "success reconciliation run");
  let run = await eventually(
    () => service.getReconciliationRun(runId),
    (value) => value.differences.some((difference) => difference.differenceType === "CHANNEL_ONLY"),
  );
  const initialRun = run;
  const channelOnly = run.differences.find((difference) => difference.differenceType === "CHANNEL_ONLY")!;
  expect(channelOnly.settlementBlocked).toBe(true);
  const disposition = await service.execute({
    type: "DISPOSE_RECONCILIATION_DIFFERENCE",
    input: { runId, differenceId: channelOnly.differenceId, revision: 1, merchantId,
      idempotencyKey: `paired-success-disposition-${merchantOrderId}`,
      actorAlias: "fixture-reconciliation-operator", actorId: "paired-reconciliation-operator",
      actorRole: "RECONCILIATION_REVIEWER", conclusion: "ACCEPT_DIFFERENCE", settlementImpact: "ALLOW",
      reason: "paired successful closure accepts evidenced unmatched channel record",
      evidenceRefs: [`reference://paired/${merchantOrderId}/channel-only`] },
  });
  await waitForTerminal(service, disposition);
  run = await eventually(
    () => service.getReconciliationRun(runId),
    (value) => value.differences.some((difference) => difference.differenceId === channelOnly.differenceId
      && difference.resolved && difference.dispositions.length === 1) && value.settlementBlocked === false,
  );
  if (run.actions.some((action) => action.kind === "COMPLETE_RECONCILIATION" && action.executable)) {
    const completed = await service.execute({
      type: "COMPLETE_RECONCILIATION",
      input: { runId, merchantId, idempotencyKey: `paired-success-complete-${merchantOrderId}`,
        actorAlias: "fixture-reconciliation-operator", actorId: "paired-reconciliation-operator",
        actorRole: "RECONCILIATION_OPERATOR", reason: "paired successful closure completes reconciliation",
        evidenceRefs: [`reference://paired/${merchantOrderId}/reconciliation-complete`] },
    });
    await waitForTerminal(service, completed);
    run = await eventually(() => service.getReconciliationRun(runId), (value) => value.finality === "FINAL");
  }
  const disposed = run.differences.find((difference) => difference.differenceId === channelOnly.differenceId)!;
  expect(run.settlementBlocked).toBe(false);
  expect(run.finality).toBe("FINAL");

  const prepared = await service.execute({
    type: "PREPARE_SETTLEMENT",
    input: { merchantId, currency: "CNY", channelId: config.channelId, periodStart, periodEnd,
      businessTimezone: "Asia/Shanghai", idempotencyKey: `paired-success-settlement-${merchantOrderId}`, fixtureId },
  });
  await waitForTerminal(service, prepared);
  const settlementId = requiredResourceId(prepared, "success settlement");
  const ready = await eventually(
    () => service.getSettlement(settlementId),
    (value) => value.status === "READY_FOR_CONFIRMATION",
  );
  expect(ready.netAmount?.amountMinor).toBe("794");
  const confirmed = await service.execute({
    type: "CONFIRM_SETTLEMENT",
    input: { settlementId, merchantId, idempotencyKey: `paired-success-confirm-${merchantOrderId}`,
      actorAlias: "fixture-settlement-operator", actorId: "paired-settlement-operator",
      actorRole: "SETTLEMENT_OPERATOR", reason: "paired successful closure confirms settlement",
      evidenceRefs: [`reference://paired/${merchantOrderId}/settlement-confirm`] },
  });
  await waitForTerminal(service, confirmed);
  const executionId = `paired-success-execution-${merchantOrderId}`;
  expect((await service.executeReference({
    type: "CONFIGURE_SETTLEMENT_EXECUTOR",
    input: { fixtureId, channelId: config.channelId, executionId, outcome: "NO_RESULT" },
  })).effect).toBe("applied");
  const executionCommand = {
    type: "EXECUTE_SETTLEMENT",
    input: { settlementId, merchantId, executionId, channelId: config.channelId,
      idempotencyKey: `paired-success-execute-${merchantOrderId}` },
  } satisfies BusinessCommand;
  const executed = await service.execute(executionCommand);
  await waitForTerminal(service, executed);
  const executionReplay = await service.execute(executionCommand);
  await waitForTerminal(service, executionReplay);
  const executing = await eventually(() => service.getSettlement(settlementId), (value) => value.executions.length === 1);
  const execution = executing.executions[0]!;
  const settlementResult = await service.execute({
    type: "RECEIVE_SETTLEMENT_RESULT",
    input: { resourceType: "SETTLEMENT", resourceId: settlementId, attemptId: execution.executionId,
      channelId: executing.channelId ?? config.channelId,
      resultIdentity: `paired-success-settlement-result-${merchantOrderId}`,
      externalTransactionId: execution.externalSettlementId ?? `paired-success-external-settlement-${merchantOrderId}`,
      money: executing.netAmount!, outcome: "SUCCESS", occurredAt: scenarioInstant, fixtureId,
      executionGroupIdentity: execution.executionGroupIdentity ?? `paired-success-group-${merchantOrderId}`,
      requestIdentity: execution.requestIdentity ?? `paired-success-request-${merchantOrderId}` },
  });
  await waitForTerminal(service, settlementResult);
  const settled = await eventually(() => service.getSettlement(settlementId), (value) => value.status === "SETTLED");
  const finalPayment = await service.getPayment(paymentId);
  const finalRefund = await service.getRefund(refundId);
  const [payments, refunds, runs, settlements, reviews, notifications, timeline] = await Promise.all([
    service.listPayments({ filters: { merchantId, merchantOrderId }, pageSize: 50 }),
    service.listRefunds({ filters: { merchantId, paymentId }, pageSize: 50 }),
    service.listReconciliationRuns({ filters: { merchantId, resourceId: runId }, pageSize: 50 }),
    service.listSettlements({ filters: { merchantId }, pageSize: 50 }),
    service.listManualReviews({ filters: { merchantId }, pageSize: 50 }),
    service.listNotifications({ filters: { merchantId, paymentId }, pageSize: 50 }),
    service.getPaymentTimeline(paymentId),
  ]);
  const repeatedTimeline = await service.getPaymentTimeline(paymentId);
  const scenarioPayments = payments.items.filter((item) => item.paymentId === paymentId);
  const scenarioRefunds = refunds.items.filter((item) => item.refundId === refundId);
  const scenarioRuns = runs.items.filter((item) => item.runId === runId);
  const scenarioSettlements = settlements.items.filter((item) => item.settlementId === settlementId);
  expect(payments.nextCursor).toBeFalsy();
  expect(refunds.nextCursor).toBeFalsy();
  expect(runs.nextCursor).toBeFalsy();
  expect(settlements.nextCursor).toBeFalsy();
  const notification = notifications.items[0] && await service.getNotification(notifications.items[0].notificationId);
  expect(notification?.notificationId).toBe(notifications.items[0]?.notificationId);

  return {
    payment: {
      status: finalPayment.status, finality: finalPayment.finality, money: finalPayment.money,
      attemptCount: finalPayment.attempts.length, submissionCount: finalPayment.attempts[0]?.submissions.length ?? 0,
      successReceiptCount: finalPayment.attempts.flatMap((attempt) => attempt.receipts)
        .filter((receipt) => receipt.outcome === "SUCCESS").length,
      budget: normalizeBudget(finalPayment),
    },
    refund: {
      status: finalRefund.status, finality: finalRefund.finality, money: finalRefund.money,
      belongsToPayment: finalRefund.paymentId === paymentId,
      attemptCount: finalRefund.attempts.length, submissionAccepted: isReplay(refundSubmissionReplay),
      successReceiptCount: finalRefund.attempts.flatMap((attempt) => attempt.receipts)
        .filter((receipt) => receipt.outcome === "SUCCESS").length,
    },
    bill: {
      revision: String(bill.currentRevision), revisionCount: bill.revisions?.length ?? 0,
      records: billRevision.records.map((record) => ({
        kind: record.transactionKind, money: record.money, status: record.status,
        linkedTo: record.externalTransactionId === succeeded.externalTransactionId ? "payment"
          : record.externalTransactionId === succeededRefund.externalTransactionId ? "refund"
            : record.externalTransactionId === channelOnlyExternalId ? "channel-only" : "unlinked",
      })).sort((a, b) => a.linkedTo.localeCompare(b.linkedTo)),
    },
    reconciliation: {
      billLinked: run.billId === billId, revision: String(run.billRevision),
      initialDifferenceTypes: initialRun.differences.map((difference) => difference.differenceType).sort(),
      initiallyBlocked: initialRun.settlementBlocked === true,
      channelOnlyResolved: disposed.resolved, dispositionCount: disposed.dispositions.length,
      finallyBlocked: run.settlementBlocked === true, finality: run.finality,
    },
    settlement: normalizeSuccessfulSettlement(settled, merchantId, paymentId, refundId, runId),
    lists: {
      payments: scenarioPayments.length, refunds: scenarioRefunds.length,
      reconciliationRuns: scenarioRuns.length, settlements: scenarioSettlements.length,
      openReviews: reviews.items.filter((item) => item.status === "OPEN").length,
      notifications: notifications.items.length,
      includesAllResources: scenarioPayments.length === 1 && scenarioRefunds.length === 1
        && scenarioRuns.length === 1 && scenarioSettlements.length === 1
        && reviews.items.every((item) => item.status !== "OPEN")
        && notifications.items.every((item) => item.merchantId === merchantId),
      runBillLinked: scenarioRuns[0]?.billId === billId,
    },
    timeline: normalizeTimeline(timeline.entries, repeatedTimeline.entries),
    replay: {
      payment: isReplay(paymentReplay), refund: isReplay(refundReplay), settlementExecution: isReplay(executionReplay),
      paymentCount: scenarioPayments.length, refundCount: scenarioRefunds.length,
      settlementCount: scenarioSettlements.length, paymentAttemptCount: finalPayment.attempts.length,
      refundAttemptCount: finalRefund.attempts.length, settlementExecutionCount: settled.executions.length,
    },
  };
}

function normalizeSuccessfulSettlement(
  settlement: Settlement, merchantId: string, paymentId: string, refundId: string, runId: string,
): SuccessfulClosureSnapshot["settlement"] {
  const paymentAndFee = settlement.items.filter((item) => item.sourceKind === "PAYMENT" || item.sourceKind === "FEE");
  const refunds = settlement.items.filter((item) => item.sourceKind === "REFUND");
  return {
    merchantLinked: settlement.merchantId === merchantId, status: settlement.status, finality: settlement.finality,
    gross: settlement.grossAmount ?? null, refund: settlement.refundAmount ?? null,
    fee: settlement.feeAmount ?? null, net: settlement.netAmount ?? null,
    paymentAfterFeeImpact: sumMoney(paymentAndFee.map((item) => item.amountImpact)),
    refundImpact: sumMoney(refunds.map((item) => item.amountImpact)),
    itemsLinkedToRun: settlement.items.length > 0
      && settlement.items.every((item) => item.reconciliationRunId === runId),
    itemsLinkedToPaymentOrRefund: settlement.items.length > 0
      && settlement.items.every((item) => item.sourceKind === "REFUND"
        ? item.refundId === refundId : item.paymentId === paymentId),
    executionCount: settlement.executions.length, executionMoney: settlement.executions[0]?.money ?? null,
    successReceiptCount: settlement.executions.flatMap((execution) => execution.receipts)
      .filter((receipt) => receipt.outcome === "SUCCESS").length,
  };
}

function sumMoney(values: Money[]): Money {
  return createMoney("CNY", values.reduce((sum, value) => {
    expect(value.currency).toBe("CNY");
    return sum + BigInt(value.amountMinor);
  }, 0n).toString());
}

function normalizeTimeline(entries: TimelineEntry[], repeated: TimelineEntry[]): SuccessfulClosureSnapshot["timeline"] {
  const ordered = [...entries].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId));
  const categories = entries.map((entry) => entry.category.toUpperCase());
  const keyCategories = new Set<string>();
  for (const category of categories) {
    if (category.includes("PAYMENT")) keyCategories.add("payment");
    if (category.includes("REFUND")) keyCategories.add("refund");
    if (category.includes("BILL") || category.includes("AUTHORITATIVE")) keyCategories.add("bill");
    if (category.includes("RECONCILIATION")) keyCategories.add("reconciliation");
    if (category.includes("SETTLEMENT")) keyCategories.add("settlement");
    if (category.includes("NOTIFICATION") || category === "MERCHANT") keyCategories.add("notification");
  }
  return {
    stableOrder: entries.every((entry, index) => entry.eventId === ordered[index]?.eventId),
    repeatableOrder: entries.length === repeated.length
      && entries.every((entry, index) => entry.eventId === repeated[index]?.eventId),
    keyCategories: [...keyCategories].sort(),
  };
}

async function runUnknownReviewScenario(
  config: ScenarioConfig,
  shared: { fixtureId: string; merchantId: string; merchantOrderId: string; scenarioInstant: string },
): Promise<NormalizedSnapshot> {
  const service = createPaymentBackendAdapter({
    backend: config.backend,
    apiBaseUrl: config.apiBaseUrl,
    fixtureId: shared.fixtureId,
    actorAlias: "fixture-payment-reviewer",
    now: () => new Date(shared.scenarioInstant),
  });
  const policy = { paymentExpiry: "PT5M", unknownResultReviewAfter: "PT1M" };
  const registered = await service.executeReference({
    type: "REGISTER_ENVIRONMENT",
    input: {
      fixtureId: shared.fixtureId,
      actorAlias: "fixture-payment-reviewer",
      currentTime: shared.scenarioInstant,
      policy,
      channelId: config.channelId,
      merchantId: shared.merchantId,
      paymentMethod: config.paymentMethod,
    },
  });
  if (registered.receipt) await waitForTerminal(service, registered.receipt);
  expect(registered.effect).toBe("applied");
  const configured = await service.getReferenceEnvironment(shared.fixtureId);

  const money = createMoney("CNY", "1000");
  const createCommand = {
    type: "CREATE_PAYMENT",
    input: {
      merchantId: shared.merchantId,
      merchantOrderId: shared.merchantOrderId,
      idempotencyKey: `paired-payment-${shared.merchantOrderId}`,
      money,
      paymentMethod: config.paymentMethod,
      fixtureId: shared.fixtureId,
    },
  } satisfies BusinessCommand;
  const created = await service.execute(createCommand);
  await waitForTerminal(service, created);
  const paymentId = requiredResourceId(created, "payment create");
  const createReplay = await service.execute(createCommand);
  await waitForTerminal(service, createReplay);
  expect(createReplay.resource?.resourceId).toBe(paymentId);

  const conflict = await captureBusinessError(() => service.execute({
    ...createCommand,
    input: { ...createCommand.input, money: createMoney("CNY", "1001") },
  }));
  expect(conflict.code).toBe("IDEMPOTENCY_CONFLICT");
  expect(conflict.retryable).toBe(false);

  const attemptCommand = {
    type: "CREATE_PAYMENT_ATTEMPT",
    input: {
      resourceId: paymentId,
      idempotencyKey: `paired-attempt-${shared.merchantOrderId}`,
      paymentMethod: config.paymentMethod,
      riskReason: "paired smoke verifies an idempotent attempt replay",
      fixtureId: shared.fixtureId,
    },
  } satisfies BusinessCommand;
  const attemptReceipt = await service.execute(attemptCommand);
  await waitForTerminal(service, attemptReceipt);
  const afterAttempt = await eventually(() => service.getPayment(paymentId), (payment) => payment.attempts.length === 1);
  const attemptId = afterAttempt.attempts[0]!.attemptId;
  const attemptReplay = await service.execute(attemptCommand);
  await waitForTerminal(service, attemptReplay);
  const afterAttemptReplay = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.attempts.length === 1 && payment.attempts[0]?.attemptId === attemptId,
  );

  const submissionCommand = {
    type: "SUBMIT_PAYMENT_ATTEMPT",
    input: {
      resourceId: paymentId,
      attemptId,
      idempotencyKey: `paired-submission-${shared.merchantOrderId}`,
      submissionId: `paired-submission-${shared.merchantOrderId}`,
    },
  } satisfies BusinessCommand;
  const submitted = await service.execute(submissionCommand);
  await waitForTerminal(service, submitted);
  const afterSubmit = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.attempts[0]?.submissions.length === 1,
  );
  const submissionReplay = await service.execute(submissionCommand);
  await waitForTerminal(service, submissionReplay);
  const afterSubmissionReplay = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.attempts[0]?.submissions.length === 1,
  );
  const externalTransactionId = afterSubmit.attempts[0]?.externalTransactionId ?? `paired-transaction-${shared.merchantOrderId}`;

  const resultIdentity = `paired-result-${shared.merchantOrderId}`;
  const resultCommand = {
    type: "RECEIVE_PAYMENT_RESULT",
    input: {
      resourceType: "PAYMENT",
      resourceId: paymentId,
      attemptId,
      channelId: config.channelId,
      resultIdentity,
      externalTransactionId,
      money,
      outcome: "UNKNOWN",
      occurredAt: shared.scenarioInstant,
      fixtureId: shared.fixtureId,
    },
  } satisfies BusinessCommand;
  const result = await service.execute(resultCommand);
  await waitForTerminal(service, result);
  await eventually(() => service.getPayment(paymentId), (payment) => payment.status === "RESULT_UNKNOWN");
  const resultReplay = await service.execute(resultCommand);
  await waitForTerminal(service, resultReplay);
  const afterResultReplay = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.status === "RESULT_UNKNOWN" && countResultIdentity(payment, resultIdentity) === 1,
  );

  await service.executeReference({ type: "ADVANCE_CLOCK", input: { fixtureId: shared.fixtureId, duration: "PT2H" } });
  await service.executeReference({ type: "RUN_MAINTENANCE", input: { fixtureId: shared.fixtureId } });
  const review = await eventually(
    async () => findPaymentReview(service, shared.merchantId, paymentId),
    (value) => value !== undefined && value.status === "OPEN",
  );
  const unknownPayment = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.status === "RESULT_UNKNOWN" && payment.reviewIds.length === 1,
  );
  expect(review).toBeDefined();
  const openReview = review!;

  const resolutionReason = "paired smoke confirms the UNKNOWN payment did not complete";
  const resolutionEvidence = `reference://paired/${shared.merchantOrderId}/unknown-result`;
  const resolutionCommand = {
    type: "RESOLVE_MANUAL_REVIEW",
    input: {
      reviewId: openReview.reviewId,
      reviewType: openReview.type,
      merchantId: shared.merchantId,
      outcome: "CONFIRM_FAILURE",
      actorAlias: "fixture-payment-reviewer",
      actorId: "paired-payment-reviewer",
      actorRole: "PAYMENT_REVIEWER",
      reason: resolutionReason,
      evidenceRefs: [resolutionEvidence],
      idempotencyKey: `paired-review-resolution-${shared.merchantOrderId}`,
    },
  } satisfies BusinessCommand;
  const resolution = await service.execute(resolutionCommand);
  await waitForTerminal(service, resolution);
  const resolvedReview = await eventually(
    () => service.getManualReview(openReview.reviewId),
    (value) => value.status !== "OPEN" && value.dispositions.length === 1,
  );
  const resolvedPayment = await eventually(
    () => service.getPayment(paymentId),
    (payment) => payment.status === "FAILED" && payment.finality === "FINAL",
  );
  const payments = await service.listPayments({
    filters: { merchantId: shared.merchantId, merchantOrderId: shared.merchantOrderId },
    pageSize: 20,
  });
  const reviews = await eventually(
    () => service.listManualReviews({ filters: { merchantId: shared.merchantId }, pageSize: 20 }),
    (page) => page.items.some((item) => item.reviewId === openReview.reviewId),
  );
  const scenarioPayments = payments.items.filter((payment) => payment.paymentId === paymentId);
  const scenarioReviews = reviews.items.filter((item) => item.reviewId === openReview.reviewId);
  const disposition = resolvedReview.dispositions.at(-1);

  expect(scenarioPayments).toHaveLength(1);
  expect(scenarioReviews).toHaveLength(1);
  expect(afterAttemptReplay.attempts).toHaveLength(1);
  expect(afterSubmissionReplay.attempts[0]?.submissions).toHaveLength(1);
  expect(countResultIdentity(afterResultReplay, resultIdentity)).toBe(1);
  expect(resolvedReview.dispositions).toHaveLength(1);

  return {
    configured: {
      clock: configured.currentTime ?? null,
      paymentExpiry: configured.policy?.paymentExpiry ?? null,
      unknownResultReviewAfter: configured.policy?.unknownResultReviewAfter ?? null,
    },
    unknown: {
      status: unknownPayment.status,
      finality: unknownPayment.finality,
      money: unknownPayment.money,
      budget: normalizeBudget(unknownPayment),
      attemptStatus: unknownPayment.attempts[0]?.status ?? null,
      result: unknownPayment.attempts[0]?.finalResult ?? null,
      attemptCount: unknownPayment.attempts.length,
      submissionCount: unknownPayment.attempts[0]?.submissions.length ?? 0,
      resultIdentityCount: countResultIdentity(unknownPayment, resultIdentity),
      reviewCount: unknownPayment.reviewIds.length,
      reviewStatus: openReview.status,
      reviewFinality: openReview.finality,
      reviewBlocking: openReview.blockingScopes.length > 0,
      relatedResourceKinds: [...new Set(openReview.relatedResources.map((ref) => normalizeResourceKind(ref.resourceType)))].sort(),
    },
    resolved: {
      paymentStatus: resolvedPayment.status,
      paymentFinality: resolvedPayment.finality,
      money: resolvedPayment.money,
      budget: normalizeBudget(resolvedPayment),
      reviewStatus: resolvedReview.status,
      reviewFinality: resolvedReview.finality,
      reviewBlocking: resolvedReview.status === "OPEN" && resolvedReview.blockingScopes.length > 0,
      dispositionCount: resolvedReview.dispositions.length,
      dispositionOutcome: disposition?.outcome ?? null,
      responsibilityRecorded: Boolean(disposition?.actorId),
      reason: disposition?.reason ?? null,
      evidenceCount: disposition?.evidenceRefs.length ?? 0,
    },
    replay: {
      create: isReplay(createReplay),
      attempt: isReplay(attemptReplay),
      submission: isReplay(submissionReplay),
      paymentCount: scenarioPayments.length,
      attemptCount: resolvedPayment.attempts.length,
      submissionCount: resolvedPayment.attempts[0]?.submissions.length ?? 0,
      resultIdentityCount: countResultIdentity(resolvedPayment, resultIdentity),
      reviewCount: scenarioReviews.length,
      dispositionCount: resolvedReview.dispositions.length,
    },
    conflict: {
      code: conflict.code,
      retryable: conflict.retryable,
      paymentCountAfterConflict: scenarioPayments.length,
    },
  };
}

async function findPaymentReview(
  service: PaymentBackendAdapter,
  merchantId: string,
  paymentId: string,
): Promise<ManualReviewItem | undefined> {
  const [payment, page] = await Promise.all([
    service.getPayment(paymentId),
    service.listManualReviews({ filters: { merchantId }, pageSize: 50 }),
  ]);
  const summary = page.items.find((item) => payment.reviewIds.includes(item.reviewId)
    || item.relatedResources.some((reference) => reference.resourceId === paymentId));
  if (summary) return service.getManualReview(summary.reviewId);
  for (const item of page.items) {
    const detail = await service.getManualReview(item.reviewId);
    if (detail.relatedResources.some((reference) => reference.resourceId === paymentId)) return detail;
  }
  return undefined;
}

async function waitForTerminal(service: PaymentBackendAdapter, receipt: OperationReceipt): Promise<Operation> {
  const operation = await eventually(
    () => service.getOperation(receipt.operationId),
    (value) => value.status === "SUCCEEDED" || value.status === "FAILED" || value.status === "REVIEW_REQUIRED",
  );
  expect(operation.status, JSON.stringify(operation.error)).not.toBe("FAILED");
  return operation;
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Paired live observation did not converge: ${JSON.stringify(last)}; error=${String(lastError)}`);
}

async function captureBusinessError(run: () => Promise<unknown>): Promise<BusinessError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BusinessError) return error;
    throw error;
  }
  throw new Error("Expected a BusinessError, but the command was accepted.");
}

function requiredResourceId(receipt: OperationReceipt, context: string): string {
  const id = receipt.resource?.resourceId;
  if (!id) throw new Error(`${context} receipt did not identify its resource.`);
  return id;
}

function isReplay(receipt: OperationReceipt): boolean {
  return receipt.idempotentReplay || receipt.acceptanceStatus === "ALREADY_ACCEPTED";
}

function countResultIdentity(payment: Payment, resultIdentity: string): number {
  return payment.attempts.flatMap((attempt) => attempt.receipts)
    .filter((receipt) => receipt.resultIdentity === resultIdentity).length;
}

function normalizeBudget(payment: Payment): NormalizedBudget | null {
  return payment.refundBudget ? {
    original: payment.refundBudget.originalAmount,
    succeeded: payment.refundBudget.succeededAmount,
    reserved: payment.refundBudget.reservedAmount,
    available: payment.refundBudget.availableAmount,
  } : null;
}

function normalizeResourceKind(value: string): string {
  const normalized = value.replace(/[^a-z]/gi, "").toLowerCase();
  if (normalized.includes("paymentattempt")) return "paymentAttempt";
  if (normalized.includes("payment")) return "payment";
  if (normalized.includes("review")) return "manualReview";
  return normalized;
}
