import type { ReconciliationDifference, ReconciliationRun } from "../domain/models";

export type DetailFilter = "ALL" | "DIFFERENCES" | "MATCHED";
export interface ReconciliationCount {
  value: number | null;
  source: "authority" | "complete-details" | "unknown";
}

export function isMatched(item: ReconciliationDifference): boolean {
  return item.differenceType === "MATCHED";
}

export function filterReconciliationDetails(items: ReconciliationDifference[], filter: DetailFilter): ReconciliationDifference[] {
  return items.filter((item) => filter === "ALL" || (filter === "MATCHED" ? isMatched(item) : !isMatched(item)));
}

function validCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function summarizeReconciliation(run: ReconciliationRun) {
  const complete = run.detailsComplete === true;
  const count = (authority: number | null | undefined, derived: number | null): ReconciliationCount =>
    validCount(authority) ? { value: authority, source: "authority" }
      : complete && derived !== null ? { value: derived, source: "complete-details" }
      : { value: null, source: "unknown" };
  const totalAuthority = validCount(run.totalRecordCount) ? run.totalRecordCount
    : validCount(run.matchedCount) && validCount(run.differenceCount) && Number.isSafeInteger(run.matchedCount + run.differenceCount)
      ? run.matchedCount + run.differenceCount : null;
  return {
    total: count(totalAuthority, run.differences.length),
    matched: count(run.matchedCount, run.differences.filter(isMatched).length),
    differences: count(run.differenceCount, run.differences.filter((item) => !isMatched(item)).length),
    unresolved: count(run.unresolvedDifferenceCount, run.differences.every((item) => item.resolved != null)
      ? run.differences.filter((item) => item.resolved === false).length : null),
    blocking: count(run.blockingDifferenceCount, run.differences.every((item) => item.settlementBlocked != null)
      ? run.differences.filter((item) => item.settlementBlocked === true).length : null),
  };
}

export function countDescription(count: ReconciliationCount): string {
  if (count.value === null) return "未知（权威值未返回，明细不足以计算）";
  return `${count.value} · ${count.source === "authority" ? "权威计数" : "完整明细计算"}`;
}

export function triState(value: boolean | null | undefined, yes = "是", no = "否"): string {
  return value == null ? "未知" : value ? yes : no;
}
