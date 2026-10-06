import { describe, expect, it } from "vitest";
import type { ReconciliationDifference, ReconciliationRun } from "../domain/models";
import { filterReconciliationDetails, summarizeReconciliation, triState } from "./reconciliation-summary";

function item(type: ReconciliationDifference["differenceType"], resolved: boolean | null = true, blocked: boolean | null = false): ReconciliationDifference {
  return { differenceId: type, differenceType: type, resolved, settlementBlocked: blocked, platformEvidenceRefs: [], billEvidenceRefs: [], dispositions: [], confirmations: [] };
}
function run(differences: ReconciliationDifference[], patch: Partial<ReconciliationRun> = {}): ReconciliationRun {
  return { resourceType: "reconciliationRun", runId: "run", billId: "bill", scope: { channelId: "fake", currency: "CNY" }, merchantIds: [], status: "ACTION_REQUIRED", finality: "REVIEW_REQUIRED", differences, actions: [], source: { adapter: "wow" }, ...patch };
}

describe("Run 匹配分类与资格独立汇总", () => {
  it("一匹配三差异的权威汇总与三种筛选", () => {
    const value = run([item("MATCHED"), item("PLATFORM_ONLY", false, true), item("PLATFORM_ONLY", false, true), item("PLATFORM_ONLY", false, true)], { matchedCount: 1, differenceCount: 3, unresolvedDifferenceCount: 3, detailsComplete: true });
    const counts = summarizeReconciliation(value);
    expect([counts.total.value, counts.matched.value, counts.differences.value, counts.unresolved.value, counts.blocking.value]).toEqual([4, 1, 3, 3, 3]);
    expect(counts.total.source).toBe("authority"); expect(counts.blocking.source).toBe("complete-details");
    expect(["ALL", "DIFFERENCES", "MATCHED"].map((filter) => filterReconciliationDetails(value.differences, filter as "ALL" | "DIFFERENCES" | "MATCHED").length)).toEqual([4, 3, 1]);
  });
  it("仅完整明细可以补算缺失计数", () => {
    const incomplete = summarizeReconciliation(run([item("MATCHED")]));
    expect(Object.values(incomplete).every((count) => count.value === null)).toBe(true);
    expect(summarizeReconciliation(run([], { detailsComplete: true })).total.value).toBe(0);
    expect(summarizeReconciliation(run([item("MATCHED")], { detailsComplete: true })).matched.value).toBe(1);
  });
  it("权威计数优先，局部明细不能重写全局计数", () => {
    const counts = summarizeReconciliation(run([item("MATCHED")], { detailsComplete: false, matchedCount: 10, differenceCount: 7, unresolvedDifferenceCount: 3 }));
    expect([counts.total.value, counts.matched.value, counts.differences.value, counts.unresolved.value, counts.blocking.value]).toEqual([17, 10, 7, 3, null]);
  });
  it("已处置异常和未知类型仍是差异历史", () => {
    const value = run([item("MATCHED"), item("PLATFORM_ONLY"), { ...item("UNKNOWN"), sourceDifferenceType: "FUTURE_TYPE" }], { detailsComplete: true });
    expect(summarizeReconciliation(value).differences.value).toBe(2);
    expect(filterReconciliationDetails(value.differences, "DIFFERENCES").map((record) => record.differenceType)).toEqual(["PLATFORM_ONLY", "UNKNOWN"]);
  });
  it("MATCHED 未解决仍阻断，零差异不代表可结算", () => {
    const value = run([item("MATCHED", false, true)], { detailsComplete: true, settlementBlocked: true });
    const counts = summarizeReconciliation(value);
    expect([counts.differences.value, counts.unresolved.value, counts.blocking.value]).toEqual([0, 1, 1]);
    expect(value.settlementBlocked).toBe(true);
  });
  it("明细标志未知时不能补算未解决或阻断为零", () => {
    const counts = summarizeReconciliation(run([item("MATCHED", null, null)], { detailsComplete: true }));
    expect(counts.matched.value).toBe(1); expect(counts.unresolved.value).toBeNull(); expect(counts.blocking.value).toBeNull();
    expect(triState(null)).toBe("未知"); expect(triState(false)).toBe("否");
  });
});
