import { describe, expect, it, vi } from "vitest";
import type { FetchLike, JsonRecord } from "../http/client";
import { Cap4kPaymentAdapter } from "./cap4k-adapter";
import { WowPaymentAdapter } from "./wow-adapter";

const maximum = 2_147_483_647;
const scope = { merchantId: "merchant", billId: "bill", channelId: "fake", currency: "CNY", businessDate: "2047-06-10", businessTimezone: "Asia/Shanghai", idempotencyKey: "command" };
const responsibility = { merchantId: "merchant", actorAlias: "operator", reason: "verified", evidenceRefs: ["reference:proof"], idempotencyKey: "decision" };
const actions: { name: string; invoke: (adapter: WowPaymentAdapter, revision: number) => Promise<unknown> }[] = [
  { name: "register bill and its optional script", invoke: (adapter, revision) => adapter.executeReference({ type: "REGISTER_BILL", input: { ...scope, revision, unavailableReadCount: 1, records: [] } }) },
  { name: "bill available", invoke: (adapter, revision) => adapter.execute({ type: "SIGNAL_BILL_AVAILABLE", input: { ...scope, revision, signalIdentity: "signal" } }) },
  { name: "run", invoke: (adapter, revision) => adapter.execute({ type: "RUN_RECONCILIATION", input: { ...scope, revision } }) },
  { name: "rerun", invoke: (adapter, revision) => adapter.execute({ type: "RERUN_RECONCILIATION", input: { ...scope, revision, runId: "run" } }) },
  { name: "dispose difference", invoke: (adapter, revision) => adapter.execute({ type: "DISPOSE_RECONCILIATION_DIFFERENCE", input: { ...responsibility, revision, runId: "run", differenceId: "difference", conclusion: "ACCEPT_DIFFERENCE", settlementImpact: "ALLOW" } }) },
  { name: "confirm fact", invoke: (adapter, revision) => adapter.execute({ type: "CONFIRM_RECONCILIATION_FACT", input: { ...responsibility, revision, runId: "run", differenceId: "difference", conclusion: "CONFIRM_PLATFORM_FACT", settlementImpact: "CONFIRM" } }) },
  { name: "configure bill script", invoke: (adapter, revision) => adapter.executeReference({ type: "CONFIGURE_BILL_PROVIDER", input: { fixtureId: "fixture", billId: "bill", revision, unavailableReadCount: 1 } }) },
  { name: "read bill script", invoke: (adapter, revision) => adapter.executeReference({ type: "READ_BILL_PROVIDER_SCRIPT", input: { fixtureId: "fixture", billId: "bill", revision } }) },
  { name: "reset bill script", invoke: (adapter, revision) => adapter.executeReference({ type: "RESET_BILL_PROVIDER_SCRIPT", input: { fixtureId: "fixture", billId: "bill", revision } }) },
  { name: "filter bill revision", invoke: (adapter, revision) => adapter.listReconciliationRuns({ filters: { billRevision: revision } }) },
];

function setup() {
  const calls: { url: string; body?: JsonRecord }[] = [];
  const fetchImpl: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) as JsonRecord : undefined });
    return new Response(JSON.stringify({ billId: "11111111-1111-4111-8111-111111111111", billIdentity: "bill", runId: "run", operationId: "operation", acceptanceStatus: "ACCEPTED", readAfter: { mode: "READ_ONCE" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { calls, fetchImpl };
}

describe("WOW bill revision Int32 transport boundary", () => {
  it.each([0, -1, 1.5, NaN, Infinity, maximum + 1, Number.MAX_SAFE_INTEGER + 1])("rejects %s in every revision surface before HTTP", async (revision) => {
    const { fetchImpl } = setup();
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/api", fetchImpl });
    for (const action of actions) {
      await expect(Promise.resolve().then(() => action.invoke(adapter, revision)), action.name).rejects.toMatchObject({
        code: "BILL_REVISION_OUT_OF_RANGE", retryable: false,
        message: expect.stringContaining("2147483647"),
        fields: [{ field: action.name === "filter bill revision" ? "billRevision" : "revision", code: "OUT_OF_RANGE" }],
        details: { minimum: 1, maximum },
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(actions)("preserves both inclusive boundaries for $name", async ({ invoke }) => {
    const { calls, fetchImpl } = setup();
    const adapter = new WowPaymentAdapter({ apiBaseUrl: "/api", fetchImpl });
    for (const revision of [1, maximum]) {
      const before = calls.length;
      await invoke(adapter, revision);
      expect(calls.slice(before).some((call) => call.body?.revision === revision || call.url.includes(`/revisions/${revision}`) || call.url.includes(`billRevision=${revision}`))).toBe(true);
    }
  });
});

describe("CAP4K bill revision remains independent of Int32", () => {
  it.each([maximum + 1, Number.MAX_SAFE_INTEGER])("publishes and announces safe revision %s as exact decimal text", async (revision) => {
    const { calls, fetchImpl } = setup();
    const adapter = new Cap4kPaymentAdapter({ apiBaseUrl: "/api", fetchImpl });
    await adapter.executeReference({ type: "REGISTER_BILL", input: { ...scope, revision, records: [] } });
    await adapter.execute({ type: "SIGNAL_BILL_AVAILABLE", input: { ...scope, revision, signalIdentity: "signal" } });
    await adapter.execute({ type: "RUN_RECONCILIATION", input: { ...scope, revision } });
    expect(calls[0].body?.revision).toBe(String(revision));
    expect(calls.filter((call) => call.url.endsWith("/signals")).map((call) => call.body?.announcedRevision)).toEqual([String(revision), String(revision)]);
  });
});
