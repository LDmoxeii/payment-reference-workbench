import { BusinessError } from "../domain/errors";
import type { AuthoritativeBill, BillRevision, ReferenceEnvironment, RegisterBillInput } from "../domain/models";
import { createMoney, currencyScale, decimalToMinor, minorToDecimal } from "../domain/money";
import { token } from "./action-utils";
import { referenceBusinessDate } from "./reference-time";

export interface BillDraftRow {
  key: string;
  recordId: string;
  transactionKind: string;
  externalTransactionId: string;
  amount: string;
  status: string;
  occurredAt: string;
}

export interface BillDraft {
  billId: string;
  revision: string;
  merchantId: string;
  channelId: string;
  currency: string;
  businessDate: string;
  businessTimezone: string;
  idempotencyKey: string;
  rows: BillDraftRow[];
  /** Missing merchant authority requires an explicit choice, never an environment fallback. */
  merchantConfirmationRequired: boolean;
  merchantConfirmed: boolean;
}

export function newBillRow(currentTime?: string | null, transactionKind = "PAYMENT"): BillDraftRow {
  return { key: token("row"), recordId: token("bill-record"), transactionKind, externalTransactionId: "", amount: "100.00", status: "SUCCEEDED", occurredAt: currentTime ?? "" };
}

export function copyBillRow(row: BillDraftRow): BillDraftRow {
  return { ...row, key: token("row"), recordId: token("bill-record") };
}

export function newBillDraft(environment?: ReferenceEnvironment): BillDraft {
  const businessTimezone = environment?.policy?.businessTimezone ?? "Asia/Shanghai";
  return {
    billId: token("bill"), revision: "1", merchantId: environment?.merchantId ?? "reference-merchant",
    channelId: environment?.channelId ?? "", currency: "CNY", businessTimezone,
    businessDate: environment?.currentTime ? referenceBusinessDate(environment.currentTime, businessTimezone) : "",
    idempotencyKey: token("bill-register"), rows: [newBillRow(environment?.currentTime)],
    merchantConfirmationRequired: false, merchantConfirmed: false,
  };
}

export function parseBillRevision(value: unknown): number {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    const message = "Revision 必须是可精确表示的正整数（最大 9007199254740991）";
    throw new BusinessError({
      code: "BILL_REVISION_INVALID", message, retryable: false,
      fields: [{ field: "revision", message, code: "INVALID_INTEGER" }],
      details: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    });
  }
  return Number(text);
}

export function draftFromRevision(bill: AuthoritativeBill, revision: BillRevision): BillDraft {
  const currentRevision = parseBillRevision(bill.currentRevision);
  if (currentRevision === Number.MAX_SAFE_INTEGER) throw new Error("当前 revision 已达安全整数上限，不能递增");
  const merchantId = revision.merchantId || bill.merchantId || "";
  return {
    billId: bill.billId, revision: String(currentRevision + 1), merchantId,
    channelId: revision.channelId, currency: revision.currency, businessDate: revision.businessDate ?? "",
    businessTimezone: revision.businessTimezone ?? bill.businessTimezone ?? "", idempotencyKey: token("bill-register"),
    merchantConfirmationRequired: !merchantId, merchantConfirmed: false,
    rows: revision.records.map((record) => {
      if (record.money.currency !== revision.currency) throw new Error(`记录 ${record.recordIdentity ?? record.recordId} 的币种与账单不同，不能在共享币种草稿中无损复制`);
      return {
        key: token("row"), recordId: record.recordIdentity ?? record.recordId,
        transactionKind: record.transactionKind, externalTransactionId: record.externalTransactionId,
        amount: minorToDecimal(record.money.amountMinor, record.money.currency),
        status: record.rawStatus ?? record.status, occurredAt: record.occurredAt ?? "",
      };
    }),
  };
}

export function isBillInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return isBusinessDate(day);
}

