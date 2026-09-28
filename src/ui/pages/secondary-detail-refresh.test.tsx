// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ManualReviewItem, MerchantNotification, Operation, OperationReceipt, ReconciliationRun, ReferenceEnvironment, Settlement } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { ReconciliationPage } from "./ReconciliationPage";
import { ReviewsPage } from "./ReviewsPage";
import { SettlementsPage } from "./SettlementsPage";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const environment: ReferenceEnvironment = {
  fixtureId: "reference-default", merchantId: "reference-merchant", channelId: "reference-channel",
  actorAlias: "fixture-reconciliation-operator",
  currentTime: "2026-09-28T00:00:00Z", policy: { businessTimezone: "Asia/Shanghai", enabledCurrencies: ["CNY"] },
};

function service(overrides: Record<string, unknown>): PaymentWorkbenchService {
  return {
    getReferenceEnvironment: vi.fn().mockResolvedValue(environment),
    listSettlements: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listReconciliationRuns: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listManualReviews: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listNotifications: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    ...overrides,
  } as unknown as PaymentWorkbenchService;
}

function settlement(id: string, version = 1): Settlement {
  return {
    resourceType: "settlement", settlementId: id, merchantId: "reference-merchant",
    currency: "CNY", status: "READY_FOR_CONFIRMATION", finality: "NON_FINAL", version,
    items: [], executions: [], reviewIds: [],
    actions: [{ kind: "CONFIRM_SETTLEMENT", label: "确认结算", executable: true, availability: "full", confirmation: "none" }],
    source: { adapter: "wow" },
  };
}

function review(id: string, summary: string): ManualReviewItem {
  return {
    resourceType: "manualReview", reviewId: id, type: "PAYMENT", merchantId: "reference-merchant",
    status: "OPEN", finality: "REVIEW_REQUIRED", summary, relatedResources: [],
    blockingScopes: [], evidenceRefs: [], dispositions: [],
    actions: [{ kind: "RESOLVE_MANUAL_REVIEW", label: "处置", executable: true, availability: "full", confirmation: "none" }],
    source: { adapter: "cap4k" },
  };
}

function notification(id: string, attempts = 0): MerchantNotification {
  return {
    notificationId: id, contentIdentity: `content-${id}`, merchantId: "reference-merchant",
    status: "PENDING", attempts: Array.from({ length: attempts }, (_, index) => ({ attemptId: `${id}-${index}`, status: "FAILURE" })),
    source: { adapter: "wow" },
  };
}

function reconciliationRun(id: string, differenceId?: string): ReconciliationRun {
  return {
    resourceType: "reconciliationRun", runId: id, billId: `bill-${id}`,
    scope: { channelId: "reference-channel", currency: "CNY", businessDate: "2026-09-28", businessTimezone: "Asia/Shanghai" },
    merchantIds: ["reference-merchant"], billRevision: 1, status: differenceId ? "ACTION_REQUIRED" : "COMPLETED",
    finality: differenceId ? "REVIEW_REQUIRED" : "FINAL", settlementBlocked: Boolean(differenceId),
    differences: differenceId ? [{
      differenceId, differenceType: "AMOUNT_MISMATCH", resolved: false, settlementBlocked: true,
      platformEvidenceRefs: [], billEvidenceRefs: [], dispositions: [], confirmations: [],
    }] : [],
    actions: [], source: { adapter: "wow" },
  };
}

function accepted(resourceType: string, resourceId: string, commandType: string): OperationReceipt {
  return {
    operationId: `op-${resourceId}`, commandType, acceptanceStatus: "ACCEPTED", idempotentReplay: false,
    resource: { resourceType, resourceId }, readAfter: { mode: "READ_ONCE", operationUrl: `/operations/op-${resourceId}` },
    source: { adapter: "wow" },
  };
}

