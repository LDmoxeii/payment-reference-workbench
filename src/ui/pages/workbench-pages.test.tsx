// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BusinessError } from "../../domain/errors";
import type { ActionDescriptor, BackendProfile, MerchantNotification, Operation, OperationReceipt, Payment, Refund, ReferenceEnvironment, Settlement, TimelineEntry } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { PaymentsPage, loadCompletePaymentTimeline } from "./PaymentsPage";
import { ReconciliationPage } from "./ReconciliationPage";
import { ReferenceLabPage } from "./ReferenceLabPage";
import { RefundsPage } from "./RefundsPage";
import { SettlementsPage } from "./SettlementsPage";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await Promise.resolve();
  });
  await flush();
  return container;
}

async function flush() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function action(kind: ActionDescriptor["kind"], executable = true): ActionDescriptor {
  return { kind, label: kind, executable, availability: "full", confirmation: "none" };
}

const environment: ReferenceEnvironment = {
  fixtureId: "reference-default",
  merchantId: "reference-merchant",
  channelId: "reference-channel",
  actorAlias: "fixture-reconciliation-operator",
  currentTime: "2026-09-25T00:00:00Z",
  policy: { businessTimezone: "Asia/Shanghai", enabledCurrencies: ["CNY"] },
  actorAliases: {
    paymentReviewer: "fixture-payment-reviewer",
    refundReviewer: "fixture-refund-reviewer",
    reconciliationOperator: "fixture-reconciliation-operator",
    settlementOperator: "fixture-settlement-operator",
    settlementReviewer: "fixture-settlement-reviewer",
  },
};

function profile(capabilities: BackendProfile["capabilities"] = []): BackendProfile {
  return { id: "wow", label: "Reference implementation", apiBaseUrl: "/api", referenceOnly: true, capabilities, implementationDifferences: [] };
}

function service(overrides: Record<string, unknown> = {}): PaymentWorkbenchService {
  return {
    profile: profile(),
    getReferenceEnvironment: vi.fn().mockResolvedValue(environment),
    listPayments: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listRefunds: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listReconciliationRuns: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    listSettlements: vi.fn().mockResolvedValue({ items: [], pageSize: 10, nextCursor: null }),
    ...overrides,
  } as unknown as PaymentWorkbenchService;
}