function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateBillDraft(draft: BillDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ["billId", "merchantId", "channelId", "currency", "businessTimezone", "idempotencyKey"] as const) {
    if (!draft[field].trim()) errors[field] = "不能为空";
  }
  try { parseBillRevision(draft.revision); } catch (error) { errors.revision = (error as Error).message; }
  try { currencyScale(draft.currency); } catch { errors.currency = "当前金额精度支持 CNY，请使用受支持币种"; }
  if (!isBusinessDate(draft.businessDate)) errors.businessDate = "请输入有效业务日期";
  try { new Intl.DateTimeFormat("en", { timeZone: draft.businessTimezone }); } catch { errors.businessTimezone = "请输入有效 IANA 业务时区"; }
  if (draft.merchantConfirmationRequired && !draft.merchantConfirmed) errors.merchantId = "账单未返回商户，请填写并确认本次运行商户";
  const ids = new Map<string, number[]>();
  draft.rows.forEach((row, index) => {
    const prefix = `rows.${index}.`;
    for (const field of ["recordId", "transactionKind", "externalTransactionId", "status"] as const) {
      if (!row[field].trim()) errors[prefix + field] = "不能为空";
    }
    const id = row.recordId.trim();
    ids.set(id, [...(ids.get(id) ?? []), index]);
    try {
      const minor = decimalToMinor(row.amount, draft.currency);
      if (BigInt(minor) < 0n) errors[prefix + "amount"] = "账单金额不能为负；退款使用 REFUND 类型且金额为正或零";
    } catch { errors[prefix + "amount"] = "请输入可精确转换的金额（CNY 最多两位小数，不用科学计数法）"; }
    if (!isBillInstant(row.occurredAt)) errors[prefix + "occurredAt"] = "请输入带秒和时区的有效 ISO 时间，如 2024-01-01T00:00:00Z";
  });
  for (const [id, indexes] of ids) if (id && indexes.length > 1) for (const index of indexes) errors[`rows.${index}.recordId`] = `业务记录 ID 重复（第 ${indexes.map((i) => i + 1).join("、")} 行）`;
  return errors;
}

export function billDraftInput(draft: BillDraft, publishedAt: string, fixtureId?: string): RegisterBillInput {
  const errors = validateBillDraft(draft);
  if (Object.keys(errors).length) throw new BusinessError({
    code: "BILL_DRAFT_INVALID", message: "账单草稿有字段需要修正，请查看对应行", retryable: false,
    fields: Object.entries(errors).map(([field, message]) => ({ field, message })),
  });
  if (!isBillInstant(publishedAt)) throw new Error("发布时间无效，请刷新 Reference 环境后重试");
  return {
    billId: draft.billId.trim(), revision: parseBillRevision(draft.revision), merchantId: draft.merchantId.trim(),
    channelId: draft.channelId.trim(), currency: draft.currency.toUpperCase(), businessDate: draft.businessDate,
    businessTimezone: draft.businessTimezone, idempotencyKey: draft.idempotencyKey, fixtureId, publishedAt,
    records: draft.rows.map((row) => ({
      recordId: row.recordId.trim(), recordIdentity: row.recordId.trim(), transactionKind: row.transactionKind,
      externalTransactionId: row.externalTransactionId.trim(), money: createMoney(draft.currency, decimalToMinor(row.amount, draft.currency)),
      status: row.status, rawStatus: row.status, occurredAt: row.occurredAt,
    })),
  };
}

export function billDraftWarnings(draft: BillDraft): string[] {
  const warnings: string[] = [];
  if (!draft.rows.length) warnings.push("空账单实验：本版 records 为空，不会自动补入历史记录。");
  const externalIds = draft.rows.map((row) => row.externalTransactionId.trim()).filter(Boolean);
  if (new Set(externalIds).size < externalIds.length) warnings.push("重复外部交易号实验：各行会原样提交，后端可能裁决为 DUPLICATE；不会合并或去重。");
  if (draft.rows.some((row) => /^0+(?:\.0+)?$/.test(row.amount.trim()))) warnings.push("零金额实验：零金额记录将原样发布，由后端裁决。");
  return warnings;
}
