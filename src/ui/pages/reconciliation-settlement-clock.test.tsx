// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReconciliationRun, ReferenceEnvironment, Settlement } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { ReconciliationPage } from "./ReconciliationPage";
import { ReferenceLabPage } from "./ReferenceLabPage";
import { SettlementsPage } from "./SettlementsPage";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined; container = undefined;
  vi.restoreAllMocks();
});

const environment: ReferenceEnvironment = {
  fixtureId: "reference-default", merchantId: "reference-merchant", channelId: "channel-1",
  actorAlias: "operator", currentTime: "2047-06-10T06:00:00Z",
  policy: { businessTimezone: "Asia/Shanghai", enabledCurrencies: ["CNY"] },
};

function service(overrides: Record<string, unknown> = {}): PaymentWorkbenchService {
  return {
    profile: { id: "cap4k", label: "CAP4K", apiBaseUrl: "/api", referenceOnly: true, capabilities: [], implementationDifferences: [] },
    getReferenceEnvironment: vi.fn().mockResolvedValue(environment),
    listReconciliationRuns: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listSettlements: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    ...overrides,
  } as unknown as PaymentWorkbenchService;
}

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root?.render(node); await Promise.resolve(); });
  return container;
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); await Promise.resolve(); });
}

function field(form: Element, label: string): HTMLInputElement {
  const input = Array.from(form.querySelectorAll("label"))
    .find((item) => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`找不到字段 ${label}`);
  return input;
}

function run(runId: string): ReconciliationRun {
  return {
    resourceType: "reconciliationRun", runId, billId: `bill-${runId}`,
    scope: { channelId: "channel-1", currency: "CNY", businessDate: "2047-06-10", businessTimezone: "Asia/Shanghai" },
    merchantIds: [], billRevision: 1, status: "ACTION_REQUIRED", finality: "REVIEW_REQUIRED",
    differences: [{
      differenceId: `difference-${runId}`, differenceType: "AMOUNT_MISMATCH", resolved: false,
      settlementBlocked: true, platformEvidenceRefs: [], billEvidenceRefs: [], dispositions: [], confirmations: [],
    }],
    actions: [{ kind: "DISPOSE_RECONCILIATION_DIFFERENCE", label: "处置", executable: true, availability: "full", confirmation: "none" }],
    source: { adapter: "cap4k" },
  };
}

