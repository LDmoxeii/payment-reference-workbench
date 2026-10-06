// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as confirmation from "../confirmation";
import type { AuthoritativeBill, OperationReceipt, ReconciliationRun, ReferenceEnvironment } from "../../domain/models";
import { BusinessError } from "../../domain/errors";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { setBillReconciliationHint, consumeBillReconciliationHint } from "../bill-navigation";
import { ReconciliationPage } from "./ReconciliationPage";
import { WorkbenchNoticeProvider } from "../WorkbenchNotice";

let root: Root; let page: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root.unmount()); page?.remove(); vi.restoreAllMocks(); consumeBillReconciliationHint(); });
const environment: ReferenceEnvironment = { fixtureId: "fixture", merchantId: "environment-merchant", channelId: "channel", actorAlias: "operator", currentTime: "2047-06-10T06:00:00Z", policy: { businessTimezone: "Asia/Shanghai", enabledCurrencies: ["CNY"] } };
function run(id = "run-a"): ReconciliationRun { return { resourceType: "reconciliationRun", runId: id, billId: "bill", billRevision: 1, merchantIds: ["merchant-authoritative"], scope: { channelId: "channel", currency: "CNY", businessDate: "2047-06-10", businessTimezone: "Asia/Shanghai" }, status: "ACTION_REQUIRED", finality: "NON_FINAL", settlementBlocked: true, detailsComplete: true, matchedCount: 1, differenceCount: 3, unresolvedDifferenceCount: 3, blockingDifferenceCount: 3, differences: ["MATCHED", "PLATFORM_ONLY", "PLATFORM_ONLY", "PLATFORM_ONLY"].map((type, i) => ({ differenceId: `${id}-detail-${i}`, differenceType: type as "MATCHED" | "PLATFORM_ONLY", resolved: i === 0, settlementBlocked: i !== 0, platformEvidenceRefs: [{ evidenceType: "platform", evidenceId: "platform-evidence" }], billEvidenceRefs: [{ evidenceType: "bill", evidenceId: "bill-evidence" }], dispositions: [], confirmations: [] })), actions: [{ kind: "DISPOSE_RECONCILIATION_DIFFERENCE", label: "处置差异", executable: true, availability: "full", confirmation: "none" }], source: { adapter: "wow" } }; }
async function render(api: PaymentWorkbenchService) { page = document.createElement("div"); document.body.append(page); root = createRoot(page); await act(async () => { root.render(<WorkbenchNoticeProvider><ReconciliationPage service={api} /></WorkbenchNoticeProvider>); }); }
function service(overrides: Record<string, unknown> = {}): PaymentWorkbenchService { return { getReferenceEnvironment: vi.fn().mockResolvedValue(environment), listReconciliationRuns: vi.fn().mockResolvedValue({ items: [run()], pageSize: 10, nextCursor: null }), getReconciliationRun: vi.fn().mockResolvedValue(run()), execute: vi.fn(), ...overrides } as unknown as PaymentWorkbenchService; }
async function click(text: string, scope: Element = page) { const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text); if (!button) throw new Error(text); await act(async () => { button.click(); }); }
function detailSection() { return [...page.querySelectorAll("section")].find((section) => section.querySelector("h2")?.textContent === "对账明细")!; }
function field(label: string, scope: Element): HTMLInputElement { return [...scope.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === label)!.querySelector("input")!; }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

