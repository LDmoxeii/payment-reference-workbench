/** One-time navigation input, never a cache of authoritative bill facts. */
export interface BillReconciliationHint {
  billId: string;
  revision: number;
  merchantId: string;
  channelId: string;
  currency: string;
  businessDate: string;
  businessTimezone: string;
  publishedAt?: string;
  merchantSource: "bill" | "user-confirmed";
}

let pending: BillReconciliationHint | undefined;

export function setBillReconciliationHint(hint: BillReconciliationHint): void {
  pending = { ...hint };
}

/** The destination must getBill again and check the selected revision before use. */
export function consumeBillReconciliationHint(): BillReconciliationHint | undefined {
  const hint = pending;
  pending = undefined;
  return hint;
}
