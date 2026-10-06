import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { BackendId, BillRecord, BusinessCommand, OperationReceipt, ReconciliationRun } from "../domain/models";
import { createMoney } from "../domain/money";
import { createPaymentBackendAdapter } from "./factory";
import { summarizeReconciliation } from "../ui/reconciliation-summary";

const env = process.env;
const backend = env.LIVE_PAYMENT_BACKEND as BackendId;
describe.skipIf(!["wow", "cap4k"].includes(backend))("real HTTP multi-record bill correction", () => {
  it("keeps revision1/run1 immutable, corrects all four facts in revision2 and settles", async () => {
    const unique = `${backend}-${Date.now()}`;
    const fixtureId = env.LIVE_MULTIRECORD_FIXTURE ?? `multi-bill-${unique}`;
    const merchantId = `multi-merchant-${unique}`;
    const channelId = backend === "wow" ? "fake" : "C-001";
    const paymentMethod = backend === "wow" ? "DEFAULT" : "CARD";
    const day = env.LIVE_MULTIRECORD_DAY ?? new Date(Date.UTC(2050, 0, 1) + (Date.now() % 7300) * 86400000).toISOString().slice(0, 10);
    const instant = `${day}T06:00:00Z`;
    const exchanges: unknown[] = [];
    const service = createPaymentBackendAdapter({ backend, fixtureId, apiBaseUrl: env.LIVE_PAYMENT_BASE_URL ?? "http://127.0.0.1:18080/api", fetchImpl: async (url, init) => {
      const response = await fetch(url, init); exchanges.push({ url: String(url), method: init?.method, body: init?.body, status: response.status, response: await response.clone().text() }); return response;
    } });
    async function wait<T>(read: () => Promise<T>, done: (value: T) => boolean) { let last: unknown; for (let i = 0; i < 100; i++) { try { const value = await read(); last = value; if (done(value)) return value; } catch (cause) { last = String(cause); } await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`not converged: ${JSON.stringify(last)}`); }
    async function observe(receipt: OperationReceipt) { const operation = await wait(() => service.getOperation(receipt.operationId), (item) => ["SUCCEEDED", "FAILED", "REVIEW_REQUIRED"].includes(item.status)); expect(operation.status, JSON.stringify(operation)).toBe("SUCCEEDED"); return receipt.resource?.resourceId ?? ""; }
    async function execute(command: BusinessCommand) { return observe(await service.execute(command)); }
    const registration = await service.executeReference({ type: "REGISTER_ENVIRONMENT", input: { fixtureId, merchantId, channelId, paymentMethod, actorAlias: "fixture-payment-reviewer", currentTime: instant, policy: {} } });
    if (registration.receipt) await observe(registration.receipt);
    await service.executeReference({ type: "CONFIGURE_CHANNEL", input: { fixtureId, channelId, outcome: "NO_RESULT" } });
    const money = createMoney("CNY", "10000"); const refundMoney = createMoney("CNY", "2000");
    const records: BillRecord[] = []; const paymentIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const paymentId = await execute({ type: "CREATE_PAYMENT", input: { merchantId, merchantOrderId: `order-${unique}-${i}`, idempotencyKey: `pay-${unique}-${i}`, money, paymentMethod, fixtureId } }); paymentIds.push(paymentId);
      await execute({ type: "CREATE_PAYMENT_ATTEMPT", input: { resourceId: paymentId, idempotencyKey: `attempt-${unique}-${i}`, paymentMethod, fixtureId } });
      const payment = await wait(() => service.getPayment(paymentId), (item) => item.attempts.length === 1); const attemptId = payment.attempts[0].attemptId;
      await execute({ type: "SUBMIT_PAYMENT_ATTEMPT", input: { resourceId: paymentId, attemptId, submissionId: `submission-${unique}-${i}`, idempotencyKey: `submit-${unique}-${i}` } });
      const submitted = await wait(() => service.getPayment(paymentId), (item) => item.attempts[0].submissions.length > 0);
      const externalTransactionId = submitted.attempts[0].externalTransactionId ?? `reference-payment-${unique}-${i}`;
      await execute({ type: "RECEIVE_PAYMENT_RESULT", input: { resourceType: "PAYMENT", resourceId: paymentId, attemptId, channelId, resultIdentity: `result-${unique}-${i}`, externalTransactionId, money, outcome: "SUCCESS", occurredAt: instant, fixtureId } });
      const succeeded = await wait(() => service.getPayment(paymentId), (item) => item.status === "SUCCEEDED");
      records.push({ recordId: `business-payment-${unique}-${i}`, transactionKind: "PAYMENT", externalTransactionId: succeeded.externalTransactionId!, money, status: "SUCCEEDED", occurredAt: instant });
    }
    const refundId = await execute({ type: "REQUEST_REFUND", input: { merchantId, paymentId: paymentIds[0], merchantRefundId: `refund-${unique}`, idempotencyKey: `refund-${unique}`, money: refundMoney, reason: "multi-record correction test", requestedAt: instant, fixtureId } });
    await execute({ type: "CREATE_REFUND_ATTEMPT", input: { resourceId: refundId, idempotencyKey: `refund-attempt-${unique}`, fixtureId } });
    const refund = await wait(() => service.getRefund(refundId), (item) => item.attempts.length === 1); const refundAttemptId = refund.attempts[0].attemptId;
    await execute({ type: "SUBMIT_REFUND_ATTEMPT", input: { resourceId: refundId, attemptId: refundAttemptId, submissionId: `refund-submission-${unique}`, idempotencyKey: `refund-submit-${unique}` } });
    const submittedRefund = await wait(() => service.getRefund(refundId), (item) => item.attempts[0].status !== "CREATED");
    await execute({ type: "RECEIVE_REFUND_RESULT", input: { resourceType: "REFUND", resourceId: refundId, attemptId: refundAttemptId, channelId, resultIdentity: `refund-result-${unique}`, externalTransactionId: submittedRefund.attempts[0].externalTransactionId ?? `reference-refund-${unique}`, money: refundMoney, outcome: "SUCCESS", occurredAt: instant, fixtureId } });
    const succeededRefund = await wait(() => service.getRefund(refundId), (item) => item.status === "SUCCEEDED");
    records.push({ recordId: `business-refund-${unique}`, transactionKind: "REFUND", externalTransactionId: succeededRefund.externalTransactionId!, money: refundMoney, status: "SUCCEEDED", occurredAt: instant });
    const dayStart = new Date(`${day}T00:00:00Z`).getTime();
    const context = { backend, fixtureId, merchantId, channelId, currency: "CNY", businessDate: day, businessTimezone: "Asia/Shanghai", instant, records, paymentIds, refundId, billId: `multi-bill-${unique}`, periodStart: new Date(dayStart - 8 * 3600000).toISOString(), periodEnd: new Date(dayStart + 16 * 3600000).toISOString() };
    if (env.LIVE_MULTIRECORD_SEED_ONLY === "1") {
      console.log("MULTIRECORD_UI_CONTEXT", JSON.stringify(context));
      if (env.LIVE_MULTIRECORD_EVIDENCE_PATH) await writeFile(env.LIVE_MULTIRECORD_EVIDENCE_PATH, JSON.stringify({ context, exchanges }, null, 2));
      return;
    }
    const scope = { merchantId, billId: context.billId, channelId, currency: "CNY", businessDate: day, businessTimezone: "Asia/Shanghai" };
    async function publish(revision: number, rows: BillRecord[]) { const result = await service.executeReference({ type: "REGISTER_BILL", input: { ...scope, revision, records: rows, publishedAt: instant, fixtureId, idempotencyKey: `bill-${unique}-${revision}` } }); if (result.receipt) await observe(result.receipt); }
    await publish(1, records.slice(0, 1));
    const firstBill = await wait(() => service.getBill(context.billId), (item) => item.revisions?.length === 1);
    const run1Id = await execute({ type: "RUN_RECONCILIATION", input: { ...scope, revision: 1, idempotencyKey: `run-${unique}-1` } });
    const firstRun = await wait(() => service.getReconciliationRun(run1Id), (item) => item.differences.length === 4);
    expect(summarizeReconciliation(firstRun).matched.value, JSON.stringify(firstRun)).toBe(1); expect(summarizeReconciliation(firstRun).differences.value).toBe(3); expect(firstRun.settlementBlocked).toBe(true);
    const oldRevision = structuredClone(firstBill.revisions![0]);
    await publish(2, records);
    const secondBill = await wait(() => service.getBill(context.billId), (item) => String(item.currentRevision) === "2" && item.revisions?.length === 2);
    expect(secondBill.revisions![0]).toEqual(oldRevision); expect(secondBill.revisions![1].records).toHaveLength(4);
    expect(secondBill.revisions![1].records.map((record) => record.recordIdentity ?? record.recordId).sort()).toEqual(records.map((record) => record.recordId).sort());
    const run2Id = await execute({ type: "RUN_RECONCILIATION", input: { ...scope, revision: 2, idempotencyKey: `run-${unique}-2` } });
    let secondRun = await wait(() => service.getReconciliationRun(run2Id), (item) => item.differences.length === 4 && item.differences.every((row) => row.differenceType === "MATCHED"));
    expect(summarizeReconciliation(secondRun).matched.value).toBe(4); expect(summarizeReconciliation(secondRun).differences.value).toBe(0); expect(secondRun.settlementBlocked).toBe(false);
    const responsibility = { merchantId, actorAlias: "fixture-settlement-operator", actorId: "multibill-operator", actorRole: "SETTLEMENT_OPERATOR", reason: "all four facts verified", evidenceRefs: [`reference://multibill/${unique}`] };
    if (secondRun.actions.some((action) => action.kind === "COMPLETE_RECONCILIATION" && action.executable)) {
      await execute({ type: "COMPLETE_RECONCILIATION", input: { ...responsibility, actorAlias: "fixture-reconciliation-operator", actorRole: "RECONCILIATION_OPERATOR", runId: run2Id, idempotencyKey: `complete-${unique}` } });
      secondRun = await service.getReconciliationRun(run2Id);
    }
    expect(secondRun.finality).toBe("FINAL");
    const oldRun = await service.getReconciliationRun(run1Id);
    expect(oldRun.differences).toEqual(firstRun.differences); expect(oldRun.billRevision).toBe(firstRun.billRevision);
    const settlementId = await execute({ type: "PREPARE_SETTLEMENT", input: { ...scope, periodStart: context.periodStart, periodEnd: context.periodEnd, fixtureId, idempotencyKey: `prepare-${unique}` } });
    const settlement = await wait(() => service.getSettlement(settlementId), (item) => item.status === "READY_FOR_CONFIRMATION");
    expect(settlement.netAmount).toBeTruthy(); const frozenNet = structuredClone(settlement.netAmount);
    await execute({ type: "CONFIRM_SETTLEMENT", input: { ...responsibility, settlementId, idempotencyKey: `confirm-${unique}` } });
    const executionId = `execution-${unique}`;
    await service.executeReference({ type: "CONFIGURE_SETTLEMENT_EXECUTOR", input: { fixtureId, channelId, executionId, outcome: "SUCCESS" } });
    await execute({ type: "EXECUTE_SETTLEMENT", input: { settlementId, merchantId, channelId, executionId, idempotencyKey: executionId } });
    const settled = await wait(() => service.getSettlement(settlementId), (item) => item.status === "SETTLED");
    expect(settled.netAmount).toEqual(frozenNet); expect(settled.finality).toBe("FINAL");
    const finalPayments = await Promise.all(paymentIds.map((id) => service.getPayment(id)));
    expect(finalPayments.every((item) => item.status === "SUCCEEDED")).toBe(true); expect(finalPayments[0].refundBudget?.succeededAmount.amountMinor).toBe("2000");
    console.log("MULTIRECORD_HTTP_RESULT", JSON.stringify({ ...context, run1Id, run2Id, settlementId, netAmount: frozenNet, exchangeCount: exchanges.length }));
    if (env.LIVE_MULTIRECORD_EVIDENCE_PATH) await writeFile(env.LIVE_MULTIRECORD_EVIDENCE_PATH, JSON.stringify({ context, firstBill, secondBill, firstRun, secondRun, oldRun, settled, finalPayments, exchanges }, null, 2));
  }, 90_000);
});