describe("Reference 业务时间与权威关联", () => {
  it("空 merchantIds 的 Run 从权威 Bill 回填商户，切换 Run 后不沿用旧商户", async () => {
    const runA = run("a"); const runB = run("b"); const runC = run("c");
    const getBill = vi.fn((billId: string) => billId === "bill-c"
      ? Promise.reject(new Error("暂不可读"))
      : Promise.resolve({ billId, merchantId: billId === "bill-a" ? "merchant-a" : "merchant-b" }));
    const page = await render(<ReconciliationPage service={service({
      listReconciliationRuns: vi.fn().mockResolvedValue({ items: [runA, runB, runC], pageSize: 10, nextCursor: null }),
      getReconciliationRun: vi.fn((id: string) => Promise.resolve(id === "a" ? runA : id === "b" ? runB : runC)),
      getBill,
    })} />);
    const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).filter((button) => button.textContent === "详情");
    await click(buttons[0]);
    expect(field(page.querySelector(".action-form form")!, "Merchant ID").value).toBe("merchant-a");
    await click(buttons[1]);
    expect(field(page.querySelector(".action-form form")!, "Merchant ID").value).toBe("merchant-b");
    expect(field(Array.from(page.querySelectorAll("form")).find((form) => form.textContent?.includes("创建 ReconciliationRun"))!, "商户").value).toBe("merchant-b");
    await click(buttons[2]);
    expect(field(page.querySelector(".action-form form")!, "Merchant ID").value).toBe("");
    expect(page.querySelector(".detail-heading")?.textContent).toContain("c");
    expect(getBill.mock.calls.map(([id]) => id)).toEqual(["bill-a", "bill-b", "bill-c"]);
  });

  it("Reference Lab 账单默认时间取逻辑时钟，推进后同步业务日期与发生时间", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const later = { ...environment, currentTime: "2048-01-02T23:00:00Z" };
    const getReferenceEnvironment = vi.fn().mockResolvedValueOnce(environment).mockResolvedValue(later);
    const executeReference = vi.fn().mockResolvedValue({ effect: "applied", summary: "ok" });
    const page = await render(<ReferenceLabPage service={service({ getReferenceEnvironment, executeReference })} />);
    const billForm = Array.from(page.querySelectorAll("form")).find((form) => form.textContent?.includes("发布 immutable revision"))!;
    expect(field(billForm, "业务日期").value).toBe("2047-06-10");
    expect(field(billForm, "记录发生时间（ISO）").value).toBe("2047-06-10T06:00:00.000Z");
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "刷新环境")!);
    expect(field(billForm, "业务日期").value).toBe("2048-01-03");
    expect(field(billForm, "记录发生时间（ISO）").value).toBe("2048-01-02T23:00:00.000Z");
  });

  it("对账页保持现有 scope，显式同步时使用新逻辑时钟计算业务日期", async () => {
    const later = { ...environment, currentTime: "2048-01-02T23:00:00Z" };
    const getReferenceEnvironment = vi.fn().mockResolvedValueOnce(environment).mockResolvedValue(later);
    const page = await render(<ReconciliationPage service={service({ getReferenceEnvironment })} />);
    const start = Array.from(page.querySelectorAll("form")).find((form) => form.textContent?.includes("创建 ReconciliationRun"))!;
    expect(field(start, "业务日期").value).toBe("2047-06-10");
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "从逻辑时钟同步业务日期")!);
    expect(field(start, "业务日期").value).toBe("2048-01-03");
    expect(field(start, "渠道").value).toBe("channel-1");
  });

  it("结算周期及结果默认时间跟随逻辑时钟，终态仅展示历史诊断", async () => {
    const settled: Settlement = {
      resourceType: "settlement", settlementId: "settled-1", merchantId: "merchant-actual",
      currency: "CNY", status: "SETTLED", finality: "FINAL", blockerSummary: "曾有未决对账差异",
      netAmount: { currency: "CNY", amountMinor: "10000" }, items: [], executions: [],
      reviewIds: [], actions: [], source: { adapter: "cap4k", diagnostic: { priorBlocker: "曾有未决对账差异" } },
    };
    const getReferenceEnvironment = vi.fn().mockResolvedValueOnce(environment).mockResolvedValue({ ...environment, currentTime: "2048-01-02T23:00:00Z" });
    const page = await render(<SettlementsPage service={service({
      getReferenceEnvironment,
      listSettlements: vi.fn().mockResolvedValue({ items: [settled], pageSize: 10, nextCursor: null }),
      getSettlement: vi.fn().mockResolvedValue(settled),
    })} />);
    const prepare = Array.from(page.querySelectorAll("form")).find((form) => form.textContent?.includes("准备结算候选"))!;
    expect(field(prepare, "周期开始（ISO）").value).toBe("2047-06-09T06:00:00.000Z");
    expect(field(prepare, "周期结束（ISO）").value).toBe("2047-06-10T06:00:00.000Z");
    await click(page.querySelector<HTMLButtonElement>("tr button")!);
    const result = page.querySelector(".action-form form")!;
    expect(field(result, "发生时间").value).toBe("2047-06-10T06:00:00.000Z");
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "从逻辑时钟同步时间")!);
    expect(field(prepare, "周期结束（ISO）").value).toBe("2048-01-02T23:00:00.000Z");
    expect(field(result, "发生时间").value).toBe("2048-01-02T23:00:00.000Z");
    expect(page.querySelector(".detail-band")?.textContent).toContain("历史诊断曾有未决对账差异");
    expect(page.querySelector(".detail-band")?.textContent).not.toContain("当前阻断");
  });
});
