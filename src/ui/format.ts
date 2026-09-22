import { minorToDecimal, type Money } from "../domain/money";

const statusLabels: Record<string, string> = {
  PENDING: "待支付",
  PROCESSING: "处理中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  CLOSED: "已关闭",
  PENDING_CONFIRMATION: "结果待确认",
  REQUESTED: "已申请",
  REJECTED: "已拒绝",
  COMPLETED: "已完成",
  OPEN: "处理中",
  BLOCKED: "已阻断",
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  RESULT_UNKNOWN: "结果未知",
  REVIEW_REQUIRED: "待复核",
  VOIDED: "已作废",
  PREPARING: "准备中",
  PREPARED: "待确认",
};

export function statusLabel(status?: string | null): string {
  if (!status) return "未知";
  return statusLabels[status] ?? status;
}

export function statusTone(status?: string | null): "success" | "warning" | "danger" | "neutral" | "info" {
  if (!status) return "neutral";
  if (["SUCCEEDED", "COMPLETED", "SETTLED", "DELIVERED"].includes(status)) return "success";
  if (["FAILED", "REJECTED", "VOIDED", "UNREACHABLE"].includes(status)) return "danger";
  if (["PENDING_CONFIRMATION", "RESULT_UNKNOWN", "REVIEW_REQUIRED", "BLOCKED", "NEGATIVE_REVIEW_REQUIRED"].includes(status)) return "warning";
  if (["PENDING", "PROCESSING", "REQUESTED", "PREPARING", "PREPARED", "CONFIRMED", "OPEN"].includes(status)) return "info";
  return "neutral";
}

export function formatMoney(money?: Money): string {
  if (!money) return "—";
  return `${money.currency} ${minorToDecimal(money.minorAmount, money.currency)}`;
}

export function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}
