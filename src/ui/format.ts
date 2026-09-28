import { minorToDecimal, type Money } from "../domain/money";

const statusLabels: Record<string, string> = {
  ACCEPTED: "已受理", ALREADY_ACCEPTED: "已受理（幂等重放）", PENDING: "待处理", PROCESSING: "处理中",
  SUCCEEDED: "成功", SUCCESS: "成功", FAILED: "失败", FAILURE: "失败", CLOSED: "已关闭",
  PENDING_CONFIRMATION: "结果待确认", REQUESTED: "已申请", REJECTED: "已拒绝", COMPLETED: "已完成",
  OPEN: "处理中", BLOCKED: "已阻断", DRAFT: "草稿", CONFIRMED: "已确认", RESULT_UNKNOWN: "结果未知",
  UNKNOWN: "结果未知", REVIEW_REQUIRED: "待人工核对", VOIDED: "已作废", PREPARING: "准备中", PREPARED: "待确认",
  NON_FINAL: "未终态", FINAL: "已终态", DELIVERED: "已投递",
};

export function statusLabel(status?: string | null): string {
  if (!status) return "未知";
  return statusLabels[status] ?? status;
}

export function statusTone(status?: string | null): "success" | "warning" | "danger" | "neutral" | "info" {
  if (!status) return "neutral";
  if (["SUCCEEDED", "SUCCESS", "COMPLETED", "SETTLED", "DELIVERED", "FINAL"].includes(status)) return "success";
  if (["FAILED", "FAILURE", "REJECTED", "VOIDED", "UNREACHABLE"].includes(status)) return "danger";
  if (["PENDING_CONFIRMATION", "RESULT_UNKNOWN", "UNKNOWN", "REVIEW_REQUIRED", "BLOCKED", "NEGATIVE_REVIEW_REQUIRED"].includes(status)) return "warning";
  if (["ACCEPTED", "ALREADY_ACCEPTED", "PENDING", "PROCESSING", "REQUESTED", "PREPARING", "PREPARED", "CONFIRMED", "OPEN", "NON_FINAL"].includes(status)) return "info";
  return "neutral";
}

export function formatMoney(money?: Money): string {
  if (!money) return "—";
  try { return `${money.currency} ${minorToDecimal(money.amountMinor, money.currency)}`; }
  catch { return `${money.currency} ${money.amountMinor} minor`; }
}

export function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

export function evidenceLabel(value: { evidenceType: string; evidenceId: string }): string {
  return `${value.evidenceType}:${value.evidenceId}`;
}
