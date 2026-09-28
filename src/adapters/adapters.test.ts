import { describe, expect, it, vi } from "vitest";
import { createMoney } from "../domain/money";
import type { BusinessCommand, PageRequest } from "../domain/models";
import type { FetchLike, JsonRecord } from "../http/client";
import { Cap4kPaymentAdapter } from "./cap4k-adapter";
import { createPaymentBackendAdapter } from "./factory";
import { mapOperation, mapPage, mapPayment, mapReceipt, mapReconciliationRun, mapRefund, mapSettlement } from "./shared";
import { WowPaymentAdapter } from "./wow-adapter";

interface FetchCall {
  url: string;
  init: RequestInit;
  body?: JsonRecord;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function recordedFetch(responder: (call: FetchCall, index: number) => unknown) {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = vi.fn(async (input, init = {}) => {
    const rawBody = typeof init.body === "string" ? JSON.parse(init.body) as JsonRecord : undefined;
    const call = { url: String(input), init, body: rawBody };
    calls.push(call);
    return jsonResponse(responder(call, calls.length - 1), init.method === "POST" ? 201 : 200);
  });
  return { calls, fetchImpl };
}

function flatReceipt(resourceType = "Payment", resourceId = "pay-1") {
  return {
    operationId: `op-${resourceId}`,
    commandType: "REFERENCE_COMMAND",
    resourceType,
    resourceId,
    acceptanceStatus: "ACCEPTED",
    acceptedAt: "2026-09-25T01:00:00Z",
    idempotentReplay: false,
    correlationId: `corr-${resourceId}`,
    readAfter: {
      mode: "POLL",
      operationUrl: `/api/operations/op-${resourceId}`,
      resourceUrl: `/api/${resourceType.toLowerCase()}s/${resourceId}`,
      retryAfterMs: 125,
    },
  };
}

function nestedReceipt(resourceType = "Payment", resourceId = "pay-1") {
  return {
    operationId: `op-${resourceId}`,
    commandType: "REFERENCE_COMMAND",
    resource: { resourceType, resourceId },
    acceptanceStatus: "ALREADY_ACCEPTED",
    acceptedAt: "2026-09-25T01:00:00Z",
    idempotentReplay: true,
    correlationId: `corr-${resourceId}`,
    readAfter: {
      mode: "READ_ONCE",
      operationUrl: `/api/operations/op-${resourceId}`,
      resourceUrl: `/api/${resourceType.toLowerCase()}s/${resourceId}`,
    },
  };
}

const createPayment: BusinessCommand = {
  type: "CREATE_PAYMENT",
  input: {
    merchantId: "merchant-1",
    merchantOrderId: "order-1",
    idempotencyKey: "idem-1",
    money: createMoney("CNY", "1234"),
    paymentMethod: "DEFAULT",
    expiresAt: "2026-09-25T12:00:00Z",
  },
};

const paymentResult: BusinessCommand = {
  type: "RECEIVE_PAYMENT_RESULT",
  input: {
    resourceType: "PAYMENT",
    resourceId: "pay-1",
    attemptId: "attempt-1",
    channelId: "C-001",
    resultIdentity: "result-1",
    externalTransactionId: "txn-1",
    money: createMoney("CNY", "1234"),
    outcome: "SUCCESS",
    occurredAt: "2026-09-25T01:02:00Z",
    rawPayload: "canonical-result-payload",
  },
};

describe("统一协议映射", () => {
  it("将 WOW 平铺 resource receipt 与 CAP4K 嵌套 resource receipt 映射为同一模型", () => {
    const wow = mapReceipt("wow", flatReceipt());
    const cap4k = mapReceipt("cap4k", nestedReceipt());

    expect(wow).toMatchObject({
      operationId: "op-pay-1",
      resource: { resourceType: "Payment", resourceId: "pay-1" },
      acceptanceStatus: "ACCEPTED",
      idempotentReplay: false,
      correlationId: "corr-pay-1",
      readAfter: { mode: "POLL", retryAfterMs: 125 },
    });
    expect(cap4k).toMatchObject({
      resource: { resourceType: "Payment", resourceId: "pay-1" },
      acceptanceStatus: "ALREADY_ACCEPTED",
      idempotentReplay: true,
      readAfter: { mode: "READ_ONCE" },
    });
  });

  it("解开 CAP4K Operation envelope，并保留终态错误而不伪造资源状态", () => {
    const operation = mapOperation("cap4k", {
      operation: {
        operationId: "op-1",
        commandType: "RequestRefund",
        resource: { resourceType: "Refund", resourceId: "refund-1" },
        status: "FAILED",
        completedAt: "2026-09-25T01:03:00Z",
        error: {
          code: "REFUND_BUDGET_EXCEEDED",
          message: "refund budget exceeded",
          details: { availableMinor: "200" },
          correlationId: "corr-1",
          retryable: false,
        },
      },
    });

    expect(operation).toMatchObject({
      operationId: "op-1",
      status: "FAILED",
      resource: { resourceType: "Refund", resourceId: "refund-1" },
      error: {
        code: "REFUND_BUDGET_EXCEEDED",
        details: { availableMinor: "200" },
        correlationId: "corr-1",
        retryable: false,
      },
    });
  });

  it("保留 opaque cursor 和后端 pageSize，不解释游标", () => {
    const page = mapPage({
      items: [{ paymentId: "pay-1" }],
      nextCursor: "opaque:+/=%:cursor",
      pageSize: 7,
    }, (item) => item.paymentId);

    expect(page).toEqual({ items: ["pay-1"], nextCursor: "opaque:+/=%:cursor", pageSize: 7 });
  });

  it("将两个后端字段别名规范化为相同 Money 和稳定业务身份", () => {
    const wowPayment = mapPayment("wow", {
      paymentId: "pay-wow",
      merchantId: "merchant-1",
      merchantOrderNo: "order-1",
      amount: { currency: "CNY", amountMinor: "1000" },
      paymentMethod: "DEFAULT",
      status: "SUCCEEDED",
      finality: "FINAL",
      successfulRefundAmount: { currency: "CNY", amountMinor: "200" },
      reservedRefundAmount: { currency: "CNY", amountMinor: "100" },
      attempts: [],
    });
    const capRefund = mapRefund("cap4k", {
      refundId: "refund-cap",
      paymentId: "pay-wow",
      merchantId: "merchant-1",
      merchantRefundNumber: "merchant-refund-1",
      money: { currency: "CNY", amountMinor: "200" },
      status: "SUCCEEDED",
      finality: "FINAL",
      attempts: [],
    });

    expect(wowPayment).toMatchObject({
      paymentId: "pay-wow",
      merchantOrderId: "order-1",
      money: { currency: "CNY", amountMinor: "1000" },
      refundBudget: {
        succeededAmount: { amountMinor: "200" },
        reservedAmount: { amountMinor: "100" },
        availableAmount: { amountMinor: "700" },
      },
    });
    expect(capRefund).toMatchObject({
      refundId: "refund-cap",
      merchantRefundId: "merchant-refund-1",
      money: { currency: "CNY", amountMinor: "200" },
    });
  });

  it("WOW 未返回 availableAmount 时按原额减成功与预占精确推导退款余额", () => {
    const payment = mapPayment("wow", {
      paymentId: "pay-budget",
      merchantId: "merchant-1",
      merchantOrderNo: "order-budget",
      amount: { currency: "CNY", amountMinor: "100000000000000000001" },
      paymentMethod: "DEFAULT",
      status: "SUCCEEDED",
      finality: "FINAL",
      successfulRefundAmount: { currency: "CNY", amountMinor: "2" },
      reservedRefundAmount: { currency: "CNY", amountMinor: "3" },
      attempts: [],
    });

    expect(payment.refundBudget).toEqual({
      originalAmount: { currency: "CNY", amountMinor: "100000000000000000001" },
      succeededAmount: { currency: "CNY", amountMinor: "2" },
      reservedAmount: { currency: "CNY", amountMinor: "3" },
      availableAmount: { currency: "CNY", amountMinor: "99999999999999999996" },
    });
  });

  it("退款事实超过原支付金额时拒绝构造负数预算", () => {
    expect(() => mapPayment("wow", {
      paymentId: "pay-invalid-budget",
      merchantId: "merchant-1",
      merchantOrderNo: "order-invalid-budget",
      amount: { currency: "CNY", amountMinor: "100" },
      paymentMethod: "DEFAULT",
      status: "SUCCEEDED",
      finality: "FINAL",
      successfulRefundAmount: { currency: "CNY", amountMinor: "90" },
      reservedRefundAmount: { currency: "CNY", amountMinor: "20" },
      attempts: [],
    })).toThrow("退款预算币种不一致、超过原支付金额或 available 与预算事实不一致");
  });

  it("后端显式 availableAmount 与预算事实不一致时拒绝静默展示", () => {
    expect(() => mapPayment("cap4k", {
      paymentId: "pay-inconsistent-budget",
      merchantId: "merchant-1",
      merchantOrderNumber: "order-inconsistent-budget",
      money: { currency: "CNY", amountMinor: "1000" },
      paymentMethod: "CARD",
      status: "SUCCEEDED",
      finality: "FINAL",
      refundBudget: {
        originalAmount: { currency: "CNY", amountMinor: "1000" },
        succeededAmount: { currency: "CNY", amountMinor: "200" },
        reservedAmount: { currency: "CNY", amountMinor: "100" },
        availableAmount: { currency: "CNY", amountMinor: "1000" },
      },
      attempts: [],
    })).toThrow("available 与预算事实不一致");
  });

  it("把平台事实与账单记录身份保留为统一差异证据", () => {
    const run = mapReconciliationRun("cap4k", {
      runId: "run-1", billIdentity: "bill-1", merchantId: "merchant-1", channelId: "C-001", currency: "CNY", status: "ACTION_REQUIRED", finality: "REVIEW_REQUIRED",
      differences: [{ itemId: "difference-1", differenceType: "AMOUNT_MISMATCH", platformFactIdentity: "PAYMENT:pay-1", channelRecordIdentity: "record-1", resolved: false, settlementBlocked: true }],
    });

    expect(run.differences[0]).toMatchObject({
      differenceType: "AMOUNT_MISMATCH",
      platformEvidenceRefs: [{ evidenceType: "PLATFORM_FACT", evidenceId: "PAYMENT:pay-1" }],
      billEvidenceRefs: [{ evidenceType: "BILL_RECORD", evidenceId: "record-1" }],
    });
  });

  it("将后端 DUPLICATE_CHANNEL_RECORD 归一为统一 DUPLICATE", () => {
    const run = mapReconciliationRun("wow", {
      runId: "run-duplicate",
      statementId: "bill-1",
      merchantId: "merchant-1",
      channelId: "C-001",
      currency: "CNY",
      status: "ACTION_REQUIRED",
      differences: [{ differenceIdentity: "difference-duplicate", differenceType: "DUPLICATE_CHANNEL_RECORD" }],
    });

    expect(run.differences[0]?.differenceType).toBe("DUPLICATE");
    expect(run.source.adapter).toBe("wow");
  });

  it("终态支付与退款仍暴露可信结果收件动作，但不重新开放 attempt 创建", () => {
    const payment = mapPayment("wow", {
      paymentId: "pay-final",
      merchantId: "merchant-1",
      merchantOrderNo: "order-final",
      amount: { currency: "CNY", amountMinor: "100" },
      paymentMethod: "DEFAULT",
      status: "SUCCEEDED",
      finality: "FINAL",
      attempts: [{ attemptId: "attempt-1", channelId: "C-001", status: "SUCCEEDED" }],
    });
    const refund = mapRefund("cap4k", {
      refundId: "refund-final",
      paymentId: "pay-final",
      merchantId: "merchant-1",
      merchantRefundNo: "merchant-refund-final",
      money: { currency: "CNY", amountMinor: "50" },
      status: "SUCCEEDED",
      finality: "FINAL",
      attempts: [{ attemptId: "refund-attempt-1", channelId: "C-001", status: "SUCCEEDED" }],
    });

    expect(payment.actions.find((item) => item.kind === "RECEIVE_PAYMENT_RESULT")).toMatchObject({ executable: true, availability: "full" });
    expect(payment.actions.find((item) => item.kind === "CREATE_PAYMENT_ATTEMPT")).toMatchObject({
      executable: false,
      reason: "当前业务状态不允许创建新 attempt。",
    });
    expect(refund.actions.find((item) => item.kind === "RECEIVE_REFUND_RESULT")).toMatchObject({ executable: true, availability: "full" });
    expect(refund.actions.find((item) => item.kind === "CREATE_REFUND_ATTEMPT")).toMatchObject({
      executable: false,
      reason: "当前业务状态不允许创建新 attempt。",
    });
  });

  it("将 CAP4K Attempt 级受理事实映射为统一 submission receipt，并关闭重复提交", () => {
    const payment = mapPayment("cap4k", {
      paymentId: "pay-cap4k-accepted", merchantId: "merchant-1", merchantOrderNumber: "order-1",
      money: { currency: "CNY", amountMinor: "1000" }, paymentMethod: "CARD", status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{ paymentAttemptId: "payment-attempt-1", channelId: "C-001", status: "ACCEPTED", requestIdentity: "payment-request-1", acceptedAt: "2026-09-28T00:00:00Z" }],
    });
    const refund = mapRefund("cap4k", {
      refundId: "refund-cap4k-accepted", paymentId: payment.paymentId, merchantId: "merchant-1", merchantRefundNumber: "refund-1",
      money: { currency: "CNY", amountMinor: "200" }, status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{ refundAttemptId: "refund-attempt-1", channelId: "C-001", status: "ACCEPTED", requestIdentity: "refund-request-1", acceptedAt: "2026-09-28T00:00:00Z", channelRefundId: "channel-refund-1" }],
    });

    expect(payment.attempts[0]?.submissions[0]).toMatchObject({
      submissionId: "payment-request-1", requestIdentity: "payment-request-1", channelId: "C-001", outcome: "ACCEPTED",
    });
    expect(refund.attempts[0]?.submissions[0]).toMatchObject({
      submissionId: "refund-request-1", requestIdentity: "refund-request-1", channelReference: "channel-refund-1", outcome: "ACCEPTED",
    });
    expect(payment.actions.find((item) => item.kind === "SUBMIT_PAYMENT_ATTEMPT")).toMatchObject({ executable: false, reason: "当前 attempt 已提交，请等待结果。" });
    expect(refund.actions.find((item) => item.kind === "SUBMIT_REFUND_ATTEMPT")).toMatchObject({ executable: false, reason: "当前 attempt 已提交，请等待结果。" });
  });