describe("对账明细与真实差异处置", () => {
  it.each([false, true])("账单通知回读账单而非 Run，保留当前 Run 并提示显式创建（继续观察：%s）", async (resume) => {
    const bill: AuthoritativeBill = { billId: "bill-bc0c625b", currentRevision: 1, channelId: "fake", currency: "CNY", merchantId: "merchant", revisions: [], source: { adapter: "wow" } };
    const receipt: OperationReceipt = { operationId: "op-bill", commandType: "BillAvailable", resource: { resourceType: "AuthoritativeBill", resourceId: bill.billId }, acceptanceStatus: "ACCEPTED", idempotentReplay: false, readAfter: { mode: "READ_ONCE", operationUrl: "/operations/op-bill" }, source: { adapter: "wow" } };
    const getBill = vi.fn().mockResolvedValue(bill);
    if (resume) getBill.mockRejectedValueOnce(new BusinessError({ code: "RESOURCE_NOT_READY", message: "账单稍后可读", fields: [], retryable: true }));
    const api = service({ getBill, execute: vi.fn().mockResolvedValue(receipt), getOperation: vi.fn().mockResolvedValue({ operationId: "op-bill", status: "SUCCEEDED" }) });
    await render(api); await click("详情");
    const form = [...page.querySelectorAll("form")].find((item) => item.textContent?.includes("通知账单可用"))!;
    await change(field("Bill ID", form), bill.billId);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    if (resume) {
      const button = [...page.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("继续观察"))!;
      expect(button).toBeDefined();
      await act(async () => { button.click(); });
    }
    expect(getBill).toHaveBeenCalledWith(bill.billId);
    expect(page.textContent).toContain(`${bill.billId} · current revision 1`);
    expect(page.textContent).toContain("请核对右侧表单后显式创建 ReconciliationRun");
    expect(page.querySelector(".detail-heading")?.textContent).toContain("run-a");
    expect(api.getReconciliationRun).toHaveBeenCalledTimes(1);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(page.querySelector(".error-block")).toBeNull();
  });

  it("账单通知返回 Run 时仍展示该运行，不提示重复创建", async () => {
    const value = run("signal-run");
    const api = service({ execute: vi.fn().mockResolvedValue({ operationId: "op-run", resource: { resourceType: "ReconciliationRun", resourceId: value.runId }, readAfter: { mode: "READ_ONCE" }, source: { adapter: "cap4k" } }), getOperation: vi.fn().mockResolvedValue({ operationId: "op-run", status: "SUCCEEDED" }), getReconciliationRun: vi.fn().mockResolvedValue(value) });
    await render(api);
    const form = [...page.querySelectorAll("form")].find((item) => item.textContent?.includes("通知账单可用"))!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(page.querySelector(".detail-heading")?.textContent).toContain("signal-run");
    expect(page.textContent).not.toContain("请核对右侧表单后显式创建 ReconciliationRun");
    expect(api.execute).toHaveBeenCalledTimes(1);
  });

  it("4/1/3 汇总与 4/3/1 筛选；MATCHED只读且伪造submit不能发处置", async () => {
    const execute = vi.fn(); await render(service({ execute })); await click("详情");
    const section = detailSection(); expect(section.textContent).toContain("总明细4"); expect(section.textContent).toContain("匹配1"); expect(section.textContent).toContain("真实差异3"); expect(section.querySelectorAll("tbody tr")).toHaveLength(4);
    await click("仅差异", section); expect(section.querySelectorAll("tbody tr")).toHaveLength(3);
    await click("仅匹配", section); expect(section.querySelectorAll("tbody tr")).toHaveLength(1);
    await click("run-a-detail-0", section); expect(page.textContent).toContain("这是匹配记录，只查看证据");
    const form = page.querySelector(".action-form form")!; expect(field("Difference ID", form).value).toBe("");
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; expect(submit.disabled).toBe(true);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(execute).not.toHaveBeenCalled(); expect(page.textContent).toContain("INVALID_DIFFERENCE_SELECTION");
    await click("仅差异", section); await click("run-a-detail-1", section); expect(submit.disabled).toBe(false);
  });

  it("匹配但阻断/未解决不消失；已解决差异保留原证据和追加历史", async () => {
    const value = run(); value.differences[0].resolved = false; value.differences[0].settlementBlocked = true;
    value.differences[1].resolved = true; value.differences[1].settlementBlocked = false;
    value.differences[1].dispositions = [{ actorId: "real-actor", reason: "historic-reason", evidenceRefs: [{ evidenceType: "reference", evidenceId: "historic-evidence" }], recordedAt: environment.currentTime }];
    await render(service({ getReconciliationRun: vi.fn().mockResolvedValue(value) })); await click("详情");
    await click("run-a-detail-0", detailSection()); expect(page.textContent).toContain("ManualReview"); expect(detailSection().querySelectorAll("tbody tr")[0].textContent).toContain("未解决阻断");
    await click("run-a-detail-1", detailSection()); expect(page.textContent).toContain("historic-reason"); expect(page.textContent).toContain("historic-evidence"); expect(page.textContent).toContain("platform-evidence");
  });

  it("不完整且缺计数/三态时显示未知，不擅自填0/未阻断", async () => {
    const value = run(); value.detailsComplete = false; value.matchedCount = null; value.differenceCount = null; value.unresolvedDifferenceCount = null; value.blockingDifferenceCount = null; value.settlementBlocked = null; value.differences[1].resolved = null; value.differences[1].settlementBlocked = null;
    await render(service({ getReconciliationRun: vi.fn().mockResolvedValue(value) })); await click("详情");
    expect(detailSection().textContent).toContain("总明细未知"); expect(detailSection().textContent).toContain("真实差异未知"); expect(detailSection().textContent).toContain("结算阻断：未知");
  });

  it("快速切换 Run 不接受旧查询的迟到响应", async () => {
    let resolveA!: (value: ReconciliationRun) => void;
    const a = run("a"); const b = run("b");
    await render(service({ listReconciliationRuns: vi.fn().mockResolvedValue({ items: [a, b], pageSize: 10, nextCursor: null }), getReconciliationRun: vi.fn((id) => id === "a" ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve(b)) }));
    const buttons = page.querySelectorAll<HTMLButtonElement>("tbody tr button");
    await act(async () => { buttons[0].click(); }); await act(async () => { buttons[1].click(); });
    expect(page.querySelector(".detail-heading")?.textContent).toContain("b");
    await act(async () => { resolveA(a); }); expect(page.querySelector(".detail-heading")?.textContent).toContain("b"); expect(detailSection().textContent).not.toContain("a-detail");
  });

  it("账单导航再次权威查询并预填，环境不覆盖；不自动运行或用环境商户冒充", async () => {
    setBillReconciliationHint({ billId: "bill-new", revision: 2, merchantId: "user-confirmed", merchantSource: "user-confirmed", channelId: "old", currency: "CNY", businessDate: "old", businessTimezone: "old" });
    const getBill = vi.fn().mockResolvedValue({ billId: "bill-new", currentRevision: 2, currency: "CNY", channelId: "actual-channel", revisions: [{ revision: 2, merchantId: "", channelId: "actual-channel", currency: "CNY", businessDate: "2041-02-03", businessTimezone: "UTC", records: [] }] });
    const execute = vi.fn(); await render(service({ getBill, execute }));
    const form = [...page.querySelectorAll("form")].find((item) => item.textContent?.includes("创建 ReconciliationRun"))!;
    expect(getBill).toHaveBeenCalledWith("bill-new"); expect(field("商户", form).value).toBe("user-confirmed"); expect(field("渠道", form).value).toBe("actual-channel"); expect(field("Revision", form).value).toBe("2"); expect(field("业务日期", form).value).toBe("2041-02-03");
    expect(page.textContent).toContain("账单未返回商户"); expect(page.textContent).toContain("尚未自动运行对账"); expect(execute).not.toHaveBeenCalled();
  });
});

