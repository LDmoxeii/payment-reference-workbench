// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReferenceEnvironment } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { ConfirmationHost } from "../ConfirmationHost";
import { WorkbenchNoticeProvider } from "../WorkbenchNotice";
import { ReferenceLabPage } from "./ReferenceLabPage";

let root: Root | undefined;
let page: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; page?.remove(); vi.restoreAllMocks(); });
const environment: ReferenceEnvironment = { fixtureId: "fixture", merchantId: "merchant", channelId: "channel", actorAlias: "operator", currentTime: "2047-06-10T06:00:00Z", policy: { businessTimezone: "Asia/Shanghai", enabledCurrencies: ["CNY"] } };
const actions = [
  { label: "配置 provider 读取脚本", type: "CONFIGURE_BILL_PROVIDER", confirmation: true },
  { label: "回读脚本与消费诊断", type: "READ_BILL_PROVIDER_SCRIPT", confirmation: false },
  { label: "重置脚本", type: "RESET_BILL_PROVIDER_SCRIPT", confirmation: true },
];

async function render() {
  const executeReference = vi.fn().mockResolvedValue({ effect: "applied", summary: "script captured" });
  const service = { profile: { capabilities: [{ id: "bill-read-script", level: "full", description: "script" }] }, getReferenceEnvironment: vi.fn().mockResolvedValue(environment), executeReference } as unknown as PaymentWorkbenchService;
  page = document.createElement("div"); document.body.append(page); root = createRoot(page);
  await act(async () => { root?.render(<WorkbenchNoticeProvider><ReferenceLabPage service={service} /><ConfirmationHost /></WorkbenchNoticeProvider>); });
  return executeReference;
}
function scriptSection() { return [...page.querySelectorAll("section")].find((section) => section.querySelector("h3")?.textContent === "账单 provider 脚本")!; }
function field(label: string) { return [...scriptSection().querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === label)!.querySelector("input")!; }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function click(label: string, scope: Element = scriptSection()) { const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); if (!button) throw new Error(label); await act(async () => { button.click(); }); }
async function invoke(label: string) {
  if (label === "配置 provider 读取脚本") await act(async () => { scriptSection().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  else await click(label);
}

describe("账单脚本 revision 安全输入与确认", () => {
  it.each(actions)("$type rejects invalid revision before a request or confirmation and announces the error", async ({ label }) => {
    const executeReference = await render(); await change(field("Bill ID"), "bill-kept");
    for (const value of ["9007199254740993", "1.5", "1e3", "0", ""]) {
      await change(field("Revision"), value); await invoke(label);
      expect(executeReference).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain("BILL_REVISION_INVALID");
      expect(page.querySelector('[aria-live="assertive"]')?.textContent).toContain("9007199254740991");
      expect(field("Bill ID").value).toBe("bill-kept"); expect(field("Revision").value).toBe(value);
    }
  });

  it.each(actions)("$type forwards safe revision above Int32 unchanged and preserves explicit cancellation", async ({ label, type, confirmation }) => {
    const executeReference = await render(); await change(field("Bill ID"), "bill-kept"); await change(field("Revision"), "2147483648");
    await invoke(label);
    if (confirmation) {
      expect(executeReference).not.toHaveBeenCalled(); await click("取消操作", document.body);
      expect(executeReference).not.toHaveBeenCalled(); expect(field("Bill ID").value).toBe("bill-kept"); expect(field("Revision").value).toBe("2147483648");
      await invoke(label); await click("确认继续", document.body);
    }
    expect(executeReference).toHaveBeenCalledTimes(1);
    expect(executeReference).toHaveBeenCalledWith(expect.objectContaining({ type, input: expect.objectContaining({ billId: "bill-kept", revision: 2147483648 }) }));
  });
});