  it("WOW 创建后 PROCESSING 的支付与退款 attempt 只有 requestIdentity 时仍可提交", () => {
    const payment = mapPayment("wow", {
      paymentId: "pay-wow-created", merchantId: "merchant-1", merchantOrderNo: "order-created",
      amount: { currency: "CNY", amountMinor: "1000" }, paymentMethod: "DEFAULT", status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{ attemptId: "payment-attempt-created", channelId: "fake", status: "PROCESSING", requestIdentity: "payment-create-request" }],
    });
    const refund = mapRefund("wow", {
      refundId: "refund-wow-created", paymentId: payment.paymentId, merchantId: "merchant-1", merchantRefundNo: "refund-created",
      amount: { currency: "CNY", amountMinor: "200" }, status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{ attemptId: "refund-attempt-created", channelId: "fake", status: "PROCESSING", requestIdentity: "refund-create-request" }],
    });

    expect(payment.attempts[0]?.submissions).toEqual([]);
    expect(refund.attempts[0]?.submissions).toEqual([]);
    expect(payment.actions.find((item) => item.kind === "SUBMIT_PAYMENT_ATTEMPT")).toMatchObject({ executable: true });
    expect(refund.actions.find((item) => item.kind === "SUBMIT_REFUND_ATTEMPT")).toMatchObject({ executable: true });
  });

  it("明确的提交字段或权威回执仍保留支付与退款提交历史", () => {
    const payment = mapPayment("wow", {
      paymentId: "pay-wow-submitted", merchantId: "merchant-1", merchantOrderNo: "order-submitted",
      amount: { currency: "CNY", amountMinor: "1000" }, paymentMethod: "DEFAULT", status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{
        attemptId: "payment-attempt-submitted", channelId: "fake", status: "PROCESSING",
        requestIdentity: "payment-create-request", submittedAt: "2026-09-28T01:00:00Z",
      }],
    });
    const refund = mapRefund("wow", {
      refundId: "refund-wow-submitted", paymentId: payment.paymentId, merchantId: "merchant-1", merchantRefundNo: "refund-submitted",
      amount: { currency: "CNY", amountMinor: "200" }, status: "PROCESSING", finality: "NON_FINAL",
      attempts: [{
        attemptId: "refund-attempt-submitted", channelId: "fake", status: "PROCESSING",
        requestIdentity: "refund-create-request",
        submissionReceipts: [{
          submissionIdentity: "refund-submission-1", requestIdentity: "refund-create-request",
          channelId: "fake", outcome: "ACCEPTED", submittedAt: "2026-09-28T01:00:00Z",
        }],
      }],
    });

    expect(payment.attempts[0]?.submissions).toHaveLength(1);
    expect(payment.attempts[0]?.submissions[0]).toMatchObject({ submittedAt: "2026-09-28T01:00:00Z" });
    expect(refund.attempts[0]?.submissions).toMatchObject([{ submissionId: "refund-submission-1", outcome: "ACCEPTED" }]);
    expect(payment.actions.find((item) => item.kind === "SUBMIT_PAYMENT_ATTEMPT")).toMatchObject({ executable: false });
    expect(refund.actions.find((item) => item.kind === "SUBMIT_REFUND_ATTEMPT")).toMatchObject({ executable: false });
  });

  it("CAP4K Attempt 进入终态后仍保留提交历史，未提交 Attempt 不伪造回执", () => {
    const payment = mapPayment("cap4k", {
      paymentId: "pay-terminal", merchantId: "merchant-1", merchantOrderNumber: "order-terminal",
      money: { currency: "CNY", amountMinor: "1000" }, paymentMethod: "CARD", status: "SUCCEEDED", finality: "FINAL",
      attempts: [
        { paymentAttemptId: "payment-succeeded", channelId: "C-001", status: "SUCCEEDED", requestIdentity: "payment-request-1", acceptedAt: "2026-09-28T00:00:00Z" },
        { paymentAttemptId: "payment-created", channelId: "C-001", status: "CREATED", requestIdentity: "creation-only" },
      ],
    });
    const refund = mapRefund("cap4k", {
      refundId: "refund-terminal", paymentId: payment.paymentId, merchantId: "merchant-1", merchantRefundNumber: "refund-terminal",
      money: { currency: "CNY", amountMinor: "200" }, status: "FAILED", finality: "FINAL",
      attempts: [
        { refundAttemptId: "refund-failed", channelId: "C-001", status: "FAILED", submissionIdentity: "refund-submission-1", channelRefundId: "channel-refund-1" },
        { refundAttemptId: "refund-created", channelId: "C-001", status: "CREATED" },
      ],
    });

    expect(payment.attempts[0]?.submissions).toMatchObject([{ submissionId: "payment-request-1", requestIdentity: "payment-request-1" }]);
    expect(payment.attempts[1]?.submissions).toEqual([]);
    expect(refund.attempts[0]?.submissions).toMatchObject([{ submissionId: "refund-submission-1", channelReference: "channel-refund-1" }]);
    expect(refund.attempts[1]?.submissions).toEqual([]);
  });
});

