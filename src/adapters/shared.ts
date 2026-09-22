import { createMoney, decimalToMinor, minorToDecimal } from "../domain/money";
import type {
  ActionDescriptor,
  ActionKind,
  AttemptStatus,
  BackendId,
  CapabilityDeclaration,
  ChannelReceipt,
  ChannelResult,
  PaymentStatus,
  RefundStatus,
  SourceMetadata,
} from "../domain/models";
import { arrayValue, booleanValue, isRecord, numberValue, stringValue, type JsonRecord } from "../http/client";

export const unavailable = (kind: ActionKind, label: string, reason: string): ActionDescriptor => ({
  kind, label, executable: false, reason, confirmation: "none", refresh: "none",
});

export const action = (kind: ActionKind, label: string, options: Partial<ActionDescriptor> = {}): ActionDescriptor => ({
  kind, label, executable: true, confirmation: "confirm", refresh: "poll", ...options,
});

export function source(adapter: BackendId, value: JsonRecord, sourceId?: string): SourceMetadata {
  return {
    adapter,
    sourceStatus: stringValue(value.status) ?? stringValue(value.paymentStatus) ?? stringValue(value.refundStatus),
    sourceId: sourceId ?? stringValue(value.paymentId) ?? stringValue(value.refundId) ?? stringValue(value.batchId) ?? stringValue(value.settlementId),
    sourceTime: stringValue(value.updatedAt) ?? stringValue(value.finalizedAt) ?? stringValue(value.createdAt),
    diagnostic: stringValue(value.diagnosticSummary) ?? stringValue(value.blockingReason) ?? stringValue(value.lastConflictSummary) ?? null,
  };
}

export function mapPaymentStatus(value: unknown): PaymentStatus {
  switch (String(value)) {
    case "SUCCESS":
    case "SUCCEEDED": return "SUCCEEDED";
    case "FAILED": return "FAILED";
    case "CLOSED": return "CLOSED";
    case "PROCESSING": return "PROCESSING";
    case "RESULT_UNKNOWN":
    case "REVIEW_REQUIRED": return "PENDING_CONFIRMATION";
    default: return "PENDING";
  }
}

export function mapRefundStatus(value: unknown): RefundStatus {
  switch (String(value)) {
    case "SUCCESS":
    case "SUCCEEDED": return "SUCCEEDED";
    case "FAILED": return "FAILED";
    case "REJECTED": return "REJECTED";
    case "PROCESSING": return "PROCESSING";
    case "RESULT_UNKNOWN":
    case "REVIEW_REQUIRED": return "PENDING_CONFIRMATION";
    default: return "REQUESTED";
  }
}

export function mapAttemptStatus(value: unknown): AttemptStatus {
  switch (String(value)) {
    case "SUCCESS":
    case "SUCCEEDED": return "SUCCEEDED";
    case "FAILED": return "FAILED";
    case "RESULT_UNKNOWN":
    case "REVIEW_REQUIRED": return "PENDING_CONFIRMATION";
    case "PROCESSING": return "PROCESSING";
    default: return "UNKNOWN";
  }
}

export function mapChannelResult(value: unknown): ChannelResult | undefined {
  switch (String(value)) {
    case "SUCCESS":
    case "SUCCEEDED": return "SUCCEEDED";
    case "FAILED": return "FAILED";
    case "UNKNOWN":
    case "RESULT_UNKNOWN": return "UNKNOWN";
    default: return undefined;
  }
}

export function wowMoney(amount: unknown, currency: string): ReturnType<typeof createMoney> {
  if (typeof amount !== "number" && typeof amount !== "string") throw new Error("WOW response has no numeric amount");
  return createMoney(currency, String(amount));
}

export function decimalMoney(amount: unknown, currency: string): ReturnType<typeof createMoney> {
  if (typeof amount !== "number" && typeof amount !== "string") throw new Error("CAP4K response has no decimal amount");
  return createMoney(currency, decimalToMinor(String(amount), currency));
}

export function toDecimalMoney(minorAmount: string, currency: string): string {
  return minorToDecimal(minorAmount, currency);
}

export function records(value: unknown): JsonRecord[] {
  return arrayValue(value).filter(isRecord);
}

export function channelReceipts(adapter: BackendId, value: unknown): ChannelReceipt[] {
  return records(value).map((receipt) => ({
    id: stringValue(receipt.notificationIdentity) ?? stringValue(receipt.receiptId) ?? stringValue(receipt.id) ?? "unknown-receipt",
    result: mapChannelResult(receipt.result),
    disposition: stringValue(receipt.decision) ?? stringValue(receipt.disposition),
    accepted: booleanValue(receipt.accepted),
    verified: booleanValue(receipt.verified),
    duplicate: (numberValue(receipt.receiveCount) ?? 0) > 1,
    occurredAt: stringValue(receipt.occurredAt),
    summary: stringValue(receipt.verdictSummary) ?? stringValue(receipt.rejectionSummary) ?? stringValue(receipt.conflictSummary),
    source: source(adapter, receipt),
  }));
}

export function capabilities(entries: Array<[string, "full" | "partial" | "unavailable", string?, ActionKind[]?]>): CapabilityDeclaration[] {
  return entries.map(([id, level, reason, actions]) => ({ id, level, reason, actions }));
}
