// @vitest-environment jsdom
import { act, StrictMode, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentWorkbenchService } from "../services/workbench-service";
import type { AuthoritativeBill, Payment, Refund, ReferenceEnvironment, RegisterBillInput } from "../domain/models";
import { BillRevisionEditor } from "./BillRevisionEditor";
import { ConfirmationHost } from "./ConfirmationHost";
import { answerConfirmation, getConfirmation, requestConfirmation, useConfirmationScope } from "./confirmation";
import { PaymentsPage } from "./pages/PaymentsPage";
import { RefundsPage } from "./pages/RefundsPage";

let root: Root | undefined;
let page: HTMLDivElement | undefined;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  page?.remove(); page = undefined; root = undefined;
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  page = document.createElement("div"); document.body.append(page);
  root = createRoot(page);
  await act(async () => root!.render(node));
}
async function click(text: string, within: ParentNode = document) {
  const button = [...within.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(text);
  await act(async () => { button.click(); });
}
function dialog() { return document.querySelector<HTMLElement>("[role=dialog]"); }
function Harness({ context = "payment-a", onCommand }: { context?: string; onCommand: (context: string) => void }) {
  const scope = useConfirmationScope(context);
  const [draft, setDraft] = useState("draft retained");
  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (await requestConfirmation("提交可信资金结果\n\n确认当前输入与资源正确。", scope) && scope.active) onCommand(context);
  }}>
    <input aria-label="草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button type="submit">发起操作</button>
  </form>;
}