describe("适配器注册与支付命令", () => {
  it("只在集中工厂按配置选择适配器", () => {
    expect(createPaymentBackendAdapter({ backend: "wow", apiBaseUrl: "/api" })).toBeInstanceOf(WowPaymentAdapter);
    expect(createPaymentBackendAdapter({ backend: "cap4k", apiBaseUrl: "/api" })).toBeInstanceOf(Cap4kPaymentAdapter);
  });

  it("用 full/alternative/unavailable 诚实声明细粒度传输能力", () => {
    const wow = new WowPaymentAdapter({ apiBaseUrl: "/backend/api" });
    const cap4k = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api" });
    const capability = (adapter: WowPaymentAdapter | Cap4kPaymentAdapter, id: string) =>
      adapter.profile.capabilities.find((item) => item.id === id);

    expect(capability(wow, "bill-detail")?.level).toBe("full");
    expect(capability(wow, "channel-script")).toMatchObject({ level: "full" });
    expect(capability(wow, "reference-lab")).toMatchObject({ level: "full" });
    expect(capability(cap4k, "bill-detail")).toMatchObject({ level: "full" });
    expect(capability(cap4k, "payment-close-expired")).toMatchObject({ level: "full" });
    expect(capability(cap4k, "channel-script")?.level).toBe("full");
    expect(capability(cap4k, "reference-lab")).toMatchObject({ level: "full" });
    expect(capability(wow, "settlement-execution-identity")).toMatchObject({ level: "full" });
    expect(capability(cap4k, "settlement-execution-identity")).toMatchObject({ level: "full" });
  });

  it("CAP4K 结算执行使用统一命令明确提供的非默认渠道，不在适配器硬编码渠道", async () => {
    const mock = recordedFetch(() => nestedReceipt("Settlement", "settlement-channel-scope"));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.execute({
      type: "EXECUTE_SETTLEMENT",
      input: {
        settlementId: "settlement-channel-scope",
        merchantId: "merchant-1",
        executionId: "execution-1",
        channelId: "CHANNEL-NON-DEFAULT",
        idempotencyKey: "execute-1",
      },
    });

    expect(mock.calls[0]).toMatchObject({
      url: "/backend/api/merchant-settlements/settlement-channel-scope/executions",
      init: { method: "POST" },
      body: {
        merchantId: "merchant-1",
        executionId: "execution-1",
        executionChannelId: "CHANNEL-NON-DEFAULT",
        idempotencyKey: "execute-1",
      },
    });
  });

  it("CAP4K reference environment 按责任类型公开可信 actor aliases", async () => {
    const mock = recordedFetch((call) => call.url.endsWith("/policy")
      ? { policy: { businessTimezone: "Asia/Shanghai" } }
      : { instant: "2026-09-25T00:00:00Z" });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const environment = await adapter.getReferenceEnvironment();

    expect(environment.actorAliases).toEqual({
      paymentReviewer: "fixture-payment-reviewer",
      refundReviewer: "fixture-refund-reviewer",
      reconciliationOperator: "fixture-reconciliation-operator",
      settlementOperator: "fixture-settlement-operator",
      settlementReviewer: "fixture-settlement-reviewer",
    });
  });

  it("WOW reference environment 以零时长时钟响应读取当前时间，保留其他 fixture 映射", async () => {
    const mock = recordedFetch((call) => call.init.method === "GET"
      ? {
        fixtureId: "fixture/a",
        initialTime: "2024-01-01T00:00:00Z",
        allowedChannelIds: ["channel-1"],
        policy: { paymentExpiry: "PT10M" },
      }
      : { fixtureId: "fixture/a", instant: "2047-01-01T00:00:00Z" });
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const environment = await adapter.getReferenceEnvironment("fixture/a");

    expect(environment).toMatchObject({
      fixtureId: "fixture/a",
      actorAlias: "finance-operator",
      currentTime: "2047-01-01T00:00:00Z",
      policy: { paymentExpiry: "PT10M" },
      channelId: "channel-1",
      merchantId: "reference-merchant",
      paymentMethod: "DEFAULT",
    });
    expect(mock.calls).toMatchObject([
      { url: "/backend/api/reference/fixtures/fixture%2Fa", init: { method: "GET" } },
      {
        url: "/backend/api/reference/fixtures/fixture%2Fa/clock",
        init: { method: "POST" },
        body: { advanceBy: "PT0S" },
      },
    ]);
    expect(mock.calls).toHaveLength(2);
  });

  it("WOW 设置与推进时钟沿用 fixture clock 路由并返回服务端时间", async () => {
    const mock = recordedFetch((call) => ({
      fixtureId: "fixture/a",
      instant: call.body?.instant ?? "2047-01-01T02:00:00Z",
    }));
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const set = await adapter.executeReference({
      type: "SET_CLOCK",
      input: { fixtureId: "fixture/a", instant: "2047-01-01T00:00:00Z" },
    });
    const advanced = await adapter.executeReference({
      type: "ADVANCE_CLOCK",
      input: { fixtureId: "fixture/a", duration: "PT2H" },
    });

    expect(set).toMatchObject({ effect: "applied", data: { fixtureId: "fixture/a", instant: "2047-01-01T00:00:00Z" } });
    expect(advanced).toMatchObject({ effect: "applied", data: { fixtureId: "fixture/a", instant: "2047-01-01T02:00:00Z" } });
    expect(mock.calls).toMatchObject([
      { url: "/backend/api/reference/fixtures/fixture%2Fa/clock", init: { method: "POST" }, body: { instant: "2047-01-01T00:00:00Z" } },
      { url: "/backend/api/reference/fixtures/fixture%2Fa/clock", init: { method: "POST" }, body: { advanceBy: "PT2H" } },
    ]);
    expect(mock.calls).toHaveLength(2);
  });

  it("WOW 使用 merchantOrderNo、POLL receipt 与 amount Money 对象", async () => {
    const mock = recordedFetch(() => flatReceipt("Payment", "pay-wow"));
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl, fixtureId: "fixture-a" });

    const receipt = await adapter.execute(createPayment);

    expect(receipt).toMatchObject({ resource: { resourceId: "pay-wow" }, readAfter: { mode: "POLL" } });
    expect(mock.calls[0]).toMatchObject({
      url: "/backend/api/payments",
      init: { method: "POST" },
      body: {
        merchantId: "merchant-1",
        merchantOrderNo: "order-1",
        idempotencyKey: "idem-1",
        amount: { currency: "CNY", amountMinor: "1234" },
        paymentMethod: "DEFAULT",
        expiresAt: "2026-09-25T12:00:00Z",
        fixtureId: "fixture-a",
      },
    });
  });

  it("CAP4K 使用 merchantOrderNumber、READ_ONCE receipt 与 money Money 对象", async () => {
    const mock = recordedFetch(() => nestedReceipt("Payment", "pay-cap"));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const receipt = await adapter.execute(createPayment);

    expect(receipt).toMatchObject({ resource: { resourceId: "pay-cap" }, readAfter: { mode: "READ_ONCE" } });
    expect(mock.calls[0]).toMatchObject({
      url: "/backend/api/payments",
      init: { method: "POST" },
      body: {
        merchantId: "merchant-1",
        merchantOrderNumber: "order-1",
        idempotencyKey: "idem-1",
        money: { currency: "CNY", amountMinor: "1234" },
        paymentMethod: "DEFAULT",
      },
    });
    expect(mock.calls[0]?.body).not.toHaveProperty("expiresAt");
  });

  it("CAP4K 对单支付到期和权威账单详情提供完整传输", async () => {
    const billResourceId = "01900000-0000-7000-8000-000000000001";
    const mock = recordedFetch((call) => call.url.includes("/authoritative-bills/") ? {
      billId: billResourceId,
      billIdentity: "bill-1",
      channelId: "C-001",
      currency: "CNY",
      businessDate: "2026-09-25",
      currentRevision: "1",
      currentRevisionId: "revision-1",
      revisions: [{
        revisionId: "revision-1",
        revision: "1",
        completeness: "COMPLETE",
        payloadFingerprint: "fingerprint-1",
        rawEvidence: "evidence://bill-1/revision-1",
        records: [],
      }],
    } : {
      paymentId: "pay-cap",
      merchantId: "merchant-1",
      merchantOrderNumber: "order-1",
      money: { currency: "CNY", amountMinor: "1234" },
      paymentMethod: "CARD",
      status: "PAYABLE",
      finality: "NON_FINAL",
      attempts: [],
    });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const payment = await adapter.getPayment("pay-cap");

    expect(payment.actions.find((item) => item.kind === "CLOSE_EXPIRED_PAYMENT")).toMatchObject({ executable: true, availability: "full" });
    await expect(adapter.getBill(billResourceId)).resolves.toMatchObject({
      billId: "bill-1",
      currentRevision: "1",
      revisions: [{ revision: "1", completeness: "COMPLETE", payloadFingerprint: "fingerprint-1" }],
    });
    expect(mock.calls).toHaveLength(2);
  });

  it("CAP4K 用不可执行 alternative action 表达自动完成 Run，而不是伪造 complete receipt", async () => {
    const mock = recordedFetch(() => ({
      runId: "run-1",
      billIdentity: "bill-1",
      channelId: "C-001",
      currency: "CNY",
      status: "ACTION_REQUIRED",
      finality: "REVIEW_REQUIRED",
      differences: [],
    }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const run = await adapter.getReconciliationRun("run-1");

    expect(run.actions.find((item) => item.kind === "COMPLETE_RECONCILIATION")).toMatchObject({
      executable: false,
      availability: "alternative",
      alternative: expect.stringContaining("自动收敛"),
    });
    expect(mock.calls).toHaveLength(1);
  });

  it("CAP4K 初始化环境时在 reset 后写入 policy，并把统一渠道结果映射为后端脚本", async () => {
    const mock = recordedFetch(() => ({}));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.executeReference({
      type: "REGISTER_ENVIRONMENT",
      input: { fixtureId: "fixture-a", merchantId: "merchant-1", channelId: "C-001", actorAlias: "fixture-operator", paymentMethod: "CARD", currentTime: "2026-09-25T00:00:00Z", policy: { paymentExpiry: "PT10M", feeRate: "0.01" } },
    });
    await adapter.executeReference({ type: "CONFIGURE_CHANNEL", input: { fixtureId: "fixture-a", channelId: "C-001", outcome: "SUCCESS" } });

    expect(mock.calls.slice(0, 2).map((call) => call.url)).toEqual([
      "/backend/api/reference-fixtures/policy/reset",
      "/backend/api/reference-fixtures/policy",
    ]);
    expect(mock.calls[1]?.body).toMatchObject({ paymentExpiry: "PT10M", feeRate: "0.01" });
    expect(mock.calls.at(-1)).toMatchObject({
      url: "/backend/api/reference-fixtures/payment-channel-script",
      body: { channelId: "C-001", script: "ACCEPT_THEN_SUCCESS" },
    });
  });

  it("WOW 渠道脚本命令调用真实 reference 控制面", async () => {
    const mock = recordedFetch(() => ({}));
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const result = await adapter.executeReference({
      type: "CONFIGURE_CHANNEL",
      input: { fixtureId: "fixture-a", channelId: "C-001", outcome: "FAILURE" },
    });

    expect(result.effect).toBe("applied");
    expect(mock.calls[0]).toMatchObject({
      url: "/backend/api/reference/payment-channel-scripts/C-001",
      init: { method: "POST" },
      body: { fixtureId: "fixture-a", script: "ACCEPT_THEN_FAILURE" },
    });
  });

  it("CAP4K 透传账单暂不可读脚本，并提供通知 sender 脚本控制面", async () => {
    const mock = recordedFetch((call) => call.url.endsWith("/reference-fixtures/bills")
      ? { billId: "01900000-0000-7000-8000-000000000001", billIdentity: "bill-scripted" }
      : {});
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.executeReference({
      type: "REGISTER_BILL",
      input: {
        billId: "bill-scripted",
        revision: 1,
        merchantId: "merchant-1",
        channelId: "C-001",
        currency: "CNY",
        businessDate: "2026-09-25",
        businessTimezone: "Asia/Shanghai",
        idempotencyKey: "bill-scripted-1",
        unavailableReadCount: 2,
        records: [],
      },
    });
    await adapter.executeReference({
      type: "CONFIGURE_NOTIFICATION_SENDER",
      input: { fixtureId: "fixture-a", notificationId: "notification-1", outcome: "RESULT_UNKNOWN" },
    });

    expect(mock.calls[0]).toMatchObject({
      url: "/backend/api/reference-fixtures/bills",
      body: { billIdentity: "bill-scripted", unavailableReadCount: 2 },
    });
    expect(mock.calls[1]).toMatchObject({
      url: "/backend/api/reference-fixtures/merchant-notification-sender-script",
      body: { notificationIdentity: "notification-1", script: "RESULT_UNKNOWN" },
    });
  });

  it("WOW 登记账单时配置 provider 脚本，并调用通知 sender 控制面", async () => {
    const mock = recordedFetch((_call, index) => index === 0 ? flatReceipt("AuthoritativeBillRevision", "bill-scripted:1") : {});
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const billResult = await adapter.executeReference({
      type: "REGISTER_BILL",
      input: {
        billId: "bill-scripted",
        revision: 1,
        merchantId: "merchant-1",
        channelId: "fake",
        currency: "CNY",
        businessDate: "2026-09-25",
        businessTimezone: "Asia/Shanghai",
        idempotencyKey: "bill-scripted-1",
        unavailableReadCount: 2,
        records: [],
      },
    });
    const notificationResult = await adapter.executeReference({
      type: "CONFIGURE_NOTIFICATION_SENDER",
      input: { fixtureId: "fixture-a", notificationId: "notification-1", outcome: "FAILURE" },
    });

    expect(billResult.effect).toBe("applied");
    expect(notificationResult.effect).toBe("applied");
    expect(mock.calls).toMatchObject([
      { url: "/backend/api/reference/statements", init: { method: "POST" } },
      {
        url: "/backend/api/reference/bill-provider-scripts/bill-scripted/revisions/1",
        init: { method: "POST" },
        body: { fixtureId: "reference-default", unavailableReadCount: 2 },
      },
      {
        url: "/backend/api/reference/notification-sender-scripts",
        init: { method: "POST" },
        body: { fixtureId: "fixture-a", selector: { notificationId: "notification-1" }, script: "FAILURE" },
      },
    ]);
  });
});