async function setFormInput(form: HTMLFormElement, label: string, value: string) {
  const field = Array.from(form.querySelectorAll("label")).find((item) => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement>("input");
  if (!field) throw new Error(`找不到表单字段：${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const payment: Payment = {
  resourceType: "payment",
  paymentId: "pay-final",
  merchantId: "reference-merchant",
  merchantOrderId: "order-final",
  money: { currency: "CNY", amountMinor: "10000" },
  paymentMethod: "DEFAULT",
  status: "SUCCEEDED",
  finality: "FINAL",
  attempts: [{ attemptId: "attempt-1", channelId: "reference-channel", status: "SUCCEEDED", externalTransactionId: "external-1", submissions: [], receipts: [] }],
  reviewIds: [],
  actions: [action("RECEIVE_PAYMENT_RESULT")],
  source: { adapter: "wow" },
};

const refund: Refund = {
  resourceType: "refund",
  refundId: "refund-final",
  paymentId: "pay-final",
  merchantId: "reference-merchant",
  merchantRefundId: "merchant-refund-final",
  money: { currency: "CNY", amountMinor: "2000" },
  status: "SUCCEEDED",
  finality: "FINAL",
  attempts: [{ attemptId: "refund-attempt-1", channelId: "reference-channel", status: "SUCCEEDED", externalTransactionId: "refund-external-1", submissions: [], receipts: [] }],
  reviewIds: [],
  actions: [action("RECEIVE_REFUND_RESULT")],
  source: { adapter: "wow" },
};

describe("支付与退款异常收件", () => {
  it("终态支付仍由统一 action 开放 late/conflicting/duplicate 结果入口", async () => {
    const view = await render(<PaymentsPage service={service({ getPayment: vi.fn().mockResolvedValue(payment) })} initialId={payment.paymentId} />);
    const resultButton = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("提交可信结果"));
    const attemptInput = view.querySelector<HTMLInputElement>('input[list="payment-result-attempts"]');

    expect(view.textContent).toContain("即使支付已经终态");
    expect(resultButton?.disabled).toBe(false);
    expect(attemptInput?.tagName).toBe("INPUT");
  });

  it("终态退款仍由统一 action 开放迟到结果入口", async () => {
    const view = await render(<RefundsPage service={service({ getRefund: vi.fn().mockResolvedValue(refund), getPayment: vi.fn().mockResolvedValue(payment) })} initialId={refund.refundId} />);
    const resultButton = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("提交可信退款结果"));

    expect(view.textContent).toContain("退款已终态时仍可");
    expect(resultButton?.disabled).toBe(false);
  });

  it("支付详情通过统一服务读取关联通知和指定 Operation", async () => {
    const operation: Operation = {
      operationId: "op-payment-result",
      commandType: "RECEIVE_PAYMENT_RESULT",
      resource: { resourceType: "payment", resourceId: payment.paymentId },
      status: "SUCCEEDED",
      source: { adapter: "wow" },
    };
    const notification: MerchantNotification = {
      notificationId: "notification-payment-result",
      contentIdentity: "content-payment-result",
      merchantId: payment.merchantId,
      resource: { resourceType: "payment", resourceId: payment.paymentId },
      status: "DELIVERED",
      attempts: [{ status: "SUCCEEDED" }],
      source: { adapter: "wow" },
    };
    const getOperation = vi.fn().mockResolvedValue(operation);
    const listNotifications = vi.fn().mockResolvedValue({ items: [notification], pageSize: 100, nextCursor: null });
    const view = await render(<PaymentsPage service={service({ getPayment: vi.fn().mockResolvedValue(payment), getOperation, listNotifications })} initialId={payment.paymentId} />);
    const operationInput = view.querySelector<HTMLInputElement>('input[placeholder="Operation ID"]');
    const operationForm = operationInput?.closest("form");
    const notificationButton = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("读取关联通知"));

    await act(async () => {
      if (operationInput) changeInput(operationInput, operation.operationId);
      operationForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      notificationButton?.click();
      await Promise.resolve();
    });
    await flush();

    expect(getOperation).toHaveBeenCalledWith(operation.operationId);
    expect(listNotifications).toHaveBeenCalledWith({ filters: { merchantId: payment.merchantId, paymentId: payment.paymentId }, pageSize: 100 });
    expect(view.textContent).toContain("RECEIVE_PAYMENT_RESULT");
    expect(view.textContent).toContain(notification.notificationId);
    expect(view.textContent).toContain(notification.contentIdentity);
  });
});

describe("退款详情与预算上下文", () => {
  const refundFor = (refundId: string, paymentId: string): Refund => ({
    ...refund,
    refundId,
    paymentId,
    merchantRefundId: `merchant-${refundId}`,
    attempts: [],
  });
  const paymentFor = (paymentId: string, availableAmount: string): Payment => ({
    ...payment,
    paymentId,
    merchantOrderId: `order-${paymentId}`,
    refundBudget: {
      originalAmount: { currency: "CNY", amountMinor: "10000" },
      succeededAmount: { currency: "CNY", amountMinor: "0" },
      reservedAmount: { currency: "CNY", amountMinor: "0" },
      availableAmount: { currency: "CNY", amountMinor: availableAmount },
    },
  });

  it("查询新退款时立即隔离旧预算，并忽略较早退款查询的迟到响应", async () => {
    const slowRefund = deferred<Refund>();
    const refunds = {
      "refund-a": refundFor("refund-a", "pay-a"),
      "refund-c": refundFor("refund-c", "pay-c"),
    };
    const getRefund = vi.fn((id: string) => id === "refund-b" ? slowRefund.promise : Promise.resolve(refunds[id as keyof typeof refunds]));
    const getPayment = vi.fn((id: string) => Promise.resolve(id === "pay-a" ? paymentFor(id, "8000") : paymentFor(id, "6000")));
    const view = await render(<RefundsPage service={service({ getRefund, getPayment })} initialId="refund-a" />);
    const lookupForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("查询"));
    const lookup = lookupForm?.querySelector<HTMLInputElement>("input");

    expect(view.textContent).toContain("CNY 80.00");
    await act(async () => {
      if (lookup) changeInput(lookup, "refund-b");
      lookupForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(view.textContent).not.toContain("CNY 80.00");

    await act(async () => {
      if (lookup) changeInput(lookup, "refund-c");
      lookupForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();
    expect(view.textContent).toContain("refund-c");
    expect(view.textContent).toContain("CNY 60.00");

    await act(async () => { slowRefund.resolve(refundFor("refund-b", "pay-b")); await slowRefund.promise; });
    await flush();
    expect(view.textContent).toContain("refund-c");
    expect(view.textContent).not.toContain("refund-b");
    expect(getPayment).not.toHaveBeenCalledWith("pay-b");
  });

  it("忽略旧支付预算的迟到响应，且当前退款查询失败后不保留预算", async () => {
    const slowBudget = deferred<Payment>();
    const getRefund = vi.fn((id: string) => {
      if (id === "missing-refund") return Promise.reject(new Error("refund not found"));
      return Promise.resolve(refundFor(id, id === "refund-b" ? "pay-b" : "pay-c"));
    });
    const getPayment = vi.fn((id: string) => id === "pay-b" ? slowBudget.promise : Promise.resolve(paymentFor(id, "6000")));
    const view = await render(<RefundsPage service={service({ getRefund, getPayment })} initialId="refund-b" />);
    const lookupForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("查询"));
    const lookup = lookupForm?.querySelector<HTMLInputElement>("input");

    await act(async () => {
      if (lookup) changeInput(lookup, "refund-c");
      lookupForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();
    expect(view.textContent).toContain("refund-c");
    expect(view.textContent).toContain("CNY 60.00");

    await act(async () => { slowBudget.resolve(paymentFor("pay-b", "9000")); await slowBudget.promise; });
    await flush();
    expect(view.textContent).toContain("CNY 60.00");
    expect(view.textContent).not.toContain("CNY 90.00");

    await act(async () => {
      if (lookup) changeInput(lookup, "missing-refund");
      lookupForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();
    expect(view.textContent).toContain("refund not found");
    expect(view.textContent).not.toContain("CNY 60.00");
  });
});

describe("失败时保留业务输入", () => {
  const rejection = new BusinessError({ code: "VALIDATION_ERROR", message: "字段不合法", retryable: false, fields: [{ field: "merchantOrderId", message: "不能为空" }] });

  it("支付创建同步拒绝后不重置订单号和幂等键，并提供同命令重试", async () => {
    const execute = vi.fn().mockRejectedValue(rejection);
    const view = await render(<PaymentsPage service={service({ execute })} />);
    const createForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("创建但不自动发起"));
    const inputs = createForm?.querySelectorAll<HTMLInputElement>("input");
    const orderBefore = inputs?.[1]?.value;
    const idempotencyBefore = inputs?.[5]?.value;

    await act(async () => { createForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    expect(execute).toHaveBeenCalledOnce();
    expect(inputs?.[1]?.value).toBe(orderBefore);
    expect(inputs?.[5]?.value).toBe(idempotencyBefore);
    expect(view.textContent).toContain("VALIDATION_ERROR");
    expect(view.querySelector('button[title="重试"]')).not.toBeNull();
  });

  it("退款申请同步拒绝后不重置商户退款号和幂等键", async () => {
    const execute = vi.fn().mockRejectedValue(rejection);
    const view = await render(<RefundsPage service={service({ execute })} />);
    const requestForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("申请并预占退款预算"));
    const inputs = requestForm?.querySelectorAll<HTMLInputElement>("input");
    const refundNoBefore = inputs?.[2]?.value;
    const idempotencyBefore = inputs?.[5]?.value;

    await act(async () => { requestForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    expect(execute).toHaveBeenCalledOnce();
    expect(inputs?.[2]?.value).toBe(refundNoBefore);
    expect(inputs?.[5]?.value).toBe(idempotencyBefore);
    expect(view.textContent).toContain("VALIDATION_ERROR");
  });
});

describe("对账 scope 统一交互", () => {
  it("账单信号与运行表单都把非默认渠道、币种、业务日期和时区交给统一命令", async () => {
    const receipt: OperationReceipt = { operationId: "op-scope", commandType: "RECONCILIATION", acceptanceStatus: "ACCEPTED", idempotentReplay: false, readAfter: { mode: "READ_ONCE", operationUrl: "/operations/op-scope" }, source: { adapter: "cap4k" } };
    const operation: Operation = { operationId: "op-scope", commandType: "RECONCILIATION", status: "SUCCEEDED", source: { adapter: "cap4k" } };
    const execute = vi.fn().mockResolvedValue(receipt);
    const view = await render(<ReconciliationPage service={service({ execute, getOperation: vi.fn().mockResolvedValue(operation) })} />);
    const signalForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("通知账单可用"));
    const runForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("创建 ReconciliationRun"));
    if (!signalForm || !runForm) throw new Error("找不到对账 scope 表单");

    for (const [label, value] of [["Bill ID", "bill-signal"], ["渠道", "CHANNEL-SIGNAL"], ["币种", "EUR"], ["业务日期", "2026-10-18"], ["业务时区", "Europe/Paris"]] as const) {
      await setFormInput(signalForm, label, value);
    }
    await act(async () => { signalForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    for (const [label, value] of [["Bill ID", "bill-run"], ["渠道", "CHANNEL-RUN"], ["币种", "USD"], ["业务日期", "2026-10-19"], ["业务时区", "America/New_York"]] as const) {
      await setFormInput(runForm, label, value);
    }
    await act(async () => { runForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "SIGNAL_BILL_AVAILABLE",
      input: expect.objectContaining({ billId: "bill-signal", channelId: "CHANNEL-SIGNAL", currency: "EUR", businessDate: "2026-10-18", businessTimezone: "Europe/Paris" }),
    }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "RUN_RECONCILIATION",
      input: expect.objectContaining({ billId: "bill-run", channelId: "CHANNEL-RUN", currency: "USD", businessDate: "2026-10-19", businessTimezone: "America/New_York" }),
    }));
  });
});

describe("Payment Timeline opaque cursor", () => {
  it("持续回传 opaque cursor 直到末页，不在 50 条静默截断", async () => {
    const entry = (eventId: string): TimelineEntry => ({ eventId, category: "PAYMENT", recordedAt: `2026-09-25T00:00:0${eventId}.000Z`, relatedResourceRefs: [], evidenceRefs: [] });
    const getPaymentTimeline = vi.fn()
      .mockResolvedValueOnce({ paymentId: "pay-1", entries: [entry("1")], nextCursor: "opaque-A", pageSize: 1, source: { adapter: "wow" } })
      .mockResolvedValueOnce({ paymentId: "pay-1", entries: [entry("2")], nextCursor: "opaque-B", pageSize: 1, source: { adapter: "wow" } })
      .mockResolvedValueOnce({ paymentId: "pay-1", entries: [entry("3")], nextCursor: null, pageSize: 1, source: { adapter: "wow" } });

    const timeline = await loadCompletePaymentTimeline(service({ getPaymentTimeline }), "pay-1", 1);

    expect(getPaymentTimeline.mock.calls.map((call) => call[1])).toEqual([{ pageSize: 1, cursor: undefined }, { pageSize: 1, cursor: "opaque-A" }, { pageSize: 1, cursor: "opaque-B" }]);
    expect(timeline.entries.map((item) => item.eventId)).toEqual(["1", "2", "3"]);
    expect(timeline.nextCursor).toBeNull();
  });
});

describe("结算失败后的受控新 execution", () => {
  it("在原结算可作废状态直接显示仅作废与作废并替代两个统一动作", async () => {
    const ready: Settlement = {
      resourceType: "settlement",
      settlementId: "settlement-ready",
      merchantId: "reference-merchant",
      currency: "CNY",
      status: "READY_FOR_CONFIRMATION",
      finality: "NON_FINAL",
      netAmount: { currency: "CNY", amountMinor: "10000" },
      items: [],
      executions: [],
      reviewIds: [],
      actions: [action("VOID_SETTLEMENT"), action("CREATE_SETTLEMENT_REPLACEMENT")],
      source: { adapter: "wow" },
    };
    const view = await render(<SettlementsPage service={service({ listSettlements: vi.fn().mockResolvedValue({ items: [ready], pageSize: 10, nextCursor: null }) })} />);
    const open = Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "详情");
    await act(async () => { open?.click(); });
    const voidButton = Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "作废");
    const replacementButton = Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "创建替代");

    expect(voidButton?.disabled).toBe(false);
    expect(replacementButton?.disabled).toBe(false);
    expect(view.textContent).toContain("直接调用所选动作");
  });

  it("统一 action 开放新 execution，成功受理后生成新的 identity", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const settlement: Settlement = {
      resourceType: "settlement",
      settlementId: "settlement-failed",
      merchantId: "reference-merchant",
      channelId: "reference-channel",
      currency: "CNY",
      status: "EXECUTION_FAILED",
      finality: "NON_FINAL",
      netAmount: { currency: "CNY", amountMinor: "10000" },
      items: [],
      executions: [],
      reviewIds: [],
      actions: [action("EXECUTE_SETTLEMENT")],
      source: { adapter: "wow" },
    };
    const receipt: OperationReceipt = { operationId: "op-execute", commandType: "EXECUTE_SETTLEMENT", resource: { resourceType: "settlement", resourceId: settlement.settlementId }, acceptanceStatus: "ACCEPTED", idempotentReplay: false, readAfter: { mode: "READ_ONCE", operationUrl: "/operations/op-execute" }, source: { adapter: "wow" } };
    const operation: Operation = { operationId: "op-execute", commandType: "EXECUTE_SETTLEMENT", status: "SUCCEEDED", resource: receipt.resource, source: { adapter: "wow" } };
    const execute = vi.fn().mockResolvedValue(receipt);
    const view = await render(<SettlementsPage service={service({ listSettlements: vi.fn().mockResolvedValue({ items: [settlement], pageSize: 10, nextCursor: null }), execute, getOperation: vi.fn().mockResolvedValue(operation), getSettlement: vi.fn().mockResolvedValue(settlement) })} />);
    const open = Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "详情");
    await act(async () => { open?.click(); });
    const executionForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("发起新 execution"));
    const executionId = executionForm?.querySelector<HTMLInputElement>("input");
    const before = executionId?.value;

    expect(executionForm?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await act(async () => { executionForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "EXECUTE_SETTLEMENT", input: expect.objectContaining({ executionId: before }) }));
    expect(executionId?.value).not.toBe(before);
  });
});

describe("Reference Lab 能力结果", () => {
  it("alternative 结果显示替代实验路径，不显示为已配置成功", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const executeReference = vi.fn().mockResolvedValue({ effect: "alternative", summary: "使用显式 attempt submit 与可信 result 构造等价场景" });
    const referenceService = service({
      profile: profile([{ id: "channel-script", label: "channel-script", description: "没有独立脚本传输", level: "alternative", alternative: "使用显式结果入口" }]),
      executeReference,
    });
    const view = await render(<ReferenceLabPage service={referenceService} />);
    const channelForm = Array.from(view.querySelectorAll("form")).find((form) => form.textContent?.includes("提交脚本"));

    await act(async () => { channelForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();

    expect(executeReference).toHaveBeenCalledOnce();
    expect(view.textContent).toContain("替代实验路径");
    expect(view.textContent).toContain("使用显式 attempt submit");
    expect(view.textContent).not.toContain("已应用 · 使用显式 attempt submit");
  });

  it("结算脚本同时携带 fixture、渠道和 execution identity，并能回读与重置", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const executeReference = vi.fn().mockResolvedValue({
      effect: "applied", summary: "脚本状态已读取",
      data: { script: "UNKNOWN", consumed: false, diagnosticSummary: "等待 execution" },
    });
    const view = await render(<ReferenceLabPage service={service({
      profile: profile([{ id: "settlement-executor-script", label: "settlement", description: "执行脚本", level: "full" }]),
      executeReference,
    })} />);
    const section = Array.from(view.querySelectorAll("section")).find((item) => item.querySelector("h3")?.textContent?.includes("结算 executor 脚本"));
    const form = section?.querySelector("form");
    if (!form || !section) throw new Error("找不到结算 executor 脚本表单");
    await setFormInput(form, "Execution ID", "execution-42");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();
    expect(executeReference).toHaveBeenCalledWith({
      type: "CONFIGURE_SETTLEMENT_EXECUTOR",
      input: { fixtureId: "reference-default", channelId: "reference-channel", executionId: "execution-42", outcome: "SUCCESS" },
    });
    const buttons = Array.from(section.querySelectorAll("button"));
    await act(async () => { buttons.find((button) => button.textContent?.includes("回读脚本"))?.click(); await Promise.resolve(); });
    await act(async () => { buttons.find((button) => button.textContent?.includes("重置脚本"))?.click(); await Promise.resolve(); });
    expect(executeReference).toHaveBeenCalledWith({ type: "READ_SETTLEMENT_EXECUTOR_SCRIPT", input: { fixtureId: "reference-default", channelId: "reference-channel", executionId: "execution-42" } });
    expect(executeReference).toHaveBeenCalledWith({ type: "RESET_SETTLEMENT_EXECUTOR_SCRIPT", input: { fixtureId: "reference-default", channelId: "reference-channel", executionId: "execution-42" } });
    expect(view.textContent).toContain("等待 execution");
  });
});

describe("账单 revision 原始证据", () => {
  it("保留并展示 completeness、payload fingerprint 与记录 raw evidence", async () => {
    const view = await render(<ReconciliationPage service={service({
      getBill: vi.fn().mockResolvedValue({
        billId: "bill-42", channelId: "reference-channel", currency: "CNY", currentRevision: 2,
        revisions: [{
          billId: "bill-42", revision: 2, channelId: "reference-channel", merchantId: "reference-merchant",
          currency: "CNY", completeness: "COMPLETE", payloadFingerprint: "sha256:abc123",
          rawEvidence: "revision-source-42", publishedAt: "2026-09-25T00:00:00Z",
          records: [{
            recordId: "record-42", transactionKind: "PAYMENT", externalTransactionId: "external-42",
            money: { currency: "CNY", amountMinor: "10000" }, status: "SUCCESS",
            rawStatus: "channel-settled", rawEvidence: "record-source-42",
            occurredAt: "2026-09-24T00:00:00Z", receivedAt: "2026-09-25T00:00:00Z",
          }],
        }],
        source: { adapter: "cap4k" },
      }),
    })} />);
    const form = view.querySelector<HTMLInputElement>('input[placeholder="Bill ID"]')?.closest("form");
    if (!form) throw new Error("找不到账单查询表单");
    const input = form.querySelector<HTMLInputElement>("input");
    await act(async () => { if (input) changeInput(input, "bill-42"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await flush();
    expect(view.textContent).toContain("COMPLETE");
    expect(view.textContent).toContain("sha256:abc123");
    expect(view.textContent).toContain("revision-source-42");
    expect(view.textContent).toContain("channel-settled");
    expect(view.textContent).toContain("record-source-42");
  });
});
