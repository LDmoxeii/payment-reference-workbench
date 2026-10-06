import { describe, expect, it, vi } from "vitest";
import type { BusinessCommand, ReferenceCommand } from "../domain/models";
import type { FetchLike, JsonRecord } from "../http/client";
import { WowPaymentAdapter } from "./wow-adapter";
import { observeReceipt } from "../services/workbench-service";

function setup() {
  const calls: { url: string; method: string; body?: JsonRecord }[] = [];
  const fetchImpl: FetchLike = vi.fn(async (input, init = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) as JsonRecord : undefined,
    });
    return new Response(JSON.stringify({
      operationId: "op-1",
      acceptanceStatus: "ACCEPTED",
      readAfter: { mode: "POLL", operationUrl: "/api/operations/op-1" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { adapter: new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fixtureId: "fixture-default", fetchImpl }), calls };
}

describe("WOW reference script transport contract", () => {
  it.each(["bill-bc0c625b", "merchant:bill/2024:1"])("reads the bill after a revision signal without treating its composite identity as the bill ID: %s", async (billId) => {
    const statementPath = `/backend/api/reference/statements/${encodeURIComponent(billId)}`;
    const revisionIdentity = `${billId}:1`;
    const rawReceipt = {
      operationId: "op-bill", commandType: "BillAvailable", acceptanceStatus: "ACCEPTED",
      resourceType: "AuthoritativeBillRevision", resourceId: revisionIdentity,
      readAfter: { mode: "READ_ONCE", operationUrl: "/api/operations/op-bill", resourceUrl: `/api/reference/statements/${encodeURIComponent(billId)}/revisions/1` },
    };
    const fetchImpl: FetchLike = vi.fn(async (input, init = {}) => {
      const path = String(input);
      let body: unknown;
      if (init.method === "POST" && path === "/backend/api/reconciliation/bill-available") body = rawReceipt;
      else if (path === "/backend/api/operations/op-bill") body = { ...rawReceipt, status: "SUCCEEDED" };
      else if (path === statementPath) body = { billId, currentRevision: 1, currency: "CNY", channelId: "fake" };
      else if (path === `${statementPath}/revisions`) body = [{ revision: 1, records: [] }];
      else return new Response(JSON.stringify({ code: "AUTHORITATIVE_BILL_NOT_FOUND", message: "未找到指定权威账单" }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/backend/api", fetchImpl });
    const receipt = await adapter.execute({ type: "SIGNAL_BILL_AVAILABLE", input: {
      billId, revision: 1, merchantId: "merchant", channelId: "fake", currency: "CNY",
      businessDate: "2024-01-01", businessTimezone: "Asia/Shanghai", signalIdentity: "signal", idempotencyKey: "bill-signal",
    } });
    const result = await observeReceipt(adapter, receipt);
    expect(result.timedOut).toBe(false);
    expect(result.resource).toMatchObject({ billId, currentRevision: 1, revisions: [{ revision: 1 }] });
    expect(receipt.readAfter).toMatchObject(rawReceipt.readAfter);
    expect(receipt.source.sourceId).toBe(revisionIdentity);
    expect(result.operation.resource?.resourceId).toBe(revisionIdentity);
    expect(vi.mocked(fetchImpl).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("advertises the four real script control planes", () => {
    const { adapter } = setup();
    for (const id of ["reference-lab", "channel-script", "bill-read-script", "notification-sender-script", "settlement-executor-script"]) {
      expect(adapter.profile.capabilities.find((capability) => capability.id === id))
        .toMatchObject({ level: "full" });
    }
  });

  it("configures, reads and resets the payment channel script by fixture and channel", async () => {
    const { adapter, calls } = setup();
    const commands: ReferenceCommand[] = [
      { type: "CONFIGURE_CHANNEL", input: { fixtureId: "fixture-A", channelId: "channel/1", outcome: "SUCCESS" } },
      { type: "READ_CHANNEL_SCRIPT", input: { fixtureId: "fixture-A", channelId: "channel/1" } },
      { type: "RESET_CHANNEL_SCRIPT", input: { fixtureId: "fixture-A", channelId: "channel/1" } },
    ];
    for (const command of commands) expect((await adapter.executeReference(command)).effect).toBe("applied");
    expect(calls).toEqual([
      { url: "/backend/api/reference/payment-channel-scripts/channel%2F1", method: "POST", body: { fixtureId: "fixture-A", script: "ACCEPT_THEN_SUCCESS" } },
      { url: "/backend/api/reference/payment-channel-scripts/channel%2F1?fixtureId=fixture-A", method: "GET" },
      { url: "/backend/api/reference/payment-channel-scripts/channel%2F1/reset", method: "POST", body: { fixtureId: "fixture-A" } },
    ]);
  });

  it("configures, reads and resets the bill provider by immutable bill revision", async () => {
    const { adapter, calls } = setup();
    const commands: ReferenceCommand[] = [
      { type: "CONFIGURE_BILL_PROVIDER", input: { fixtureId: "fixture-A", billId: "bill/1", revision: 2, unavailableReadCount: 3 } },
      { type: "READ_BILL_PROVIDER_SCRIPT", input: { fixtureId: "fixture-A", billId: "bill/1", revision: 2 } },
      { type: "RESET_BILL_PROVIDER_SCRIPT", input: { fixtureId: "fixture-A", billId: "bill/1", revision: 2 } },
    ];
    for (const command of commands) expect((await adapter.executeReference(command)).effect).toBe("applied");
    expect(calls).toEqual([
      { url: "/backend/api/reference/bill-provider-scripts/bill%2F1/revisions/2", method: "POST", body: { fixtureId: "fixture-A", unavailableReadCount: 3 } },
      { url: "/backend/api/reference/bill-provider-scripts/bill%2F1/revisions/2?fixtureId=fixture-A", method: "GET" },
      { url: "/backend/api/reference/bill-provider-scripts/bill%2F1/revisions/2/reset", method: "POST", body: { fixtureId: "fixture-A" } },
    ]);
  });

  it("maps notification selectors to sourceFactIdentity for configure, read and reset", async () => {
    const { adapter, calls } = setup();
    const selector = { fixtureId: "fixture-A", sourceKind: "PAYMENT", sourceFactId: "payment/1" };
    const commands: ReferenceCommand[] = [
      { type: "CONFIGURE_NOTIFICATION_SENDER", input: { ...selector, outcome: "RESULT_UNKNOWN" } },
      { type: "READ_NOTIFICATION_SENDER_SCRIPT", input: selector },
      { type: "RESET_NOTIFICATION_SENDER_SCRIPT", input: selector },
    ];
    for (const command of commands) expect((await adapter.executeReference(command)).effect).toBe("applied");
    expect(calls).toEqual([
      {
        url: "/backend/api/reference/notification-sender-scripts", method: "POST",
        body: { fixtureId: "fixture-A", selector: { sourceKind: "PAYMENT", sourceFactIdentity: "payment/1" }, script: "RESULT_UNKNOWN" },
      },
      { url: "/backend/api/reference/notification-sender-scripts?fixtureId=fixture-A&sourceKind=PAYMENT&sourceFactIdentity=payment%2F1", method: "GET" },
      {
        url: "/backend/api/reference/notification-sender-scripts/reset", method: "POST",
        body: { fixtureId: "fixture-A", selector: { sourceKind: "PAYMENT", sourceFactIdentity: "payment/1" } },
      },
    ]);
  });

  it("configures the settlement executor by channel, then submits caller executionId with the fixture", async () => {
    const { adapter, calls } = setup();
    const commands: ReferenceCommand[] = [
      { type: "CONFIGURE_SETTLEMENT_EXECUTOR", input: { fixtureId: "fixture-A", channelId: "channel/1", executionId: "execution-1", outcome: "NO_RESULT" } },
      { type: "READ_SETTLEMENT_EXECUTOR_SCRIPT", input: { fixtureId: "fixture-A", channelId: "channel/1", executionId: "execution-1" } },
      { type: "RESET_SETTLEMENT_EXECUTOR_SCRIPT", input: { fixtureId: "fixture-A", channelId: "channel/1", executionId: "execution-1" } },
    ];
    for (const command of commands) expect((await adapter.executeReference(command)).effect).toBe("applied");
    const execution: BusinessCommand = {
      type: "EXECUTE_SETTLEMENT",
      input: { settlementId: "settlement-1", merchantId: "merchant-1", executionId: "execution-1", channelId: "channel/1", idempotencyKey: "idem-1" },
    };
    await adapter.execute(execution);
    expect(calls).toEqual([
      { url: "/backend/api/reference/settlement-executor-scripts/channel%2F1", method: "POST", body: { fixtureId: "fixture-A", script: "NO_RESULT" } },
      { url: "/backend/api/reference/settlement-executor-scripts/channel%2F1?fixtureId=fixture-A", method: "GET" },
      { url: "/backend/api/reference/settlement-executor-scripts/channel%2F1/reset", method: "POST", body: { fixtureId: "fixture-A" } },
      {
        url: "/backend/api/settlements/settlement-1/executions", method: "POST",
        body: { merchantId: "merchant-1", executionId: "execution-1", idempotencyKey: "idem-1", reviewAfterMinutes: 30, fixtureId: "fixture-default" },
      },
    ]);
  });

  it("registers a bill revision and then activates its unavailable-read script", async () => {
    const { adapter, calls } = setup();
    const result = await adapter.executeReference({
      type: "REGISTER_BILL",
      input: {
        billId: "bill-1", revision: 1, merchantId: "merchant-1", channelId: "channel-1",
        currency: "CNY", businessDate: "2026-09-26", businessTimezone: "Asia/Shanghai",
        idempotencyKey: "bill-1:1", fixtureId: "fixture-A", unavailableReadCount: 2, records: [],
      },
    });
    expect(result.effect).toBe("applied");
    expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
      { url: "/backend/api/reference/statements", method: "POST" },
      { url: "/backend/api/reference/bill-provider-scripts/bill-1/revisions/1", method: "POST" },
    ]);
    expect(calls[1]?.body).toEqual({ fixtureId: "fixture-A", unavailableReadCount: 2 });
  });

  it("carries fixture and a stable read attempt identity into the bill signal", async () => {
    const { adapter, calls } = setup();
    await adapter.execute({
      type: "SIGNAL_BILL_AVAILABLE",
      input: {
        billId: "bill-1", revision: 1, merchantId: "merchant-1", channelId: "channel-1",
        currency: "CNY", businessDate: "2026-09-26", businessTimezone: "Asia/Shanghai",
        signalIdentity: "signal-1", idempotencyKey: "read-1",
      },
    });
    expect(calls).toEqual([{
      url: "/backend/api/reconciliation/bill-available", method: "POST",
      body: {
        statementId: "bill-1", revision: 1, merchantId: "merchant-1",
        signalIdentity: "signal-1", idempotencyKey: "read-1",
        readAttemptIdentity: "read-1", fixtureId: "fixture-default",
      },
    }]);
  });
});