describe("退款与对账责任命令", () => {
  it("同一退款申请分别映射 WOW payment 子资源与 CAP4K refund collection", async () => {
    const wowMock = recordedFetch(() => flatReceipt("Refund", "refund-wow"));
    const capMock = recordedFetch(() => nestedReceipt("Refund", "refund-cap"));
    const command: BusinessCommand = {
      type: "REQUEST_REFUND",
      input: {
        merchantId: "merchant-1",
        paymentId: "pay-1",
        merchantRefundId: "merchant-refund-1",
        idempotencyKey: "refund-idem-1",
        money: createMoney("CNY", "234"),
        reason: "部分退款",
      },
    };

    await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl, fixtureId: "fixture-a" }).execute(command);
    await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command);

    expect(wowMock.calls[0]).toMatchObject({
      url: "/backend/api/payments/pay-1/refunds",
      body: {
        merchantId: "merchant-1",
        merchantRefundNo: "merchant-refund-1",
        amount: { currency: "CNY", amountMinor: "234" },
        reason: "部分退款",
        fixtureId: "fixture-a",
      },
    });
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/refunds",
      body: {
        merchantId: "merchant-1",
        paymentId: "pay-1",
        merchantRefundNo: "merchant-refund-1",
        money: { currency: "CNY", amountMinor: "234" },
        reason: "部分退款",
      },
    });
  });

  it("统一对账 scope 原样进入 CAP4K signal，而 WOW 只在适配器内忽略不需要的字段", async () => {
    const wowMock = recordedFetch(() => flatReceipt("ReconciliationRun", "run-scope"));
    const capMock = recordedFetch((_call, index) => index === 0
      ? { runId: "run-scope" }
      : nestedReceipt("ReconciliationRun", "run-scope"));
    const command: BusinessCommand = {
      type: "RUN_RECONCILIATION",
      input: {
        merchantId: "merchant-scope",
        billId: "bill-scope",
        revision: 7,
        channelId: "CHANNEL-NON-DEFAULT",
        currency: "USD",
        businessDate: "2026-10-17",
        businessTimezone: "America/New_York",
        publishedAt: "2026-10-17T16:00:00Z",
        idempotencyKey: "run-scope-7",
      },
    };

    await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).execute(command);
    await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command);

    expect(wowMock.calls[0]).toMatchObject({
      url: "/backend/api/reconciliation-runs",
      body: { merchantId: "merchant-scope", statementId: "bill-scope", revision: 7, idempotencyKey: "run-scope-7" },
    });
    expect(wowMock.calls[0]?.body).not.toHaveProperty("channelId");
    expect(wowMock.calls[0]?.body).not.toHaveProperty("currency");
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/reference-fixtures/bills/bill-scope/signals",
      body: {
        channelId: "CHANNEL-NON-DEFAULT",
        currency: "USD",
        businessDate: "2026-10-17",
        businessTimezone: "America/New_York",
        signalIdentity: "signal:bill-scope:7:run-scope-7",
        announcedRevision: "7",
        publishedAt: "2026-10-17T16:00:00Z",
      },
    });
    expect(capMock.calls[1]?.url).toBe("/backend/api/reconciliation-runs/run-scope/reruns");
  });

  it("对账处置在 WOW body 与 CAP4K actor header 中保留责任事实", async () => {
    const wowMock = recordedFetch(() => flatReceipt("ReconciliationRun", "run-1"));
    const capMock = recordedFetch(() => nestedReceipt("ReconciliationRun", "run-1"));
    const command: BusinessCommand = {
      type: "DISPOSE_RECONCILIATION_DIFFERENCE",
      input: {
        runId: "run-1",
        differenceId: "difference-1",
        revision: 3,
        merchantId: "merchant-1",
        actorAlias: "fixture-reconciliation-operator",
        actorRole: "RECONCILIATION_REVIEWER",
        conclusion: "ACCEPT_DIFFERENCE",
        settlementImpact: "ALLOW",
        reason: "账单证据与渠道流水一致",
        evidenceRefs: ["bill:3", "channel:txn-1"],
        idempotencyKey: "dispose-1",
      },
    };

    await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).execute(command);
    await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command);

    expect(wowMock.calls[0]).toMatchObject({
      url: "/backend/api/reconciliation-runs/run-1/differences/dispositions",
      body: {
        differenceIdentity: "difference-1",
        revision: 3,
        actorId: "fixture-reconciliation-operator",
        actorRole: "RECONCILIATION_REVIEWER",
        conclusion: "ACCEPT_DIFFERENCE",
        settlementImpact: "NONE",
        reason: "账单证据与渠道流水一致",
        evidenceRefs: ["bill:3", "channel:txn-1"],
      },
    });
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/reconciliation-runs/run-1/differences/difference-1/dispositions",
      body: {
        conclusion: "NO_SETTLEMENT_IMPACT",
        settlementImpact: "DOES_NOT_BLOCK_SETTLEMENT",
        reason: "账单证据与渠道流水一致",
        evidence: "bill:3\nchannel:txn-1",
      },
    });
    expect(new Headers(capMock.calls[0]?.init.headers).get("X-Reference-Actor-Context")).toBe("fixture-reconciliation-operator");
  });
});