describe("次级资源权威详情与刷新", () => {
  it("ReconciliationRun 列表摘要只作导航，点击后读取包含差异的权威详情", async () => {
    const summary = reconciliationRun("run-authoritative");
    const detail = reconciliationRun("run-authoritative", "difference-authoritative");
    const getReconciliationRun = vi.fn().mockResolvedValue(detail);
    const page = await render(<ReconciliationPage service={service({
      listReconciliationRuns: vi.fn().mockResolvedValue({ items: [summary], pageSize: 10, nextCursor: null }),
      getReconciliationRun,
    })} />);

    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).find((button) => button.textContent === "详情")!);

    expect(getReconciliationRun).toHaveBeenCalledWith("run-authoritative");
    expect(page.querySelector(".detail-heading")?.textContent).toContain("run-authoritative");
    expect(page.textContent).toContain("difference-authoritative");
    expect(page.textContent).toContain("AMOUNT_MISMATCH");
  });

  it("结算列表只用稳定 ID 打开权威详情，迟到的旧响应不覆盖后选项", async () => {
    const slow = deferred<Settlement>();
    const getSettlement = vi.fn((id: string) => id === "settlement-a" ? slow.promise : Promise.resolve(settlement(id, 8)));
    const page = await render(<SettlementsPage service={service({
      listSettlements: vi.fn().mockResolvedValue({ items: [settlement("settlement-a"), settlement("settlement-b")], pageSize: 10, nextCursor: null }),
      getSettlement,
    })} />);
    const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).filter((button) => button.textContent === "详情");
    await click(buttons[0]);
    expect(page.textContent).toContain("正在读取结算权威详情");
    await click(buttons[1]);
    expect(page.querySelector(".detail-heading")?.textContent).toContain("settlement-b");
    expect(page.querySelector(".detail-band")?.textContent).toContain("8");
    await act(async () => { slow.resolve(settlement("settlement-a", 2)); await slow.promise; });
    expect(page.querySelector(".detail-heading")?.textContent).toContain("settlement-b");
    expect(getSettlement.mock.calls.map(([id]) => id)).toEqual(["settlement-a", "settlement-b"]);
  });

  it("结算命令使用当前权威资源回读，并刷新列表", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const initial = settlement("settlement-ready");
    const updated = { ...initial, status: "CONFIRMED", version: 2 };
    const getSettlement = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated);
    const listSettlements = vi.fn().mockResolvedValue({ items: [initial], pageSize: 10, nextCursor: null });
    const receipt = accepted("settlement", initial.settlementId, "CONFIRM_SETTLEMENT");
    const operation: Operation = { operationId: receipt.operationId, commandType: receipt.commandType, status: "SUCCEEDED", resource: receipt.resource, source: { adapter: "wow" } };
    const page = await render(<SettlementsPage service={service({
      listSettlements, getSettlement, execute: vi.fn().mockResolvedValue(receipt), getOperation: vi.fn().mockResolvedValue(operation),
    })} />);
    await click(page.querySelector<HTMLButtonElement>("tr button")!);
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "确认并冻结")!);
    expect(getSettlement).toHaveBeenCalledTimes(2);
    expect(listSettlements.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(page.querySelector(".detail-band")?.textContent).toContain("2");
  });

  it("人工核对与通知都按 ID 回读权威详情，快速切换保持最后选择", async () => {
    const slowReview = deferred<ManualReviewItem>();
    const slowNotification = deferred<MerchantNotification>();
    const getManualReview = vi.fn((id: string) => id === "review-a" ? slowReview.promise : Promise.resolve(review(id, "权威 B")));
    const getNotification = vi.fn((id: string) => id === "notification-a" ? slowNotification.promise : Promise.resolve(notification(id, 2)));
    const page = await render(<ReviewsPage service={service({
      listManualReviews: vi.fn().mockResolvedValue({ items: [review("review-a", "摘要 A"), review("review-b", "摘要 B")], pageSize: 10, nextCursor: null }),
      listNotifications: vi.fn().mockResolvedValue({ items: [notification("notification-a"), notification("notification-b")], pageSize: 10, nextCursor: null }),
      getManualReview, getNotification,
    })} />);
    const reviewButtons = Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).filter((button) => button.textContent === "详情");
    await click(reviewButtons[0]);
    await click(reviewButtons[1]);
    await click(reviewButtons[2]);
    await click(reviewButtons[3]);
    expect(page.querySelector(".detail-heading")?.textContent).toContain("review-b");
    expect(page.querySelector(".detail-band")?.textContent).toContain("权威 B");
    expect(page.textContent).toContain("尝试次数2");
    await act(async () => {
      slowReview.resolve(review("review-a", "迟到 A"));
      slowNotification.resolve(notification("notification-a", 5));
      await Promise.all([slowReview.promise, slowNotification.promise]);
    });
    expect(page.querySelector(".detail-heading")?.textContent).toContain("review-b");
    expect(page.textContent).not.toContain("迟到 A");
    expect(page.textContent).toContain("尝试次数2");
    expect(getManualReview.mock.calls.map(([id]) => id)).toEqual(["review-a", "review-b"]);
    expect(getNotification.mock.calls.map(([id]) => id)).toEqual(["notification-a", "notification-b"]);
  });

  it("处置与通知重试完成后更新对应权威详情和列表", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const oldReview = review("review-action", "待处置");
    const newReview = { ...oldReview, status: "RESOLVED", summary: "已处置" };
    const oldNotification = notification("notification-action");
    const newNotification = notification("notification-action", 1);
    const getManualReview = vi.fn().mockResolvedValueOnce(oldReview).mockResolvedValue(newReview);
    const getNotification = vi.fn().mockResolvedValueOnce(oldNotification).mockResolvedValue(newNotification);
    const listManualReviews = vi.fn().mockResolvedValue({ items: [oldReview], pageSize: 10, nextCursor: null });
    const listNotifications = vi.fn().mockResolvedValue({ items: [oldNotification], pageSize: 10, nextCursor: null });
    const execute = vi.fn((command: { type: string }) => Promise.resolve(
      command.type === "RESOLVE_MANUAL_REVIEW"
        ? accepted("manualReview", oldReview.reviewId, command.type)
        : accepted("notification", oldNotification.notificationId, command.type),
    ));
    const getOperation = vi.fn((operationId: string) => Promise.resolve({
      operationId, commandType: "COMMAND", status: "SUCCEEDED", source: { adapter: "wow" },
    } as Operation));
    const page = await render(<ReviewsPage service={service({
      getManualReview, getNotification, listManualReviews, listNotifications, execute, getOperation,
    })} />);
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).find((button) => button.closest("tr")?.textContent?.includes(oldReview.reviewId))!);
    const resolution = Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "确认处置")?.closest("form");
    await act(async () => { resolution?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(getManualReview).toHaveBeenCalledTimes(2);
    expect(listManualReviews.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(page.querySelector(".detail-band")?.textContent).toContain("已处置");

    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("tr button")).find((button) => button.closest("tr")?.textContent?.includes(oldNotification.notificationId))!);
    await click(Array.from(page.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "重试通知")!);
    expect(getNotification).toHaveBeenCalledTimes(2);
    expect(listNotifications.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(page.textContent).toContain("尝试次数1");
  });
});
