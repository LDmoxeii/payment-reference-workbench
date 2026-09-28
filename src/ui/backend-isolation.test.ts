import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const productionSources = Object.entries(sources).filter(([path]) => !path.includes(".test."));

describe("页面与后端实现隔离", () => {
  it.each(productionSources)("%s 不按 backend literal 决定业务流程", (_path, source) => {
    expect(source).not.toMatch(/(?:===|!==)\s*["'](?:wow|cap4k)["']/i);
    expect(source).not.toMatch(/["'](?:wow|cap4k)["']\s*(?:===|!==)/i);
    expect(source).not.toContain("import.meta.env");
  });

  it("业务页面不导入 adapter、HTTP client 或 runtime 配置", () => {
    const pageSources = productionSources
      .filter(([path]) => path.startsWith("./pages/"))
      .map(([, source]) => source)
      .join("\n");

    expect(pageSources).not.toMatch(/from\s+["'][^"']*(?:adapters|http\/client|config\/runtime)[^"']*["']/);
  });
});
