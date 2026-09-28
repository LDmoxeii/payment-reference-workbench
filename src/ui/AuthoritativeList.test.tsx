// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PageResult } from "../domain/models";
import { AuthoritativeList } from "./AuthoritativeList";

interface Row { id: string; }

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

async function flush() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

function page(id: string, nextCursor: string | null): PageResult<Row> {
  return { items: [{ id }], pageSize: 10, nextCursor };
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AuthoritativeList 数据集一致性", () => {
  it("refreshKey 以当前筛选重取首屏并清空历史，下一页沿用同一筛选与新 cursor", async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page("initial", null))
      .mockResolvedValueOnce(page("filtered-1", "filtered-page-2"))
      .mockResolvedValueOnce(page("filtered-2", "filtered-page-3"))
      .mockResolvedValueOnce(page("refreshed-1", "refreshed-page-2"))
      .mockResolvedValueOnce(page("refreshed-2", null));
    const list = (refreshKey: number) => <AuthoritativeList<Row>
      title="权威列表"
      description="测试列表"
      loadPage={loadPage}
      itemKey={(item) => item.id}
      columns={["ID"]}
      onOpen={() => undefined}
      refreshKey={refreshKey}
      renderRow={(item) => <td>{item.id}</td>}
    />;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root?.render(list(0)); await Promise.resolve(); });
    await flush();

    const form = container.querySelector("form");
    const merchantId = form?.querySelector<HTMLInputElement>('input[placeholder="merchantId"]');
    await act(async () => {
      if (merchantId) changeInput(merchantId, "merchant-filtered");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();

    const nextButton = () => Array.from(container?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("下一页"));
    await act(async () => { nextButton()?.click(); await Promise.resolve(); });
    await flush();
    expect(container.textContent).toContain("第 2 页");

    await act(async () => { root?.render(list(1)); await Promise.resolve(); });
    await flush();
    expect(container.textContent).toContain("refreshed-1");
    expect(container.textContent).toContain("第 1 页");

    await act(async () => { nextButton()?.click(); await Promise.resolve(); });
    await flush();
    expect(loadPage.mock.calls).toEqual([
      [{ filters: {}, cursor: undefined, pageSize: 10 }],
      [{ filters: { merchantId: "merchant-filtered" }, cursor: undefined, pageSize: 10 }],
      [{ filters: { merchantId: "merchant-filtered" }, cursor: "filtered-page-2", pageSize: 10 }],
      [{ filters: { merchantId: "merchant-filtered" }, cursor: undefined, pageSize: 10 }],
      [{ filters: { merchantId: "merchant-filtered" }, cursor: "refreshed-page-2", pageSize: 10 }],
    ]);
    expect(container.textContent).toContain("refreshed-2");
  });
});
