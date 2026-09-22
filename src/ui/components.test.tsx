// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessError } from "../domain/errors";
import { ErrorBlock, RecentLink } from "./components";

describe("recent record controls", () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  it("exposes separate open and remove actions", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpen = vi.fn();
    const onRemove = vi.fn();

    await act(async () => {
      root.render(<RecentLink label="订单 A" id="payment-1" status="SUCCEEDED" onOpen={onOpen} onRemove={onRemove} />);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    expect(buttons[1]?.getAttribute("aria-label")).toContain("移除 订单 A");

    buttons[0]?.click();
    buttons[1]?.click();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});

describe("business error feedback", () => {
  it("shows retryability and expandable source diagnostics", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const error = new BusinessError({
      code: "SERVER_ERROR",
      message: "后端暂时不可用",
      fields: [],
      retryable: true,
      sourceCode: "TEMPORARY_FAILURE",
      sourceMessage: "temporary downstream failure",
      diagnostic: { traceId: "trace-1", upstream: "payment" },
    });

    await act(async () => root.render(<ErrorBlock error={error} />));

    expect(container.textContent).toContain("可重试");
    expect(container.textContent).toContain("源错误与诊断");
    expect(container.textContent).toContain("temporary downstream failure");
    expect(container.textContent).toContain("trace-1");
    await act(async () => root.unmount());
    container.remove();
  });
});