describe("权威 keyset 列表", () => {
  const request: PageRequest = {
    filters: { merchantId: "merchant-1", resourceId: "resource-1" },
    cursor: "opaque:+/=%:cursor",
    pageSize: 2,
  };

  it("WOW 五类列表全部使用 GET collection、query filter 与原样 cursor", async () => {
    const mock = recordedFetch(() => ({ items: [], nextCursor: "opaque-next", pageSize: 2 }));
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl, fixtureId: "fixture-a" });

    const pages = await Promise.all([
      adapter.listPayments(request),
      adapter.listRefunds(request),
      adapter.listReconciliationRuns(request),
      adapter.listSettlements(request),
      adapter.listManualReviews(request),
    ]);

    expect(pages.every((page) => page.nextCursor === "opaque-next")).toBe(true);
    expect(mock.calls.map((call) => call.init.method)).toEqual(["GET", "GET", "GET", "GET", "GET"]);
    expect(mock.calls.map((call) => call.url.split("?")[0])).toEqual([
      "/backend/api/payments",
      "/backend/api/refunds",
      "/backend/api/reconciliation-runs",
      "/backend/api/settlements",
      "/backend/api/manual-reviews",
    ]);
    expect(mock.calls.map((call) => new URL(call.url, "http://workbench.test").searchParams.get("cursor")))
      .toEqual(Array(5).fill("opaque:+/=%:cursor"));
    expect(new URL(mock.calls[0]!.url, "http://workbench.test").searchParams.get("paymentId")).toBe("resource-1");
    expect(new URL(mock.calls[4]!.url, "http://workbench.test").searchParams.get("reviewId")).toBe("resource-1");
  });

  it("CAP4K 五类列表全部使用 POST /search，并在 JSON body 原样传递 cursor", async () => {
    const mock = recordedFetch(() => ({ items: [], nextCursor: "opaque-next", pageSize: 2 }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await Promise.all([
      adapter.listPayments(request),
      adapter.listRefunds(request),
      adapter.listReconciliationRuns(request),
      adapter.listSettlements(request),
      adapter.listManualReviews(request),
    ]);

    expect(mock.calls.map((call) => call.url)).toEqual([
      "/backend/api/payments/search",
      "/backend/api/refunds/search",
      "/backend/api/reconciliation-runs/search",
      "/backend/api/merchant-settlements/search",
      "/backend/api/manual-reviews/search",
    ]);
    expect(mock.calls.every((call) => call.init.method === "POST")).toBe(true);
    expect(mock.calls.every((call) => call.body?.cursor === "opaque:+/=%:cursor" && call.body?.pageSize === 2)).toBe(true);
    expect(mock.calls[0]?.body).toMatchObject({ merchantId: "merchant-1", paymentId: "resource-1" });
    expect(mock.calls[4]?.body).toMatchObject({ merchantId: "merchant-1", reviewId: "resource-1" });
  });

  it("CAP4K 对账响应映射渠道级 scope，且不从查询条件伪造单一 merchantId", async () => {
    const runWire = { runId: "run-1", billIdentity: "bill-1", channelId: "C-001", currency: "CNY", businessDate: "2026-09-25", businessTimezone: "Asia/Shanghai", status: "COMPLETED", finality: "FINAL", differences: [] };
    const mock = recordedFetch((call) => call.url.endsWith("/search") ? { items: [runWire], nextCursor: null, pageSize: 1 } : runWire);
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const page = await adapter.listReconciliationRuns({ filters: { merchantId: "merchant-1" }, pageSize: 1 });
    const detail = await adapter.getReconciliationRun("run-1");

    expect(mock.calls[0]?.body?.merchantId).toBe("merchant-1");
    expect(page.items[0]?.merchantIds).toEqual([]);
    expect(detail.merchantIds).toEqual([]);
    expect(detail.scope).toEqual({ channelId: "C-001", currency: "CNY", businessDate: "2026-09-25", businessTimezone: "Asia/Shanghai" });
  });

  it("CAP4K Run 列表用详情中的业务 billIdentity 替换搜索摘要的内部 billId", async () => {
    const summary = {
      runId: "run-1", billId: "01900000-0000-7000-8000-000000000001",
      channelId: "C-001", currency: "CNY", businessDate: "2026-09-25",
      status: "COMPLETED", finality: "FINAL", differences: [],
    };
    const detail = {
      runId: "run-1", billIdentity: "reference-bill-1",
      channelId: "C-001", currency: "CNY", businessDate: "2026-09-25",
      businessTimezone: "Asia/Shanghai", status: "COMPLETED", finality: "FINAL", differences: [],
    };
    const mock = recordedFetch((call) => call.url.endsWith("/search")
      ? { items: [summary], nextCursor: null, pageSize: 1 }
      : detail);
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const page = await adapter.listReconciliationRuns({ filters: { merchantId: "merchant-1" }, pageSize: 1 });

    expect(page.items[0]?.billId).toBe("reference-bill-1");
    expect(mock.calls.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", "/backend/api/reconciliation-runs/search"],
      ["GET", "/backend/api/reconciliation-runs/run-1"],
    ]);
  });

  it("CAP4K 未提供 merchant 筛选时用空值请求全部关联 Run，不偷偷限定 reference-merchant", async () => {
    const mock = recordedFetch(() => ({ items: [], nextCursor: null, pageSize: 20 }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.listReconciliationRuns({ pageSize: 20 });

    expect(mock.calls[0]?.body?.merchantId).toBe("");
  });
});

describe("可信 callback evidence 与责任上下文", () => {
  it("WOW 先获取 fixture token，再提交同一 canonical result 且不接受 verified 自报", async () => {
    const mock = recordedFetch((call) => call.url.endsWith("/tokens")
      ? { verificationToken: "server-token" }
      : flatReceipt("Payment", "pay-1"));
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl, fixtureId: "fixture-a" });

    await adapter.execute(paymentResult);

    expect(mock.calls.map((call) => call.url)).toEqual([
      "/backend/api/reference/fixtures/fixture-a/tokens",
      "/backend/api/payments/pay-1/results",
    ]);
    expect(mock.calls[0]?.body).toMatchObject({ resultIdentity: "result-1", attemptRef: "attempt-1", outcome: "SUCCEEDED" });
    expect(mock.calls[1]?.body).toMatchObject({ resultIdentity: "result-1", verificationToken: "server-token", fixtureId: "fixture-a" });
    expect(mock.calls[1]?.body).not.toHaveProperty("verified");
  });

  it("CAP4K 先登记 callback-evidence，再提交关联一致的支付 callback", async () => {
    const mock = recordedFetch((call) => call.url.endsWith("/callback-evidence")
      ? { registered: true }
      : nestedReceipt("Payment", "pay-1"));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    await adapter.execute(paymentResult);

    expect(mock.calls.map((call) => call.url)).toEqual([
      "/backend/api/reference-fixtures/callback-evidence",
      "/backend/api/channel/payment-results",
    ]);
    expect(mock.calls[0]?.body).toMatchObject({
      kind: "PAYMENT",
      externalIdentity: "result-1",
      associationIdentity: "pay-1|attempt-1|txn-1",
      rawPayload: "canonical-result-payload",
    });
    expect(mock.calls[1]?.body).toMatchObject({
      notificationId: "result-1",
      paymentId: "pay-1",
      paymentAttemptId: "attempt-1",
      channelTransactionId: "txn-1",
      rawPayload: "canonical-result-payload",
    });
    expect(mock.calls[1]?.body).not.toHaveProperty("verified");
    expect(mock.calls[1]?.body).not.toHaveProperty("verificationMaterial");
  });

  it("WOW 把责任人放入 body；CAP4K 只通过可信 alias header 传递责任上下文", async () => {
    const wowMock = recordedFetch(() => flatReceipt("ManualReviewItem", "review-1"));
    const capMock = recordedFetch(() => nestedReceipt("ManualReviewItem", "review-1"));
    const command: BusinessCommand = {
      type: "RESOLVE_MANUAL_REVIEW",
      input: {
        reviewId: "review-1",
        reviewType: "PAYMENT_REVIEW",
        merchantId: "merchant-1",
        outcome: "CONFIRM_SUCCESS",
        actorAlias: "fixture-payment-reviewer",
        reason: "已核对渠道证据",
        evidenceRefs: ["evidence-1"],
        idempotencyKey: "resolve-1",
      },
    };

    await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).execute(command);
    await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command);

    expect(wowMock.calls[0]).toMatchObject({
      url: "/backend/api/manual-reviews/review-1/resolve",
      body: { actorId: "fixture-payment-reviewer", outcome: "ACCEPT_SUCCESS", reason: "已核对渠道证据", evidenceRefs: ["evidence-1"] },
    });
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/manual-reviews/review-1/resolutions",
      body: { outcome: "ACCEPT_LATE_SUCCESS", reason: "已核对渠道证据", evidence: "evidence-1" },
    });
    expect(new Headers(capMock.calls[0]?.init.headers).get("X-Reference-Actor-Context")).toBe("fixture-payment-reviewer");
    expect(capMock.calls[0]?.body).not.toHaveProperty("actorId");
  });

  it("两个 adapter 都在发 HTTP 前同步拒绝缺失的可信 actor context", async () => {
    const wowMock = recordedFetch(() => flatReceipt("ManualReviewItem", "review-1"));
    const capMock = recordedFetch(() => nestedReceipt("ManualReviewItem", "review-1"));
    const command: BusinessCommand = {
      type: "RESOLVE_MANUAL_REVIEW",
      input: {
        reviewId: "review-1",
        merchantId: "merchant-1",
        outcome: "CONFIRMED_SUCCESS",
        reason: "已核对渠道证据",
        evidenceRefs: ["evidence-1"],
        idempotencyKey: "resolve-missing-actor",
      },
    };

    await expect(new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).execute(command))
      .rejects.toMatchObject({ code: "RESPONSIBILITY_ACTOR_REQUIRED", retryable: false });
    await expect(new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command))
      .rejects.toMatchObject({ code: "RESPONSIBILITY_ACTOR_REQUIRED", retryable: false });
    expect(wowMock.calls).toHaveLength(0);
    expect(capMock.calls).toHaveLength(0);
  });
});