describe("对账 revision 安全输入", () => {
  it.each(["通知账单可用", "创建 ReconciliationRun"])("%s rejects unsafe and non-integer text without a command and shows a viewport notice", async (label) => {
    const execute = vi.fn(); await render(service({ execute }));
    const form = [...page.querySelectorAll("form")].find((item) => item.textContent?.includes(label))!;
    const revision = field("Revision", form);
    for (const value of ["9007199254740993", "1.5", "1e3", "0", ""]) {
      await change(revision, value);
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(execute).not.toHaveBeenCalled();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain("BILL_REVISION_INVALID");
      expect(page.querySelector('[aria-live="assertive"]')?.textContent).toContain("9007199254740991");
      expect(revision.value).toBe(value);
    }
  });

  it.each(["通知账单可用", "创建 ReconciliationRun"])("%s passes a safe revision above Int32 to the unified service unchanged", async (label) => {
    const execute = vi.fn().mockRejectedValue(new Error("stub after command capture")); await render(service({ execute }));
    const form = [...page.querySelectorAll("form")].find((item) => item.textContent?.includes(label))!;
    await change(field("Revision", form), "2147483648");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ revision: 2147483648 }) }));
  });

  it("rerun preserves cancellation and catches an unsafe authoritative revision after confirmation", async () => {
    const confirm = vi.spyOn(confirmation, "requestConfirmation").mockResolvedValue(false);
    const value = run(); value.billRevision = "9007199254740993";
    value.actions.push({ kind: "RERUN_RECONCILIATION", label: "重跑", executable: true, availability: "full", confirmation: "confirm" });
    const execute = vi.fn(); await render(service({ getReconciliationRun: vi.fn().mockResolvedValue(value), execute })); await click("详情");
    await click("重跑"); expect(execute).not.toHaveBeenCalled(); expect(page.querySelector('[role="alert"]')).toBeNull();
    confirm.mockResolvedValue(true); await click("重跑");
    expect(execute).not.toHaveBeenCalled(); expect(page.querySelector('[role="alert"]')?.textContent).toContain("BILL_REVISION_INVALID");
  });
});
