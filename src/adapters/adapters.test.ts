import { describe, expect, it, vi } from "vitest";
import { BusinessError } from "../domain/errors";
import { createMoney } from "../domain/money";
import type { FetchLike, JsonRecord } from "../http/client";
import { Cap4kPaymentAdapter, mapCap4kPayment, mapCap4kRefund } from "./cap4k-adapter";
import { mapAttemptStatus, mapChannelResult, mapPaymentStatus, mapRefundStatus } from "./shared";
import { mapWowPayment, mapWowRefund, WowPaymentAdapter } from "./wow-adapter";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function createFetch(body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init });
    return response(body, 201);
  });
  return { calls, fetchImpl };
}

describe("status normalization", () => {
  it("keeps lifecycle and callback values separate while accepting source aliases", () => {
    expect(mapPaymentStatus("RESULT_UNKNOWN")).toBe("PENDING_CONFIRMATION");
    expect(mapPaymentStatus("SUCCESS")).toBe("SUCCEEDED");
    expect(mapRefundStatus("SUCCESS")).toBe("SUCCEEDED");
    expect(mapAttemptStatus("SUCCESS")).toBe("SUCCEEDED");
    expect(mapChannelResult("SUCCESS")).toBe("SUCCEEDED");
  });
});

describe("payment creation transport mapping", () => {
  const input = {
    merchantId: "merchant-1",
    merchantOrderNo: "order-1",
    idempotencyKey: "idem-1",
    amount: createMoney("CNY", "1234"),
    paymentMethod: "DEFAULT",
    expiresAt: "2026-09-21T12:00:00.000Z",
  };

  it("maps the unified request to WOW", async () => {
    const mock = createFetch({ aggregateId: "pay-wow", status: "ACCEPTED", reused: false });
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const receipt = await adapter.createPayment(input);

    expect(receipt).toMatchObject({ resourceType: "payment", resourceId: "pay-wow", accepted: true, refresh: "poll" });
    expect(mock.calls[0]?.url).toBe("/backend/api/payments");
    expect(JSON.parse(String(mock.calls[0]?.init?.body))).toEqual({
      merchantId: "merchant-1",
      merchantOrderNo: "order-1",
      idempotencyKey: "idem-1",
      amount: 1234,
      currency: "CNY",
      paymentMethod: "DEFAULT",
      expiresAt: "2026-09-21T12:00:00.000Z",
    });
  });

  it("maps the unified request to CAP4K with an exact decimal string", async () => {
    const mock = createFetch({ paymentId: "pay-cap", status: "PENDING", idempotentReplay: false });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl });

    const receipt = await adapter.createPayment(input);

    expect(receipt).toMatchObject({ resourceType: "payment", resourceId: "pay-cap", accepted: true, refresh: "read_once" });
    expect(mock.calls[0]?.url).toBe("/backend/api/payments");
    expect(JSON.parse(String(mock.calls[0]?.init?.body))).toEqual({
      merchantId: "merchant-1",
      merchantOrderNumber: "order-1",
      idempotencyKey: "idem-1",
      amount: "12.34",
      currency: "CNY",
      paymentMethod: "DEFAULT",
      expiresAt: "2026-09-21T12:00:00.000Z",
    });
  });
});

describe("detail mapping", () => {
  it("maps WOW payment and refund projections", () => {
    const payment = mapWowPayment({
      paymentId: "pay-wow",
      merchantId: "merchant-1",
      merchantOrderNo: "order-1",
      amount: 1000,
      currency: "CNY",
      paymentMethod: "DEFAULT",
      status: "SUCCEEDED",
      successfulRefundAmount: 200,
      reservedRefundAmount: 100,
      attempts: [{ attemptId: "attempt-1", channel: "fake", status: "SUCCEEDED", receiptIds: ["notice-1"] }],
      reviewIds: [],
    });
    const refund = mapWowRefund({
      refundId: "refund-wow",
      paymentId: "pay-wow",
      merchantId: "merchant-1",
      merchantRefundNo: "refund-order-1",
      amount: 200,
      currency: "CNY",
      status: "SUCCEEDED",
      attemptIds: ["refund-attempt-1"],
      channels: ["fake"],
      receiptIds: ["refund-notice-1"],
      reviewIds: [],
    });

    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.refundSummary).toMatchObject({ successful: { minorAmount: "200" }, reserved: { minorAmount: "100" } });
    expect(payment.attempts[0]).toMatchObject({ id: "attempt-1", receiptCount: 1 });
    expect(refund).toMatchObject({ id: "refund-wow", status: "SUCCEEDED", reservationActive: null });
  });

  it("maps CAP4K decimal amounts and SUCCESS callback aliases", () => {
    const payment = mapCap4kPayment({
      paymentId: "pay-cap",
      merchantId: "merchant-1",
      merchantOrderNumber: "order-1",
      amount: "10.00",
      currency: "CNY",
      paymentMethod: "DEFAULT",
      status: "SUCCESS",
      successfulRefundAmount: "2.00",
      reservedRefundAmount: "1.00",
      attempts: [{ paymentAttemptId: "attempt-1", channelId: "C-001", status: "SUCCESS", finalResult: "SUCCESS", notificationReceipts: [] }],
      reviews: [],
    });
    const refund = mapCap4kRefund({
      refundId: "refund-cap",
      paymentId: "pay-cap",
      merchantId: "merchant-1",
      merchantRefundNumber: "refund-order-1",
      amount: "2.00",
      currency: "CNY",
      status: "SUCCESS",
      attempts: [{ refundAttemptId: "refund-attempt-1", channelId: "C-001", status: "SUCCESS", finalResult: "SUCCESS", notificationReceipts: [{ notificationIdentity: "notice-1", result: "SUCCESS" }] }],
    });

    expect(payment.refundSummary.refundable?.minorAmount).toBe("700");
    expect(payment.attempts[0]).toMatchObject({ status: "SUCCEEDED", finalResult: "SUCCEEDED" });
    expect(refund).toMatchObject({ status: "SUCCEEDED" });
    expect(refund.attempts[0]?.receipts[0]?.result).toBe("SUCCEEDED");
  });
});

describe("capability degradation", () => {
  it.each([
    [new WowPaymentAdapter({ apiBaseUrl: "/api", fetchImpl: vi.fn() as FetchLike }), "WOW"],
    [new Cap4kPaymentAdapter({ apiBaseUrl: "/api", fetchImpl: vi.fn() as FetchLike }), "CAP4K"],
  ])("rejects invented payment lists for %s", async (adapter, _label) => {
    await expect(adapter.listPayments({ page: 1, pageSize: 20 })).rejects.toMatchObject<Partial<BusinessError>>({ code: "CAPABILITY_UNAVAILABLE" });
  });
});

describe("channel callback endpoints", () => {
  it("maps CAP4K payment callback endpoint and SUCCESS payload", async () => {
    const mock = createFetch({ paymentId: "pay-cap", paymentStatus: "SUCCEEDED", accepted: true });
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl: mock.fetchImpl, verificationMaterial: "secret" });

    await adapter.submitPaymentResult({
      paymentId: "pay-cap",
      attemptId: "attempt-1",
      notificationId: "notice-1",
      channel: "C-001",
      channelTransactionId: "txn-1",
      amount: createMoney("CNY", "1234"),
      result: "SUCCEEDED",
    });

    expect(mock.calls[0]?.url).toBe("/backend/api/channel/payment-results");
    const payload = JSON.parse(String(mock.calls[0]?.init?.body)) as JsonRecord;
    expect(payload).toMatchObject({ amount: "12.34", result: "SUCCESS", verificationMaterial: "secret" });
  });
});
