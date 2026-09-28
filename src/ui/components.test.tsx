// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BusinessError } from "../domain/errors";
import type { OperationReceipt } from "../domain/models";
import { CommandFeedback, ErrorBlock } from "./components";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

const receipt: OperationReceipt = {
  operationId: "op-1",
  commandType: "CREATE_PAYMENT",
  resource: { resourceType: "Payment", resourceId: "pay-1" },
  acceptanceStatus: "ACCEPTED",
  acceptedAt: "2026-09-25T01:00:00Z",
  idempotentReplay: false,
  correlationId: "corr-1",
  readAfter: { mode: "POLL", operationUrl: "/api/operations/op-1", resourceUrl: "/api/payments/pay-1" },
  source: { adapter: "wow", sourceStatus: "ACCEPTED" },
};

describe("命令分层反馈", () => {
  it("将 ACCEPTED、Operation 和资源标识分层，不把受理显示为资金成功", async () => {
    const view = await render(<CommandFeedback receipt={receipt} />);

    expect(view.textContent).toContain("受理回执、异步 Operation 与业务资源是三个独立层次");
    expect(view.textContent).toContain("已受理");
    expect(view.textContent).toContain("等待观察");
    expect(view.textContent).toContain("Payment:pay-1");
    expect(view.textContent).not.toContain("支付成功");
  });

  it("明确说明观察超时不等于领域失败", async () => {
    const view = await render(<CommandFeedback receipt={receipt} timedOut observationError={{ code: "OBSERVATION_TIMEOUT", message: "观察暂未收敛", retryable: true, fields: [], correlationId: "corr-1", details: { operationId: "op-1" } }} onContinue={() => undefined} />);

    expect(view.textContent).toContain("OBSERVATION_TIMEOUT");
    expect(view.textContent).toContain("观察窗口已超时");
    expect(view.textContent).toContain("不表示领域操作失败");
    expect(view.textContent).toContain("op-1");
    expect(view.textContent).toContain("继续观察同一 Operation");
    expect(view.textContent).toContain("可重试");
  });
});

describe("业务错误反馈", () => {
  it("展示稳定 code、correlationId、重试性与可展开源诊断", async () => {
    const error = new BusinessError({
      code: "RESOURCE_NOT_READY",
      message: "投影暂不可见",
      fields: [],
      retryable: true,
      correlationId: "corr-1",
      sourceCode: "PROJECTION_LAG",
      sourceMessage: "projection is catching up",
      details: { retryAfterMs: 125 },
      diagnostic: { traceId: "trace-1", upstream: "payment" },
    });

    const view = await render(<ErrorBlock error={error} />);

    expect(view.textContent).toContain("RESOURCE_NOT_READY");
    expect(view.textContent).toContain("可安全重试");
    expect(view.textContent).toContain("corr-1");
    expect(view.textContent).toContain("错误详情与源诊断");
    expect(view.textContent).toContain("projection is catching up");
    expect(view.textContent).toContain("trace-1");
  });
});
