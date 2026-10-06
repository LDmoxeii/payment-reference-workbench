import { describe, expect, it } from "vitest";
import type { AuthoritativeBill, BillRevision, ReferenceEnvironment } from "../domain/models";
import { billDraftInput, billDraftWarnings, copyBillRow, draftFromRevision, newBillDraft, parseBillRevision, validateBillDraft } from "./bill-draft";
import { consumeBillReconciliationHint, setBillReconciliationHint } from "./bill-navigation";

const environment: ReferenceEnvironment = { fixtureId: "fixture", merchantId: "merchant", channelId: "fake", actorAlias: "operator", currentTime: "2047-01-01T00:00:00Z", policy: { businessTimezone: "Asia/Shanghai" } };
const revision: BillRevision = { billId: "bill", revision: 1, merchantId: "merchant", channelId: "fake", currency: "CNY", businessDate: "2047-01-01", businessTimezone: "Asia/Tokyo", publishedAt: "2047-01-02T00:00:00Z", rawEvidence: "old-proof", records: [{ recordId: "resource-uuid", recordIdentity: "business-row", transactionKind: "REFUND", externalTransactionId: "external", money: { currency: "CNY", amountMinor: "900719925474099312" }, status: "UNKNOWN", rawStatus: "PENDING_SETTLEMENT", occurredAt: "2047-01-01T01:02:03Z", rawEvidence: "record-proof" }] };
const bill: AuthoritativeBill = { billId: "bill", channelId: "fake", merchantId: "merchant", currency: "CNY", currentRevision: "4", revisions: [revision], source: { adapter: "cap4k" } };

describe("完整账单草稿", () => {
  it("选择旧版本复制全部业务字段，版本为最新+1，证据不伪装成新证据", () => {
    const before = JSON.stringify(bill); const draft = draftFromRevision(bill, revision);
    expect(draft.revision).toBe("5"); expect(draft.businessTimezone).toBe("Asia/Tokyo");
    expect(draft.rows[0]).toMatchObject({ recordId: "business-row", transactionKind: "REFUND", status: "PENDING_SETTLEMENT", amount: "9007199254740993.12", occurredAt: "2047-01-01T01:02:03Z" });
    const input = billDraftInput(draft, environment.currentTime!, "fixture");
    expect(input.records[0].money.amountMinor).toBe("900719925474099312");
    expect(input.records[0].rawEvidence).toBeUndefined(); expect(JSON.stringify(bill)).toBe(before);
  });
  it("单行复制生成新业务身份但外部号可以重复", () => {
    const draft = draftFromRevision(bill, revision); const copy = copyBillRow(draft.rows[0]);
    expect(copy.recordId).not.toBe(draft.rows[0].recordId); expect(copy.externalTransactionId).toBe("external");
    draft.rows.push(copy); expect(validateBillDraft(draft)).toEqual({}); expect(billDraftWarnings(draft).join(" ")).toContain("重复外部交易号");
  });
  it("重复业务 ID 与失真金额精确定位到行，不发半个快照", () => {
    const draft = draftFromRevision(bill, revision); draft.rows.push({ ...draft.rows[0], key: "other", amount: "1.001" });
    expect(validateBillDraft(draft)).toHaveProperty("rows.0.recordId"); expect(validateBillDraft(draft)).toHaveProperty("rows.1.recordId"); expect(validateBillDraft(draft)).toHaveProperty("rows.1.amount");
    expect(() => billDraftInput(draft, environment.currentTime!)).toThrow();
  });
  it("零金额和空账单允许发布", () => {
    const draft = draftFromRevision(bill, revision); draft.rows[0].amount = "0.00";
    expect(billDraftInput(draft, environment.currentTime!).records[0].money.amountMinor).toBe("0");
    draft.rows = []; expect(billDraftInput(draft, environment.currentTime!).records).toEqual([]); expect(billDraftWarnings(draft)[0]).toContain("空账单");
  });
  it("缺商户必须人工确认，不从环境伪造权威归属", () => {
    const draft = draftFromRevision({ ...bill, merchantId: null }, { ...revision, merchantId: "" });
    expect(draft.merchantId).toBe(""); expect(draft.merchantConfirmationRequired).toBe(true);
    draft.merchantId = "merchant"; expect(validateBillDraft(draft).merchantId).toContain("确认");
    draft.merchantConfirmed = true; expect(validateBillDraft(draft)).toEqual({});
  });
  it("无效/溢出版本和无效时刻拒绝，初始化不用电脑时间", () => {
    for (const value of [null, "", 0, "1.5", "1e3", "9007199254740992"]) expect(() => parseBillRevision(value)).toThrow();
    expect(parseBillRevision("2147483648")).toBe(2147483648);
    expect(parseBillRevision("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => draftFromRevision({ ...bill, currentRevision: Number.MAX_SAFE_INTEGER }, revision)).toThrow();
    const draft = newBillDraft(); expect(draft.rows[0].occurredAt).toBe("");
    const valid = draftFromRevision(bill, revision); valid.rows[0].occurredAt = "2047-02-30T00:00:00Z";
    expect(validateBillDraft(valid)["rows.0.occurredAt"]).toBeTruthy();
  });
  it("导航提示只消费一次，不是权威资源缓存", () => {
    setBillReconciliationHint({ billId: "bill", revision: 2, merchantId: "merchant", channelId: "fake", currency: "CNY", businessDate: "2047-01-01", businessTimezone: "Asia/Shanghai", merchantSource: "user-confirmed" });
    expect(consumeBillReconciliationHint()?.revision).toBe(2); expect(consumeBillReconciliationHint()).toBeUndefined();
  });
});
