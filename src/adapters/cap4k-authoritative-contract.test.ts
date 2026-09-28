import { describe, expect, it, vi } from "vitest";
import { Cap4kPaymentAdapter } from "./cap4k-adapter";
import type { FetchLike } from "../http/client";
import { createMoney } from "../domain/money";

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function capture(responder: (path: string) => unknown) {
  const calls: Array<{ path: string; method?: string; headers?: HeadersInit; body?: Record<string, unknown> }> = [];
  const fetchImpl: FetchLike = vi.fn(async (input, init = {}) => {
    const path = String(input);
    calls.push({
      path,
      method: init.method,
      headers: init.headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined,
    });
    return response(responder(path));
  });
  return { calls, fetchImpl };
}

const receipt = {
  operationId: "operation-1",
  commandType: "CloseExpiredPayment",
  resource: { resourceType: "Payment", resourceId: "payment-1" },
  acceptanceStatus: "ACCEPTED",
  idempotentReplay: false,
  readAfter: { mode: "READ_ONCE", operationUrl: "/api/operations/operation-1", resourceUrl: "/api/payments/payment-1" },
};

describe("CAP4K 对齐后的公开 HTTP 契约", () => {
  it("GET 权威账单保留升序历史、completeness、指纹、原始记录及 Money", async () => {
    const mock = capture(() => ({
      billId: "bill/1", billIdentity: "reference-bill",
      channelId: "C-001", currency: "CNY", businessDate: "2026-09-26",
      businessTimezone: "Asia/Shanghai", createdAt: "2026-09-26T00:00:00Z",
      currentRevision: "2", currentRevisionId: "revision-2",
      revisions: [
        {
          revisionId: "revision-1", revision: "1", completeness: "PARTIAL",
          payloadFingerprint: "hash-1", rawEvidence: "evidence://revision-1",
          publishedAt: "2026-09-26T00:01:00Z",
          records: [{
            recordId: "record-1", recordIdentity: "source-record-1", transactionKind: "PAYMENT",
            externalTransactionIdentity: "channel-txn-1", money: { currency: "CNY", amountMinor: "9007199254740993" },
            rawStatus: "CAPTURED", occurredAt: "2026-09-26T00:00:10Z",
            receivedAt: "2026-09-26T00:01:00Z", rawEvidence: "evidence://record-1",
          }],
        },
        {
          revisionId: "revision-2", revision: "2", completeness: "COMPLETE",
          payloadFingerprint: "hash-2", rawEvidence: "evidence://revision-2",
          publishedAt: "2026-09-26T00:02:00Z", records: [],
        },
      ],
    }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const bill = await adapter.getBill("bill/1");

    expect(mock.calls).toMatchObject([{ path: "/backend/api/authoritative-bills/bill%2F1", method: "GET" }]);
    expect(bill).toMatchObject({
      billId: "bill/1", currentRevision: "2", currentRevisionId: "revision-2",
      businessTimezone: "Asia/Shanghai",
      revisions: [
        {
          revision: "1", revisionId: "revision-1", complete: false, completeness: "PARTIAL",
          payloadFingerprint: "hash-1", rawEvidence: "evidence://revision-1",
          records: [{
            recordId: "record-1", recordIdentity: "source-record-1",
            externalTransactionId: "channel-txn-1", money: { currency: "CNY", amountMinor: "9007199254740993" },
            status: "CAPTURED", rawStatus: "CAPTURED", rawEvidence: "evidence://record-1",
            receivedAt: "2026-09-26T00:01:00Z",
          }],
        },
        { revision: "2", complete: true, completeness: "COMPLETE", payloadFingerprint: "hash-2" },
      ],
    });
    expect(adapter.profile.capabilities.find((item) => item.id === "bill-detail")?.level).toBe("full");
  });

  it("单支付到期关闭取权威 merchantId，POST 真实 receipt 且重放使用同一幂等键", async () => {
    const mock = capture((path) => path.endsWith("/close-expired")
      ? { paymentId: "payment-1", paymentStatus: "EXPIRED", receipt }
      : {
          paymentId: "payment-1", merchantId: "merchant-1", merchantOrderNumber: "order-1",
          money: { currency: "CNY", amountMinor: "100" }, paymentMethod: "CARD",
          status: "PAYABLE", finality: "NON_FINAL", attempts: [],
        });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const payment = await adapter.getPayment("payment-1");
    const first = await adapter.execute({ type: "CLOSE_EXPIRED_PAYMENT", input: { paymentId: "payment-1" } });
    await adapter.execute({ type: "CLOSE_EXPIRED_PAYMENT", input: { paymentId: "payment-1" } });

    expect(payment.actions.find((item) => item.kind === "CLOSE_EXPIRED_PAYMENT")).toMatchObject({ executable: true, availability: "full" });
    expect(first).toMatchObject({ operationId: "operation-1", readAfter: { mode: "READ_ONCE" } });
    const closeCalls = mock.calls.filter((call) => call.path.endsWith("/close-expired"));
    expect(closeCalls).toMatchObject([
      { method: "POST", body: { merchantId: "merchant-1", idempotencyKey: "workbench:close-expired:payment-1" } },
      { method: "POST", body: { merchantId: "merchant-1", idempotencyKey: "workbench:close-expired:payment-1" } },
    ]);
  });

  it("结算脚本 configure/read/reset 与 ExecuteSettlement 保持 caller execution identity", async () => {
    const mock = capture((path) => path.includes("/settlement-executor-script")
      ? { executionId: "exec/1", script: "NO_RESULT", configured: true, consumed: false }
      : { settlementId: "settlement-1", executionId: "exec/1", receipt });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });
    const selector = { fixtureId: "fixture-a", channelId: "CHANNEL-X", executionId: "exec/1" };

    await adapter.executeReference({ type: "CONFIGURE_SETTLEMENT_EXECUTOR", input: { ...selector, outcome: "NO_RESULT" } });
    await adapter.executeReference({ type: "READ_SETTLEMENT_EXECUTOR_SCRIPT", input: selector });
    await adapter.executeReference({ type: "RESET_SETTLEMENT_EXECUTOR_SCRIPT", input: selector });
    await adapter.execute({
      type: "EXECUTE_SETTLEMENT",
      input: { settlementId: "settlement-1", merchantId: "merchant-1", executionId: "exec/1", channelId: "CHANNEL-X", idempotencyKey: "execute-1" },
    });

    expect(mock.calls.map(({ path, method }) => [method, path])).toEqual([
      ["POST", "/backend/api/reference-fixtures/settlement-executor-script"],
      ["GET", "/backend/api/reference-fixtures/settlement-executor-script/exec%2F1"],
      ["POST", "/backend/api/reference-fixtures/settlement-executor-script/reset"],
      ["POST", "/backend/api/merchant-settlements/settlement-1/executions"],
    ]);
    expect(mock.calls[0]?.body).toEqual({ executionId: "exec/1", script: "NO_RESULT" });
    expect(mock.calls[2]?.body).toEqual({ executionId: "exec/1" });
    expect(mock.calls[3]?.body).toEqual({
      merchantId: "merchant-1", executionId: "exec/1",
      executionChannelId: "CHANNEL-X", idempotencyKey: "execute-1",
    });
    expect(adapter.profile.capabilities.find((item) => item.id === "settlement-execution-identity")?.level).toBe("full");
  });

  it("结算可信结果以 caller executionId 关联 evidence 和 callback", async () => {
    const mock = capture((path) => path.endsWith("/channel/settlement-results") ? { receipt } : {});
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.execute({
      type: "RECEIVE_SETTLEMENT_RESULT",
      input: {
        resourceType: "SETTLEMENT",
        resourceId: "settlement-1",
        attemptId: "exec/1",
        channelId: "C-001",
        resultIdentity: "result-1",
        externalTransactionId: "external-1",
        money: createMoney("CNY", "100"),
        outcome: "SUCCESS",
        occurredAt: "2026-09-26T00:00:00Z",
        executionGroupIdentity: "group-1",
        requestIdentity: "request-1",
      },
    });

    expect(mock.calls.map(({ method, path }) => [method, path])).toEqual([
      ["POST", "/backend/api/reference-fixtures/callback-evidence"],
      ["POST", "/backend/api/channel/settlement-results"],
    ]);
    expect(mock.calls[0]?.body?.associationIdentity).toBe("settlement-1|exec/1|group-1|request-1|external-1");
    expect(mock.calls[1]?.body).toMatchObject({ settlementId: "settlement-1", executionId: "exec/1" });
    expect(mock.calls[1]?.body).not.toHaveProperty("executionAttemptId");
  });

  it("渠道与通知 reset 使用后端 selector；缺失的 read route 明确不可用且不发请求", async () => {
    const mock = capture(() => ({ script: "SUCCESS" }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });
    const channel = { fixtureId: "fixture-a", channelId: "C-001" };
    const notification = { fixtureId: "fixture-a", sourceKind: "PAYMENT", sourceFactId: "fact-1" };

    await adapter.executeReference({ type: "RESET_CHANNEL_SCRIPT", input: channel });
    await adapter.executeReference({ type: "RESET_NOTIFICATION_SENDER_SCRIPT", input: notification });
    const channelRead = await adapter.executeReference({ type: "READ_CHANNEL_SCRIPT", input: channel });
    const notificationRead = await adapter.executeReference({ type: "READ_NOTIFICATION_SENDER_SCRIPT", input: notification });
    const billRead = await adapter.executeReference({
      type: "READ_BILL_PROVIDER_SCRIPT", input: { fixtureId: "fixture-a", billId: "bill-1", revision: 1 },
    });

    expect(mock.calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", "/backend/api/reference-fixtures/payment-channel-script/reset", { channelId: "C-001" }],
      ["POST", "/backend/api/reference-fixtures/merchant-notification-sender-script/reset", {
        sourceKind: "PAYMENT", sourceFactIdentity: "fact-1",
      }],
    ]);
    expect([channelRead.effect, notificationRead.effect, billRead.effect]).toEqual(["unavailable", "unavailable", "unavailable"]);
  });

  it("人工结算确认仍传服务端解析的 actor header", async () => {
    const mock = capture(() => ({ settlementId: "settlement-1", receipt }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.execute({
      type: "CONFIRM_SETTLEMENT",
      input: {
        settlementId: "settlement-1", merchantId: "merchant-1", idempotencyKey: "confirm-1",
        actorAlias: "fixture-settlement-operator", reason: "证据复核", evidenceRefs: ["evidence://review"],
      },
    });

    expect(mock.calls[0]).toMatchObject({
      path: "/backend/api/merchant-settlements/settlement-1/confirmations",
      method: "POST",
      headers: { "X-Reference-Actor-Context": "fixture-settlement-operator" },
      body: { idempotencyKey: "confirm-1", reason: "证据复核", evidence: "evidence://review" },
    });
  });
});
