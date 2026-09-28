import { describe, expect, it } from "vitest";
import type { BackendId, Operation, OperationReceipt } from "../domain/models";
import { createMoney } from "../domain/money";
import { isRecord } from "../http/client";
import { createPaymentBackendAdapter } from "./factory";

type ProcessEnv = { env?: Record<string, string | undefined> };
const environment = (globalThis as typeof globalThis & { process?: ProcessEnv }).process?.env ?? {};
const backend = environment.LIVE_PAYMENT_BACKEND as BackendId | undefined;

describe.skipIf(backend !== "wow" && backend !== "cap4k")("live payment adapter smoke", () => {
  it("crosses the real HTTP boundary from payment intent to timeline", async () => {
    const selected = backend as BackendId;
    const apiBaseUrl = environment.LIVE_PAYMENT_BASE_URL ?? "http://127.0.0.1:8080/api";
    const unique = `${Date.now()}`;
    const scenarioDay = new Date(Date.UTC(2040, 0, 1) + (Number(unique) % 3650) * 86_400_000);
    const businessDate = scenarioDay.toISOString().slice(0, 10);
    const scenarioInstant = `${businessDate}T00:00:00Z`;
    const periodStart = new Date(scenarioDay.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date(scenarioDay.getTime() + 16 * 60 * 60 * 1000).toISOString();
    const fixtureId = `workbench-live-${unique}`;
    const channelId = environment.LIVE_PAYMENT_CHANNEL_ID ?? (selected === "wow" ? "fake" : "C-001");
    const merchantId = `workbench-merchant-${unique}`;
    const paymentMethod = selected === "wow" ? "DEFAULT" : "CARD";
    const service = createPaymentBackendAdapter({ backend: selected, apiBaseUrl, fixtureId });

    const environmentResult = await service.executeReference({
      type: "REGISTER_ENVIRONMENT",
      input: {
        fixtureId,
        actorAlias: "fixture-payment-reviewer",
        currentTime: scenarioInstant,
        policy: {},
        channelId,
        merchantId,
        paymentMethod,
      },
    });
    if (environmentResult.receipt) await waitForTerminal(service.getOperation.bind(service), environmentResult.receipt);

    const channelScript = await service.executeReference({
      type: "CONFIGURE_CHANNEL",
      input: { fixtureId, channelId, outcome: "NO_RESULT" },
    });
    expect(channelScript.effect).toBe("applied");

    const money = createMoney("CNY", "1000");
    const created = await service.execute({
      type: "CREATE_PAYMENT",
      input: {
        merchantId,
        merchantOrderId: `order-${unique}`,
        idempotencyKey: `payment-${unique}`,
        money,
        paymentMethod,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), created);
    const paymentId = created.resource?.resourceId;
    expect(paymentId).toBeTruthy();

    const attemptReceipt = await service.execute({
      type: "CREATE_PAYMENT_ATTEMPT",
      input: { resourceId: paymentId!, idempotencyKey: `attempt-${unique}`, paymentMethod, fixtureId },
    });
    await waitForTerminal(service.getOperation.bind(service), attemptReceipt);
    const withAttempt = await eventually(() => service.getPayment(paymentId!), (payment) => payment.attempts.length > 0);
    const attemptId = withAttempt.attempts.at(-1)?.attemptId;
    expect(attemptId).toBeTruthy();

    const submission = await service.execute({
      type: "SUBMIT_PAYMENT_ATTEMPT",
      input: { resourceId: paymentId!, attemptId: attemptId!, idempotencyKey: `submission-${unique}`, submissionId: `submission-${unique}` },
    });
    await waitForTerminal(service.getOperation.bind(service), submission);
    const submittedPayment = await eventually(
      () => service.getPayment(paymentId!),
      (payment) => payment.attempts.some((attempt) => attempt.attemptId === attemptId && attempt.submissions.length > 0),
    );
    const externalTransactionId = submittedPayment.attempts.find((attempt) => attempt.attemptId === attemptId)?.externalTransactionId
      ?? `transaction-${unique}`;

    const result = await service.execute({
      type: "RECEIVE_PAYMENT_RESULT",
      input: {
        resourceType: "PAYMENT",
        resourceId: paymentId!,
        attemptId: attemptId!,
        channelId,
        resultIdentity: `result-${unique}`,
        externalTransactionId: externalTransactionId!,
        money,
        outcome: "SUCCESS",
        occurredAt: scenarioInstant,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), result);
    const succeeded = await eventually(() => service.getPayment(paymentId!), (payment) => payment.status === "SUCCEEDED");
    expect(succeeded.finality).toBe("FINAL");

    const page = await service.listPayments({ filters: { resourceId: paymentId }, pageSize: 2 });
    expect(page.items.map((item) => item.paymentId)).toContain(paymentId);

    const refundMoney = createMoney("CNY", "200");
    const refundReceipt = await service.execute({
      type: "REQUEST_REFUND",
      input: {
        merchantId,
        paymentId: paymentId!,
        merchantRefundId: `merchant-refund-${unique}`,
        idempotencyKey: `refund-${unique}`,
        money: refundMoney,
        reason: "live adapter smoke partial refund",
        requestedAt: scenarioInstant,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), refundReceipt);
    const refundId = refundReceipt.resource?.resourceId;
    expect(refundId).toBeTruthy();
    await eventually(() => service.getRefund(refundId!), () => true);

    const refundAttemptReceipt = await service.execute({
      type: "CREATE_REFUND_ATTEMPT",
      input: { resourceId: refundId!, idempotencyKey: `refund-attempt-${unique}`, fixtureId },
    });
    await waitForTerminal(service.getOperation.bind(service), refundAttemptReceipt);
    const refundWithAttempt = await eventually(() => service.getRefund(refundId!), (refund) => refund.attempts.length > 0);
    const refundAttemptId = refundWithAttempt.attempts.at(-1)?.attemptId;
    expect(refundAttemptId).toBeTruthy();

    const refundSubmission = await service.execute({
      type: "SUBMIT_REFUND_ATTEMPT",
      input: { resourceId: refundId!, attemptId: refundAttemptId!, idempotencyKey: `refund-submission-${unique}`, submissionId: `refund-submission-${unique}` },
    });
    await waitForTerminal(service.getOperation.bind(service), refundSubmission);
    const submittedRefund = await eventually(
      () => service.getRefund(refundId!),
      (refund) => refund.attempts.some((attempt) => attempt.attemptId === refundAttemptId && attempt.status !== "CREATED"),
    );
    const externalRefundId = submittedRefund.attempts.find((attempt) => attempt.attemptId === refundAttemptId)?.externalTransactionId
      ?? `external-refund-${unique}`;

    const refundResult = await service.execute({
      type: "RECEIVE_REFUND_RESULT",
      input: {
        resourceType: "REFUND",
        resourceId: refundId!,
        attemptId: refundAttemptId!,
        channelId,
        resultIdentity: `refund-result-${unique}`,
        externalTransactionId: externalRefundId!,
        money: refundMoney,
        outcome: "SUCCESS",
        occurredAt: scenarioInstant,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), refundResult);
    const succeededRefund = await eventually(() => service.getRefund(refundId!), (refund) => refund.status === "SUCCEEDED");
    expect(succeededRefund.finality).toBe("FINAL");
    const refundPage = await service.listRefunds({ filters: { resourceId: refundId }, pageSize: 2 });
    expect(refundPage.items.map((item) => item.refundId)).toContain(refundId);
    const paymentAfterRefund = await service.getPayment(paymentId!);
    expect(paymentAfterRefund.refundBudget?.succeededAmount.amountMinor).toBe("200");
    expect(paymentAfterRefund.refundBudget?.reservedAmount.amountMinor).toBe("0");
    expect(paymentAfterRefund.refundBudget?.availableAmount.amountMinor).toBe("800");

    const billId = `bill-${unique}`;
    const billResult = await service.executeReference({
      type: "REGISTER_BILL",
      input: {
        billId,
        revision: 1,
        channelId,
        merchantId,
        currency: "CNY",
        businessDate,
        businessTimezone: "Asia/Shanghai",
        idempotencyKey: `bill-${unique}`,
        fixtureId,
        unavailableReadCount: 0,
        records: [
          {
            recordId: `bill-payment-${unique}`,
            transactionKind: "PAYMENT",
            externalTransactionId: succeeded.externalTransactionId!,
            money,
            status: "SUCCEEDED",
            occurredAt: scenarioInstant,
          },
          {
            recordId: `bill-refund-${unique}`,
            transactionKind: "REFUND",
            externalTransactionId: succeededRefund.externalTransactionId!,
            money: refundMoney,
            status: "SUCCEEDED",
            occurredAt: scenarioInstant,
          },
          {
            recordId: `bill-channel-only-${unique}`,
            transactionKind: "PAYMENT",
            externalTransactionId: `channel-only-${unique}`,
            money: createMoney("CNY", "100"),
            status: "SUCCEEDED",
            occurredAt: scenarioInstant,
          },
        ],
      },
    });
    if (billResult.receipt) await waitForTerminal(service.getOperation.bind(service), billResult.receipt);
    const registeredBill = billResult.data;
    const authoritativeBillId = isRecord(registeredBill) && typeof registeredBill.billId === "string"
      ? registeredBill.billId
      : billId;
    const authoritativeBill = await eventually(
      () => service.getBill(authoritativeBillId),
      (value) => value.revisions?.some((revision) => String(revision.revision) === "1" && revision.records.length === 3) ?? false,
    );
    expect(String(authoritativeBill.currentRevision)).toBe("1");
    const currentRevision = authoritativeBill.revisions?.find((revision) => String(revision.revision) === "1");
    const expectedBillRecordIdentities = [
      `bill-payment-${unique}`, `bill-refund-${unique}`, `bill-channel-only-${unique}`,
    ];
    expect(currentRevision?.records
      .map((record) => selected === "cap4k" ? record.recordIdentity : record.recordId)
      .sort()).toEqual([...expectedBillRecordIdentities].sort());
    const paymentBillRecord = currentRevision?.records.find(
      (record) => (record.recordIdentity ?? record.recordId) === `bill-payment-${unique}`,
    );
    expect(paymentBillRecord).toMatchObject({
      money, rawStatus: "SUCCEEDED", occurredAt: scenarioInstant,
    });
    if (selected === "cap4k") {
      expect(authoritativeBill.currentRevisionId).toBeTruthy();
      expect(currentRevision).toMatchObject({
        completeness: "COMPLETE",
        payloadFingerprint: `${billId}:1`,
        rawEvidence: `reference://workbench/bills/${billId}/revisions/1`,
      });
      expect(paymentBillRecord).toMatchObject({
        recordIdentity: `bill-payment-${unique}`,
        rawEvidence: `reference://workbench/bills/${billId}/records/bill-payment-${unique}`,
      });
    }

    const runReceipt = await service.execute({
      type: "RUN_RECONCILIATION",
      input: {
        merchantId,
        billId,
        revision: 1,
        idempotencyKey: `run-${unique}`,
        channelId,
        currency: "CNY",
        businessDate,
        businessTimezone: "Asia/Shanghai",
        publishedAt: `${businessDate}T12:00:00Z`,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), runReceipt);
    const runId = runReceipt.resource?.resourceId;
    expect(runId).toBeTruthy();
    let run = await eventually(() => service.getReconciliationRun(runId!), (value) => value.differences.some((difference) => difference.differenceType === "CHANNEL_ONLY"));
    const blockingDifference = run.differences.find((difference) => difference.differenceType === "CHANNEL_ONLY");
    expect(blockingDifference, JSON.stringify(run)).toBeTruthy();
    expect(blockingDifference?.settlementBlocked).toBe(true);
    const disposition = await service.execute({
      type: "DISPOSE_RECONCILIATION_DIFFERENCE",
      input: {
        runId: runId!,
        differenceId: blockingDifference!.differenceId,
        revision: 1,
        merchantId,
        idempotencyKey: `run-disposition-${unique}`,
        actorAlias: "fixture-reconciliation-operator",
        actorId: "workbench-reconciliation-operator",
        actorRole: "RECONCILIATION_REVIEWER",
        conclusion: "ACCEPT_DIFFERENCE",
        settlementImpact: "ALLOW",
        reason: "live adapter smoke accepts an evidenced unmatched channel observation",
        evidenceRefs: [`reference://workbench/${unique}/channel-only`],
      },
    });
    await waitForTerminal(service.getOperation.bind(service), disposition);
    run = await eventually(
      () => service.getReconciliationRun(runId!),
      (value) => value.differences.some((difference) => difference.differenceId === blockingDifference!.differenceId && difference.resolved && difference.dispositions.length > 0),
    );
    const disposedDifference = run.differences.find((difference) => difference.differenceId === blockingDifference!.differenceId)!;
    expect(disposedDifference.dispositions.at(-1)?.reason).toBe("live adapter smoke accepts an evidenced unmatched channel observation");
    expect(disposedDifference.dispositions.at(-1)?.actorId).toBeTruthy();
    expect(run.settlementBlocked, JSON.stringify(run)).toBe(false);
    if (run.actions.some((item) => item.kind === "COMPLETE_RECONCILIATION" && item.executable)) {
      const completed = await service.execute({
        type: "COMPLETE_RECONCILIATION",
        input: {
          runId: runId!,
          merchantId,
          idempotencyKey: `run-complete-${unique}`,
          actorAlias: "fixture-reconciliation-operator",
          actorId: "workbench-reconciliation-operator",
          actorRole: "RECONCILIATION_OPERATOR",
          reason: "live adapter smoke completion",
          evidenceRefs: [`reference://workbench/${unique}/reconciliation-completion`],
        },
      });
      await waitForTerminal(service.getOperation.bind(service), completed);
      run = await eventually(() => service.getReconciliationRun(runId!), (value) => value.status !== "RUNNING" && value.status !== "PENDING");
    }
    expect(run.finality).toBe("FINAL");
    const runPage = await service.listReconciliationRuns({ filters: { resourceId: runId, merchantId }, pageSize: 2 });
    expect(runPage.items.map((item) => item.runId)).toContain(runId);

    const prepared = await service.execute({
      type: "PREPARE_SETTLEMENT",
      input: {
        merchantId,
        currency: "CNY",
        channelId,
        periodStart,
        periodEnd,
        businessTimezone: "Asia/Shanghai",
        idempotencyKey: `settlement-${unique}`,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), prepared);
    const settlementId = prepared.resource?.resourceId;
    expect(settlementId).toBeTruthy();
    const settlement = await eventually(() => service.getSettlement(settlementId!), (value) => value.status === "READY_FOR_CONFIRMATION");
    expect(settlement.netAmount?.amountMinor).toBe("794");

    const confirmed = await service.execute({
      type: "CONFIRM_SETTLEMENT",
      input: {
        settlementId: settlementId!,
        merchantId,
        idempotencyKey: `settlement-confirm-${unique}`,
        actorAlias: "fixture-settlement-operator",
        actorId: "workbench-settlement-operator",
        actorRole: "SETTLEMENT_OPERATOR",
        reason: "live adapter smoke confirmation",
        evidenceRefs: [`reference://workbench/${unique}/settlement-confirmation`],
      },
    });
    await waitForTerminal(service.getOperation.bind(service), confirmed);

    const settlementExecutionId = `settlement-execution-${unique}`;
    const settlementScript = await service.executeReference({
      type: "CONFIGURE_SETTLEMENT_EXECUTOR",
      input: { fixtureId, channelId, executionId: settlementExecutionId, outcome: "NO_RESULT" },
    });
    expect(settlementScript.effect).toBe("applied");

    const executed = await service.execute({
      type: "EXECUTE_SETTLEMENT",
      input: {
        settlementId: settlementId!,
        merchantId,
        executionId: settlementExecutionId,
        channelId,
        idempotencyKey: settlementExecutionId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), executed);
    const executing = await eventually(() => service.getSettlement(settlementId!), (value) => value.executions.length > 0);
    const execution = executing.executions.at(-1)!;
    const settlementResult = await service.execute({
      type: "RECEIVE_SETTLEMENT_RESULT",
      input: {
        resourceType: "SETTLEMENT",
        resourceId: settlementId!,
        attemptId: execution.executionId,
        channelId: executing.channelId ?? channelId,
        resultIdentity: `settlement-result-${unique}`,
        externalTransactionId: execution.externalSettlementId ?? `external-settlement-${unique}`,
        money: executing.netAmount!,
        outcome: "SUCCESS",
        occurredAt: scenarioInstant,
        fixtureId,
        executionGroupIdentity: execution.executionGroupIdentity ?? `settlement-group-${unique}`,
        requestIdentity: execution.requestIdentity ?? `settlement-request-${unique}`,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), settlementResult);
    const settled = await eventually(() => service.getSettlement(settlementId!), (value) => value.status === "SETTLED");
    expect(settled.finality).toBe("FINAL");
    const settlementPage = await service.listSettlements({ filters: { resourceId: settlementId, merchantId }, pageSize: 2 });
    expect(settlementPage.items.map((item) => item.settlementId)).toContain(settlementId);

    const conflictingResult = await service.execute({
      type: "RECEIVE_PAYMENT_RESULT",
      input: {
        resourceType: "PAYMENT",
        resourceId: paymentId!,
        attemptId: attemptId!,
        channelId,
        resultIdentity: `result-conflict-${unique}`,
        externalTransactionId: externalTransactionId!,
        money,
        outcome: "FAILURE",
        occurredAt: `${businessDate}T00:00:01Z`,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), conflictingResult);
    const paymentAfterConflict = await eventually(
      () => service.getPayment(paymentId!),
      (payment) => payment.attempts.some((attempt) => attempt.receipts.some((receipt) => receipt.resultIdentity === `result-conflict-${unique}`)),
    );
    expect(paymentAfterConflict.status).toBe("SUCCEEDED");
    expect(paymentAfterConflict.refundBudget?.succeededAmount.amountMinor).toBe("200");
    expect(paymentAfterConflict.refundBudget?.availableAmount.amountMinor).toBe("800");

    const reviews = await eventually(
      () => service.listManualReviews({ filters: { merchantId }, pageSize: 20 }),
      (pageResult) => pageResult.items.length > 0,
    );
    const reviewSummary = reviews.items.find((item) => item.relatedResources.some((reference) => reference.resourceId === paymentId)) ?? reviews.items[0]!;
    const review = await service.getManualReview(reviewSummary.reviewId);
    expect(review.status).toBe("OPEN");
    const reviewResolution = await service.execute({
      type: "RESOLVE_MANUAL_REVIEW",
      input: {
        reviewId: review.reviewId,
        reviewType: review.type,
        merchantId,
        outcome: "KEEP_ACCEPTED_SUCCESS",
        actorAlias: "fixture-payment-reviewer",
        actorId: "workbench-payment-reviewer",
        actorRole: "PAYMENT_REVIEWER",
        reason: "live adapter smoke keeps the first accepted success",
        evidenceRefs: [`reference://workbench/${unique}/payment-conflict`],
        remediationReference: `reference://workbench/${unique}/payment-conflict-remediation`,
        idempotencyKey: `review-resolution-${unique}`,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), reviewResolution);
    const resolvedReview = await eventually(
      () => service.getManualReview(review.reviewId),
      (value) => value.status !== "OPEN" && value.dispositions.length > 0,
    );
    expect(resolvedReview.dispositions.at(-1)?.actorId).toBeTruthy();
    expect(resolvedReview.dispositions.at(-1)?.reason).toBe("live adapter smoke keeps the first accepted success");

    const notifications = await service.listNotifications({ filters: { merchantId, paymentId }, pageSize: 2 });
    expect(notifications.items.length).toBeGreaterThan(0);
    const notification = await service.getNotification(notifications.items[0]!.notificationId);
    expect(notification.notificationId).toBe(notifications.items[0]!.notificationId);
    const notificationScript = await service.executeReference({
      type: "CONFIGURE_NOTIFICATION_SENDER",
      input: {
        fixtureId,
        notificationId: notification.notificationId,
        outcome: "SUCCESS",
      },
    });
    expect(notificationScript.effect).toBe("applied");

    const timeline = await service.getPaymentTimeline(paymentId!);
    expect(timeline.entries.length).toBeGreaterThan(0);

    const expiring = await service.execute({
      type: "CREATE_PAYMENT",
      input: {
        merchantId,
        merchantOrderId: `expiring-order-${unique}`,
        idempotencyKey: `expiring-payment-${unique}`,
        money,
        paymentMethod,
        expiresAt: `${businessDate}T00:05:00Z`,
        fixtureId,
      },
    });
    await waitForTerminal(service.getOperation.bind(service), expiring);
    const expiringId = expiring.resource?.resourceId;
    expect(expiringId).toBeTruthy();
    expect((await service.getPayment(expiringId!)).status).toBe("PAYABLE");
    const advanced = await service.executeReference({
      type: "ADVANCE_CLOCK",
      input: { fixtureId, duration: "PT24H" },
    });
    expect(advanced.effect).toBe("applied");
    const close = await service.execute({
      type: "CLOSE_EXPIRED_PAYMENT",
      input: { paymentId: expiringId! },
    });
    expect(close.resource?.resourceId).toBe(expiringId);
    if (selected === "cap4k") expect(close.readAfter.mode).toBe("READ_ONCE");
    expect((await waitForTerminal(service.getOperation.bind(service), close)).status).toBe("SUCCEEDED");
    const closed = await eventually(() => service.getPayment(expiringId!), (payment) => payment.status === "CLOSED");
    expect(closed.finality).toBe("FINAL");
  }, 60_000);
});

async function waitForTerminal(read: (operationId: string) => Promise<Operation>, receipt: OperationReceipt): Promise<Operation> {
  return eventually(
    () => read(receipt.operationId),
    (operation) => operation.status === "SUCCEEDED" || operation.status === "FAILED" || operation.status === "REVIEW_REQUIRED",
  );
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch {
      // Projection and operation reads are eventually consistent in the WOW implementation.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Live observation did not converge: ${JSON.stringify(last)}`);
}