describe("页面内业务确认", () => {
  it("缺少 Host 时拒绝命令，不退回原生对话框或自动接受", async () => {
    const native = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await requestConfirmation("不可隐式接受")).toBe(false);
    expect(native).not.toHaveBeenCalled();
  });

  it("明确确认前不发命令，重复提交不排队，确认双击仅执行一次且不调用原生框", async () => {
    const command = vi.fn(); const native = vi.spyOn(window, "confirm");
    await render(<><ConfirmationHost /><Harness onCommand={command} /></>);
    await click("发起操作");
    expect(command).not.toHaveBeenCalled(); expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.textContent).toContain("提交可信资金结果");
    await click("发起操作");
    const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "确认继续")!;
    await act(async () => { confirm.click(); confirm.click(); });
    expect(command).toHaveBeenCalledOnce(); expect(command).toHaveBeenCalledWith("payment-a");
    expect(dialog()).toBeNull(); expect(native).not.toHaveBeenCalled();
  });

  it("取消与 Escape 保留输入和 identity，并不发命令", async () => {
    const command = vi.fn();
    await render(<><ConfirmationHost /><Harness onCommand={command} /></>);
    await click("发起操作"); await click("取消操作");
    expect(command).not.toHaveBeenCalled(); expect(page!.querySelector("input")!.value).toBe("draft retained");
    await click("发起操作");
    await act(async () => { dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(dialog()).toBeNull(); expect(command).not.toHaveBeenCalled();
    expect(page!.querySelector("input")!.value).toBe("draft retained");
  });

  it("默认聚焦取消，Tab / Shift+Tab 锁在对话框，关闭后恢复焦点与背景", async () => {
    await render(<><ConfirmationHost /><Harness onCommand={vi.fn()} /></>);
    const trigger = page!.querySelector("button")!; trigger.focus();
    await click("发起操作");
    const buttons = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")];
    expect(document.activeElement).toBe(buttons[0]); expect(page!.inert).toBe(true);
    await act(async () => { buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => { buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(buttons[0]);
    await click("取消操作");
    expect(document.activeElement).toBe(trigger); expect(page!.inert).not.toBe(true); expect(document.body.style.overflow).toBe("");
  });

  it("切换资源自动取消旧确认，旧确认按钮不能执行旧资源命令", async () => {
    const command = vi.fn();
    await render(<><ConfirmationHost /><Harness onCommand={command} /></>);
    await click("发起操作"); const oldId = getConfirmation()!.id;
    await act(async () => { root!.render(<><ConfirmationHost /><Harness context="payment-b" onCommand={command} /></>); });
    expect(dialog()).toBeNull();
    await act(async () => { answerConfirmation(oldId, true); });
    expect(command).not.toHaveBeenCalled();
    await click("发起操作"); await click("确认继续");
    expect(command).toHaveBeenCalledOnce(); expect(command).toHaveBeenCalledWith("payment-b");
  });

  it("离开页面或卸载 Host 时取消等待，不执行离开页面的命令", async () => {
    const command = vi.fn();
    await render(<><ConfirmationHost /><Harness onCommand={command} /></>);
    await click("发起操作");
    await act(async () => { root!.render(<ConfirmationHost />); });
    expect(dialog()).toBeNull(); expect(command).not.toHaveBeenCalled();
    await act(async () => { root!.render(<><ConfirmationHost /><Harness onCommand={command} /></>); });
    await click("发起操作");
    await act(async () => { root!.render(<Harness onCommand={command} />); });
    expect(dialog()).toBeNull(); expect(command).not.toHaveBeenCalled(); expect(getConfirmation()).toBeUndefined();
  });

  it("StrictMode 下仍需明确选择，确认未被模拟重挂载自动接受", async () => {
    const command = vi.fn();
    await render(<StrictMode><ConfirmationHost /><Harness onCommand={command} /></StrictMode>);
    await click("发起操作"); expect(command).not.toHaveBeenCalled();
    await click("确认继续"); expect(command).toHaveBeenCalledOnce();
  });

  it("确认同一任务中随即离开页面，已失效上下文不能发送命令", async () => {
    const command = vi.fn();
    await render(<><ConfirmationHost /><Harness onCommand={command} /></>);
    await click("发起操作");
    const request = getConfirmation()!;
    await act(async () => {
      answerConfirmation(request.id, true);
      root!.render(<ConfirmationHost />);
    });
    expect(command).not.toHaveBeenCalled();
  });
});

const environment: ReferenceEnvironment = {
  fixtureId: "fixture", merchantId: "merchant", channelId: "channel", actorAlias: "operator",
  currentTime: "2047-06-10T06:00:00Z", policy: { businessTimezone: "Asia/Shanghai" },
};
function field(label: string): HTMLInputElement {
  const value = [...page!.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement>("input");
  if (!value) throw new Error(label); return value;
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submitBill() {
  await act(async () => { page!.querySelector("form[novalidate]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
describe("账单发布显式确认集成", () => {
  it("取消完整版本发布及草稿替换，不发命令、不丢行、外部号和幂等键", async () => {
    const executeReference = vi.fn();
    const api = { executeReference, getBill: vi.fn() } as unknown as PaymentWorkbenchService;
    await render(<><ConfirmationHost /><BillRevisionEditor service={api} environment={environment} /></>);
    await change(field("外部交易号"), "external-payment");
    const identity = field("本次发布幂等键（自动管理）").value;
    await submitBill(); expect(dialog()?.textContent).toContain("每版是完整快照");
    await click("取消操作");
    expect(executeReference).not.toHaveBeenCalled(); expect(field("外部交易号").value).toBe("external-payment");
    expect(field("本次发布幂等键（自动管理）").value).toBe(identity);
    await click("新建独立账单"); await click("取消操作");
    expect(field("外部交易号").value).toBe("external-payment"); expect(field("本次发布幂等键（自动管理）").value).toBe(identity);
  });

  it("等待确认时重复发布不排队，确认后只发送一次并完成真实统一回读", async () => {
    let input: RegisterBillInput;
    const executeReference = vi.fn(async (command) => { input = command.input; return { effect: "applied", summary: "applied" }; });
    const getBill = vi.fn(async (): Promise<AuthoritativeBill> => ({
      billId: input.billId, merchantId: input.merchantId, channelId: input.channelId, currency: input.currency,
      currentRevision: input.revision, businessTimezone: input.businessTimezone,
      revisions: [{ ...input, records: input.records }], source: { adapter: "wow" },
    }));
    const api = { executeReference, getBill } as unknown as PaymentWorkbenchService;
    await render(<><ConfirmationHost /><BillRevisionEditor service={api} environment={environment} /></>);
    await change(field("外部交易号"), "external-payment");
    await submitBill(); await submitBill();
    expect(executeReference).not.toHaveBeenCalled();
    await click("确认继续");
    expect(executeReference).toHaveBeenCalledOnce(); expect(getBill).toHaveBeenCalledOnce();
    expect(page!.textContent).toContain("权威回读已确认本版账单");
  });
});

describe("资金页面异步确认集成", () => {
  it.each(["payment", "refund"] as const)("%s 等待确认时不发结果命令，取消保留 identity，确认只发当前资源一次", async (kind) => {
    const execute = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const payment: Payment = {
      resourceType: "payment", paymentId: "pay-a", merchantId: "merchant", merchantOrderId: "order",
      paymentMethod: "DEFAULT", money: { currency: "CNY", amountMinor: "10000" }, status: "SUCCEEDED", finality: "FINAL",
      attempts: [{ attemptId: "attempt-a", channelId: "channel", status: "SUCCEEDED", externalTransactionId: "external-a", submissions: [], receipts: [] }],
      reviewIds: [], actions: [{ kind: "RECEIVE_PAYMENT_RESULT", label: "支付结果", executable: true, availability: "full", confirmation: "danger" }], source: { adapter: "wow" },
    };
    const refund: Refund = {
      resourceType: "refund", refundId: "refund-a", paymentId: payment.paymentId, merchantId: "merchant", merchantRefundId: "merchant-refund",
      money: { currency: "CNY", amountMinor: "2000" }, status: "SUCCEEDED", finality: "FINAL",
      attempts: [{ attemptId: "refund-attempt-a", channelId: "channel", status: "SUCCEEDED", externalTransactionId: "refund-external-a", submissions: [], receipts: [] }],
      reviewIds: [], actions: [{ kind: "RECEIVE_REFUND_RESULT", label: "退款结果", executable: true, availability: "full", confirmation: "danger" }], source: { adapter: "wow" },
    };
    const api = {
      profile: { id: "wow", label: "Reference", apiBaseUrl: "/api", referenceOnly: true, capabilities: [], implementationDifferences: [] },
      getReferenceEnvironment: vi.fn().mockResolvedValue(environment), getPayment: vi.fn().mockResolvedValue(payment), getRefund: vi.fn().mockResolvedValue(refund),
      listPayments: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
      listRefunds: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }), execute,
    } as unknown as PaymentWorkbenchService;
    const node = kind === "payment" ? <PaymentsPage service={api} initialId={payment.paymentId} /> : <RefundsPage service={api} initialId={refund.refundId} />;
    await render(<><ConfirmationHost />{node}</>);
    const form = page!.querySelector<HTMLFormElement>(".action-form form")!;
    const identity = field("Result identity").value;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(dialog()).not.toBeNull(); expect(execute).not.toHaveBeenCalled();
    await click("取消操作");
    expect(execute).not.toHaveBeenCalled(); expect(field("Result identity").value).toBe(identity);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await click("确认继续");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: kind === "payment" ? "RECEIVE_PAYMENT_RESULT" : "RECEIVE_REFUND_RESULT",
      input: expect.objectContaining({ resourceId: kind === "payment" ? "pay-a" : "refund-a", resultIdentity: identity }),
    }));
  });
});
