import { describe, expect, it, vi } from "vitest";
import type { RegisterBillInput } from "../domain/models";
import type { FetchLike, JsonRecord } from "../http/client";
import { Cap4kPaymentAdapter } from "./cap4k-adapter";
import { mapBill, mapReconciliationRun } from "./shared";
import { WowPaymentAdapter } from "./wow-adapter";

const billUuid = "11111111-1111-4111-8111-111111111111";
const input: RegisterBillInput = {
  billId: "business-bill", revision: 2, channelId: "fake", merchantId: "merchant",
  currency: "CNY", businessDate: "2047-08-18", businessTimezone: "Asia/Shanghai",
  idempotencyKey: "publish-2",
  records: [
    { recordId: "source-uuid", recordIdentity: "payment-record", transactionKind: "PAYMENT", externalTransactionId: "external-payment", money: { currency: "CNY", amountMinor: "10000" }, status: "SUCCESS", rawStatus: "SETTLED", occurredAt: "2047-08-17T20:00:00Z" },
    { recordId: "refund-record", transactionKind: "REFUND", externalTransactionId: "external-refund", money: { currency: "CNY", amountMinor: "0" }, status: "UNKNOWN" },
  ],
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function billResponse(backend: "wow" | "cap4k") {
  return backend === "wow" ? {
    operationId: "bill-operation", commandType: "RegisterStatement", resourceType: "AuthoritativeBillRevision", resourceId: "business-bill:2",
    acceptanceStatus: "ACCEPTED", readAfter: { mode: "POLL", operationUrl: "/operations/bill-operation" },
  } : { billId: billUuid, billIdentity: input.billId, revision: "2" };
}

describe("authoritative bill revisions", () => {
  it("keeps each WOW revision timezone and exact revision text rather than replacing history with current context", () => {
    const bill = mapBill("wow", {
      statementId: "bill", currentRevision: "9007199254740993", channelId: "fake", currency: "CNY",
      revisions: [
        { revision: 1, businessTimezone: "Asia/Shanghai", records: [] },
        { revision: "9007199254740993", businessTimezone: "UTC", records: [{ recordId: "business-row", transactionKind: "REFUND", externalTransactionId: "ext", amount: { currency: "CNY", amountMinor: "0" }, status: "CUSTOM_STATUS", occurredAt: "2047-08-18T01:02:03Z" }] },
      ],
    });
    expect(bill.currentRevision).toBe("9007199254740993");
    expect(bill.businessTimezone).toBe("UTC");
    expect(bill.revisions?.map((revision) => revision.businessTimezone)).toEqual(["Asia/Shanghai", "UTC"]);
    expect(bill.revisions?.[1]?.records[0]).toMatchObject({ recordId: "business-row", recordIdentity: "business-row", rawStatus: "CUSTOM_STATUS", occurredAt: "2047-08-18T01:02:03Z", money: { amountMinor: "0" } });
    expect(mapBill("wow", { statementId: "bill", revisions: [] }).businessTimezone).toBeNull();
  });

  it("keeps CAP4K source UUID separate from business identity and does not invent absent merchant or completeness", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => response({
      billIdentity: "bill", billId: billUuid, channelId: "fake", currency: "CNY", businessDate: "2047-08-18", businessTimezone: "Asia/Shanghai", currentRevision: "2",
      revisions: [{ revision: "2", records: [{ recordId: "record-uuid", recordIdentity: "business-row", transactionKind: "PAYMENT", externalTransactionIdentity: "external", money: { currency: "CNY", amountMinor: "90071992547409930" }, rawStatus: "CAPTURED", occurredAt: "2047-08-18T01:00:00Z", rawEvidence: "immutable" }] }],
    }));
    const bill = await new Cap4kPaymentAdapter({ apiBaseUrl: "/api", fetchImpl }).getBill(billUuid);
    expect(bill.merchantId).toBeNull();
    expect(bill.revisions?.[0]).toMatchObject({ businessTimezone: "Asia/Shanghai", complete: null, records: [{ recordId: "record-uuid", recordIdentity: "business-row", rawStatus: "CAPTURED", occurredAt: "2047-08-18T01:00:00Z", rawEvidence: "immutable", money: { amountMinor: "90071992547409930" } }] });
  });

  it.each(["wow", "cap4k"] as const)("%s freezes retry wire content after a lost response and forwards changed content to backend conflicts", async (backend) => {
    let clock = "2047-08-18T01:00:00Z";
    const calls: JsonRecord[] = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as JsonRecord;
      calls.push(body);
      if (calls.length === 1) throw new TypeError("response lost after publish");
      if (calls.length >= 3) return response({ code: "REVISION_CONFLICT", message: "immutable revision differs", retryable: false }, 409);
      return response(billResponse(backend));
    });
    const options = { apiBaseUrl: "/api", fetchImpl, now: () => new Date(clock) };
    const adapter = backend === "wow" ? new WowPaymentAdapter(options) : new Cap4kPaymentAdapter(options);
    const command = structuredClone(input);
    await expect(adapter.executeReference({ type: "REGISTER_BILL", input: command })).rejects.toThrow();
    clock = "2048-08-18T01:00:00Z";
    const result = await adapter.executeReference({ type: "REGISTER_BILL", input: structuredClone(command) });
    expect(calls[1]).toEqual(calls[0]);
    expect(result.effect).toBe("applied");
    expect(Boolean(result.receipt)).toBe(backend === "wow");
    const wireRecords = calls[1]?.records as JsonRecord[];
    expect(wireRecords[0]?.[backend === "wow" ? "recordId" : "recordIdentity"]).toBe("payment-record");
    expect(wireRecords[0]?.[backend === "wow" ? "status" : "rawStatus"]).toBe("SETTLED");
    expect(wireRecords[0]?.occurredAt).toBe("2047-08-17T20:00:00Z");
    expect(wireRecords[1]?.occurredAt).toBe("2047-08-18T01:00:00.000Z");
    if (backend === "cap4k") {
      expect(calls[1]?.publishedAt).toBe("2047-08-18T01:00:00.000Z");
      expect(wireRecords[1]?.receivedAt).toBe("2047-08-18T01:00:00.000Z");
      expect(wireRecords[0]?.rawEvidence).toContain("/revisions/2/records/payment-record");
    }
    command.records[0]!.money.amountMinor = "20000";
    await expect(adapter.executeReference({ type: "REGISTER_BILL", input: command })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((calls[2]?.records as JsonRecord[])[0]?.[backend === "wow" ? "amount" : "money"]).toEqual({ currency: "CNY", amountMinor: "20000" });
    // A new key cannot make an immutable revision writable either.
    await expect(adapter.executeReference({ type: "REGISTER_BILL", input: { ...command, idempotencyKey: "new-key" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(calls).toHaveLength(4);
  });

  it.each(["wow", "cap4k"] as const)("%s honors a publisher-frozen time across adapter instances and permits empty snapshots", async (backend) => {
    const bodies: JsonRecord[] = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as JsonRecord);
      return response(billResponse(backend));
    });
    for (const year of [2047, 2048]) {
      const options = { apiBaseUrl: "/api", fetchImpl, now: () => new Date(`${year}-08-18T00:00:00Z`) };
      const adapter = backend === "wow" ? new WowPaymentAdapter(options) : new Cap4kPaymentAdapter(options);
      await adapter.executeReference({ type: "REGISTER_BILL", input: { ...input, records: [], publishedAt: "2046-08-18T00:00:00Z" } });
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]?.records).toEqual([]);
    if (backend === "cap4k") expect(bodies[0]?.publishedAt).toBe("2046-08-18T00:00:00Z");
  });
});