describe("时间线与结算组合差异", () => {
  it("timeline 路径差异留在 adapter，且统一排序 recordedAt/eventId", async () => {
    const timeline = {
      paymentId: "pay-1",
      items: [
        { eventId: "event-b", category: "RESULT", recordedAt: "2026-09-25T01:02:00Z" },
        { eventId: "event-a", category: "SUBMISSION", recordedAt: "2026-09-25T01:01:00Z" },
      ],
      nextCursor: "timeline-next",
      pageSize: 2,
    };
    const wowMock = recordedFetch(() => timeline);
    const capMock = recordedFetch(() => timeline);

    const wow = await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).getPaymentTimeline("pay-1");
    const cap4k = await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).getPaymentTimeline("pay-1", { cursor: "timeline-cursor", pageSize: 2 });

    expect(wowMock.calls[0]?.url).toBe("/backend/api/payments/pay-1/trace");
    expect(capMock.calls[0]?.url).toBe("/backend/api/payments/pay-1/timeline?pageSize=2&cursor=timeline-cursor");
    expect(wow.entries.map((entry) => entry.eventId)).toEqual(["event-a", "event-b"]);
    expect(cap4k.nextCursor).toBe("timeline-next");
  });

  it("通知查询路径差异留在 adapter，并映射成同一通知 Page", async () => {
    const notification = {
      notificationId: "notification-1",
      merchantId: "merchant-1",
      contentIdentity: "content-1",
      status: "DELIVERED",
      deliveryAttempts: [],
    };
    const wowMock = recordedFetch(() => [notification]);
    const capMock = recordedFetch(() => ({ items: [notification], nextCursor: "notification-next", pageSize: 1 }));

    const wow = await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl })
      .listNotifications({ filters: { merchantId: "merchant-1" } });
    const cap4k = await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl })
      .listNotifications({ filters: { merchantId: "merchant-1" }, cursor: "notification-cursor", pageSize: 1 });

    expect(wowMock.calls[0]?.url).toBe("/backend/api/notifications?merchantId=merchant-1");
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/merchant-notifications/search",
      body: { merchantId: "merchant-1", cursor: "notification-cursor", pageSize: 1 },
    });
    expect(wow.items[0]).toMatchObject({ notificationId: "notification-1", status: "DELIVERED" });
    expect(cap4k).toMatchObject({ nextCursor: "notification-next", items: [{ notificationId: "notification-1" }] });
  });

  it("明确执行失败后重新开放新 execution，并仅在原单可作废状态开放一步 replacement", async () => {
    const ready = mapSettlement("wow", {
      settlementId: "settlement-ready",
      merchantId: "merchant-1",
      currency: "CNY",
      status: "READY_FOR_CONFIRMATION",
      finality: "NON_FINAL",
      netAmount: { currency: "CNY", amountMinor: "100" },
      items: [],
      executions: [],
    });
    const failed = mapSettlement("wow", {
      settlementId: "settlement-failed",
      merchantId: "merchant-1",
      currency: "CNY",
      status: "EXECUTION_FAILED",
      finality: "NON_FINAL",
      netAmount: { currency: "CNY", amountMinor: "100" },
      items: [],
      executions: [],
    });
    expect(ready.actions.find((item) => item.kind === "CREATE_SETTLEMENT_REPLACEMENT"))
      .toMatchObject({ executable: true, label: "作废并创建替代结算" });
    expect(failed.actions.find((item) => item.kind === "EXECUTE_SETTLEMENT")).toMatchObject({ executable: true });

    const mock = recordedFetch((_call, index) => ({
      settlementId: "settlement-1",
      merchantId: "merchant-1",
      currency: "CNY",
      status: index === 0 ? "READY_FOR_CONFIRMATION" : "VOIDED",
      finality: index === 0 ? "NON_FINAL" : "FINAL",
      netMoney: { currency: "CNY", amountMinor: "100" },
      lines: [],
      attempts: [],
    }));
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });
    const beforeVoid = await adapter.getSettlement("settlement-1");
    const afterVoid = await adapter.getSettlement("settlement-1");

    expect(beforeVoid.actions.find((item) => item.kind === "CREATE_SETTLEMENT_REPLACEMENT"))
      .toMatchObject({ executable: true, availability: "full", label: "作废并创建替代结算" });
    expect(afterVoid.actions.some((item) => item.kind === "CREATE_SETTLEMENT_REPLACEMENT")).toBe(false);
  });

  it("WOW 使用独立 replace；CAP4K 用 voids + createReplacement 组合，但页面命令相同", async () => {
    const wowMock = recordedFetch(() => flatReceipt("Settlement", "replacement-1"));
    const capMock = recordedFetch(() => nestedReceipt("Settlement", "settlement-1"));
    const command: BusinessCommand = {
      type: "CREATE_SETTLEMENT_REPLACEMENT",
      input: {
        settlementId: "settlement-1",
        replacementSettlementId: "replacement-1",
        merchantId: "merchant-1",
        actorAlias: "fixture-settlement-operator",
        reason: "重建冻结范围",
        evidenceRefs: ["evidence-1"],
        idempotencyKey: "replace-1",
      },
    };

    await new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: wowMock.fetchImpl }).execute(command);
    await new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: capMock.fetchImpl }).execute(command);

    expect(wowMock.calls[0]).toMatchObject({
      url: "/backend/api/settlements/settlement-1/replace",
      body: { replacementSettlementId: "replacement-1" },
    });
    expect(capMock.calls[0]).toMatchObject({
      url: "/backend/api/merchant-settlements/settlement-1/voids",
      body: { createReplacement: true },
    });
    expect(new Headers(capMock.calls[0]?.init.headers).get("X-Reference-Actor-Context")).toBe("fixture-settlement-operator");
  });
});
