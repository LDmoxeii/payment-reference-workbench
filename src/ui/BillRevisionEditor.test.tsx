// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as confirmation from "./confirmation";
import type { AuthoritativeBill, ReferenceEnvironment, RegisterBillInput } from "../domain/models";
import type { PaymentWorkbenchService } from "../services/workbench-service";
import { BillRevisionEditor } from "./BillRevisionEditor";
import { consumeBillReconciliationHint } from "./bill-navigation";

let root: Root;
let page: HTMLDivElement;
const environment: ReferenceEnvironment = { fixtureId: "fixture", merchantId: "merchant", channelId: "channel", actorAlias: "operator", currentTime: "2047-06-10T06:00:00Z", policy: { businessTimezone: "Asia/Shanghai" } };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root.unmount()); page?.remove(); vi.restoreAllMocks(); consumeBillReconciliationHint(); });
async function render(node: ReactNode) { page = document.createElement("div"); document.body.append(page); root = createRoot(page); await act(async () => { root.render(node); }); }
async function click(text: string, scope: Element = page) { const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text); if (!button) throw new Error(text); await act(async () => { button.click(); }); }
function field(label: string, scope: Element = page): HTMLInputElement { const value = [...scope.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement>("input"); if (!value) throw new Error(label); return value; }
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function submit() { await act(async () => { page.querySelector("form[novalidate]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
function authoritative(input: RegisterBillInput): AuthoritativeBill { return { billId: input.billId, merchantId: input.merchantId, channelId: input.channelId, currency: input.currency, currentRevision: input.revision, businessTimezone: input.businessTimezone, source: { adapter: "wow" }, revisions: [{ ...input, publishedAt: input.publishedAt, records: input.records.map((record, index) => ({ ...record, recordId: `resource-uuid-${index}` })) }] }; }
function service(overrides: Record<string, unknown> = {}) { return { executeReference: vi.fn(), getBill: vi.fn(), ...overrides } as unknown as PaymentWorkbenchService; }

describe("完整账单编辑器", () => {
  it("结构化添加/复制/删除 PAYMENT 与 REFUND，逐行校验且取消发布不发命令", async () => {
    const executeReference = vi.fn(); const confirm = vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(false);
    await render(<BillRevisionEditor service={service({ executeReference })} environment={environment} />);
    await click("添加记录");
    let rows = page.querySelectorAll(".bill-editor__row");
    await change(rows[1].querySelector("select")!, "REFUND");
    await change(field("金额（CNY 元）", rows[1]), "20.00");
    await change(field("外部交易号", rows[0]), "payment-external"); await change(field("外部交易号", rows[1]), "refund-external");
    const originalId = field("业务记录 ID", rows[0]).value;
    await click("复制此行", rows[0]); rows = page.querySelectorAll(".bill-editor__row");
    expect(rows).toHaveLength(3); expect(field("业务记录 ID", rows[1]).value).not.toBe(originalId);
    expect(field("外部交易号", rows[1]).value).toBe("payment-external");
    await click("删除此行", rows[1]); expect(page.querySelectorAll(".bill-editor__row")).toHaveLength(2);
    await change(field("金额（CNY 元）", page.querySelectorAll(".bill-editor__row")[1]), "20.001"); await submit();
    expect(confirm).not.toHaveBeenCalled(); expect(executeReference).not.toHaveBeenCalled(); expect(page.textContent).toContain("CNY 最多两位小数");
    await change(field("金额（CNY 元）", page.querySelectorAll(".bill-editor__row")[1]), "20.00"); await submit();
    expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toContain("共 2 条记录"); expect(executeReference).not.toHaveBeenCalled();
  });

  it("历史版整版复制保留业务行身份/时区/原状态，目标取 currentRevision+1", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true);
    const bill: AuthoritativeBill = { billId: "history", channelId: "old-channel", merchantId: "old-merchant", currency: "CNY", currentRevision: "7", source: { adapter: "cap4k" }, revisions: [{ billId: "history", revision: "2", channelId: "old-channel", merchantId: "old-merchant", currency: "CNY", businessDate: "2040-01-02", businessTimezone: "America/New_York", records: [{ recordId: "uuid", recordIdentity: "original-business-id", transactionKind: "REFUND", externalTransactionId: "external-original", money: { currency: "CNY", amountMinor: "2000" }, status: "SUCCEEDED", rawStatus: "RAW_SUCCESS", occurredAt: "2040-01-02T06:00:00Z" }] }] };
    await render(<BillRevisionEditor service={service({ getBill: vi.fn().mockResolvedValue(bill) })} environment={environment} />);
    await change(field("查询 Bill ID"), "history"); await click("查询账单与版本"); await change(page.querySelector(".bill-editor__history select")!, "2"); await click("复制完整版本为新草稿");
    const form = page.querySelector("form[novalidate]")!;
    expect(field("Revision", form).value).toBe("8"); expect(field("业务时区", form).value).toBe("America/New_York");
    expect(field("业务记录 ID", form).value).toBe("original-business-id"); expect(field("渠道原状态", form).value).toBe("RAW_SUCCESS");
    expect(field("记录发生时间（ISO）", form).value).toBe("2040-01-02T06:00:00Z"); expect(field("金额（CNY 元）", form).value).toBe("20.00");
    expect(bill.currentRevision).toBe("7"); expect(bill.revisions![0].records[0].recordId).toBe("uuid");
  });

  it("丢响应后重试冻结完整载荷与发布时间，编辑后换 identity，权威回读才导航", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true);
    let input: RegisterBillInput;
    const executeReference = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockImplementation(async (command) => { input = command.input; return { effect: "applied", summary: "applied" }; });
    const getBill = vi.fn(async () => authoritative(input)); const published = vi.fn();
    const api = service({ executeReference, getBill });
    await render(<BillRevisionEditor service={api} environment={environment} onPublished={published} />);
    await change(field("外部交易号"), "payment-external"); await submit();
    const first = structuredClone(executeReference.mock.calls[0][0].input);
    await act(async () => { root.render(<BillRevisionEditor service={api} environment={{ ...environment, currentTime: "2048-01-01T00:00:00Z" }} onPublished={published} />); });
    await submit(); expect(executeReference.mock.calls[1][0].input).toEqual(first); expect(getBill).toHaveBeenCalledOnce(); expect(published).toHaveBeenCalledOnce();
    expect(page.textContent).toContain("权威回读已确认"); await click("前往对账（核对上下文后手动运行）");
    expect(consumeBillReconciliationHint()).toMatchObject({ billId: first.billId, revision: 1, merchantId: "merchant", merchantSource: "bill" });
    await change(field("外部交易号", page.querySelector("form[novalidate]")!), "edited-external");
    expect(field("本次发布幂等键（自动管理）").value).not.toBe(first.idempotencyKey); expect(page.textContent).toContain("已生成新的命令幂等键");
  });

  it("applied 后回读失败不假成功，同一发布可继续回读且不重发", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true); let input: RegisterBillInput;
    const executeReference = vi.fn(async (command) => { input = command.input; return { effect: "applied", summary: "applied" }; });
    const getBill = vi.fn().mockRejectedValueOnce(new Error("network read failed")).mockImplementation(async () => authoritative(input));
    await render(<BillRevisionEditor service={service({ executeReference, getBill })} environment={environment} />);
    await change(field("外部交易号"), "payment-external"); await submit();
    expect(page.textContent).not.toContain("权威回读已确认本版账单"); expect(page.textContent).toContain("网络");
    await click("继续回读已发布账单"); expect(executeReference).toHaveBeenCalledOnce(); expect(getBill).toHaveBeenCalledTimes(2); expect(page.textContent).toContain("权威回读已确认");
  });

  it("receipt 与 Operation 保留，继续观察不能重复发布", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true); let input: RegisterBillInput;
    const receipt = { operationId: "op-bill", acceptance: "ACCEPTED", commandType: "RegisterBill", resource: { resourceType: "Bill", resourceId: "bill" }, readAfter: { mode: "READ_ONCE" } };
    const executeReference = vi.fn(async (command) => { input = command.input; return { effect: "applied", summary: "accepted", receipt }; });
    const getOperation = vi.fn().mockRejectedValueOnce(new Error("observation offline")).mockResolvedValue({ operationId: "op-bill", status: "SUCCEEDED", source: { adapter: "wow" } });
    await render(<BillRevisionEditor service={service({ executeReference, getOperation, getBill: vi.fn(async () => authoritative(input)) })} environment={environment} />);
    await change(field("外部交易号"), "external"); await submit(); expect(page.textContent).toContain("op-bill");
    await click("继续观察同一 Operation"); expect(executeReference).toHaveBeenCalledOnce(); expect(page.textContent).toContain("权威回读已确认");
  });

  it("权威 revision 内容不匹配时禁止成功与导航", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true); let input: RegisterBillInput;
    const executeReference = vi.fn(async (command) => { input = command.input; return { effect: "applied", summary: "applied" }; });
    await render(<BillRevisionEditor service={service({ executeReference, getBill: vi.fn(async () => { const result = authoritative(input); result.revisions![0].records[0].money = { currency: "CNY", amountMinor: "999" }; return result; }) })} environment={environment} />);
    await change(field("外部交易号"), "external"); await submit(); expect(page.textContent).toContain("BILL_PUBLICATION_MISMATCH"); expect(page.textContent).not.toContain("权威回读已确认本版账单");
  });

  it("并发重复提交只发一次，缺真实时钟拒绝发布", async () => {
    vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(true);
    let finish!: (value: unknown) => void; const executeReference = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    await render(<BillRevisionEditor service={service({ executeReference })} environment={environment} />); await change(field("外部交易号"), "external");
    await submit(); await submit(); expect(executeReference).toHaveBeenCalledOnce();
    await act(async () => { finish({ effect: "unavailable", summary: "not applied" }); });
    await act(async () => { root.render(<BillRevisionEditor key="new" service={service({ executeReference })} environment={{ ...environment, currentTime: null }} />); });
    await submit(); expect(page.textContent).toContain("REFERENCE_CLOCK_UNAVAILABLE"); expect(executeReference).toHaveBeenCalledOnce();
  });
});