describe("reconciliation authority and completeness", () => {
  it("keeps counts independent from classification and settlement blocking", () => {
    const run = mapReconciliationRun("cap4k", {
      runId: "run", matchedCount: 1, differenceCount: 0, unresolvedDifferenceCount: 1, blockingDifferenceCount: 1, totalRecordCount: 1, settlementBlocked: true,
      differences: [{ differenceId: "match", differenceType: "MATCHED", resolved: false, settlementBlocked: true }],
    }, true);
    expect(run).toMatchObject({ matchedCount: 1, differenceCount: 0, unresolvedDifferenceCount: 1, blockingDifferenceCount: 1, totalRecordCount: 1, detailsComplete: true, settlementBlocked: true });
    expect(run.differences[0]).toMatchObject({ differenceType: "MATCHED", resolved: false, settlementBlocked: true });
  });

  it("does not manufacture zero counts, resolved flags, or complete details from summaries", () => {
    const raw = { runId: "summary", differences: [{ differenceId: "future", differenceType: "PROVIDER_NEW_CLASSIFICATION" }] };
    const summary = mapReconciliationRun("wow", raw);
    expect(summary).toMatchObject({ matchedCount: null, differenceCount: null, unresolvedDifferenceCount: null, blockingDifferenceCount: null, totalRecordCount: null, detailsComplete: null, effectiveRun: null, settlementBlocked: null });
    expect(summary.differences[0]).toMatchObject({ differenceType: "UNKNOWN", sourceDifferenceType: "PROVIDER_NEW_CLASSIFICATION", resolved: null, settlementBlocked: null });
    expect(mapReconciliationRun("wow", { runId: "no-array" }, true).detailsComplete).toBeNull();
    expect(mapReconciliationRun("wow", { ...raw, detailsComplete: false }, true).detailsComplete).toBe(false);
    expect(mapReconciliationRun("wow", { runId: "invalid-counts", matchedCount: -1, differenceCount: 1.5, totalRecordCount: Number.MAX_SAFE_INTEGER + 1 }).totalRecordCount).toBeNull();
  });

  it.each(["wow", "cap4k"] as const)("%s marks authoritative detail complete but never relies on a list array alone", async (backend) => {
    const fetchImpl: FetchLike = vi.fn(async (url) => response(String(url).endsWith("/run")
      ? { runId: "run", differences: [], matchedCount: 0, differenceCount: 0 }
      : { items: [{ runId: "run", matchedCount: 7, differenceCount: 2 }], pageSize: 10 }));
    const options = { apiBaseUrl: "/api", fetchImpl };
    const adapter = backend === "wow" ? new WowPaymentAdapter(options) : new Cap4kPaymentAdapter(options);
    expect((await adapter.getReconciliationRun("run")).detailsComplete).toBe(true);
    const page = await adapter.listReconciliationRuns({});
    // CAP4K deliberately fetches full detail for each row to resolve public Bill identity.
    expect(page.items[0]?.detailsComplete).toBe(backend === "wow" ? null : true);
  });
});
