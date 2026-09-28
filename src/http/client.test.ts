import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient, normalizeHttpError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP error normalization", () => {
  it("binds the default global fetch to the browser global object", async () => {
    let receiver: unknown;
    const browserFetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({ connected: true }), { status: 200 }));
    } as typeof fetch;
    vi.stubGlobal("fetch", browserFetch);

    const client = new HttpClient({ baseUrl: "http://localhost:8080" });

    await expect(client.get("/actuator/health")).resolves.toEqual({ connected: true });
    expect(receiver).toBe(globalThis);
  });

  it("preserves stable code, details, correlationId, fields and diagnostic payload", () => {
    const error = normalizeHttpError(409, {
      code: "IDEMPOTENCY_CONFLICT",
      message: "同一幂等键对应不同金额",
      details: { amount: "must match original request" },
      correlationId: "corr-1",
      retryable: false,
    });

    expect(error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      sourceCode: "IDEMPOTENCY_CONFLICT",
      message: "同一幂等键对应不同金额",
      details: { amount: "must match original request" },
      correlationId: "corr-1",
      retryable: false,
      fields: [{ field: "amount", message: "must match original request" }],
    });
    expect(error.diagnostic).toEqual(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
  });

  it("marks server failures as retryable", () => {
    expect(normalizeHttpError(503, { code: "TEMPORARY", message: "try later" })).toMatchObject({ code: "TEMPORARY", retryable: true });
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [404, "NOT_FOUND"],
    [409, "BUSINESS_CONFLICT"],
    [503, "SERVER_ERROR"],
  ])("uses the stable semantic fallback for an HTTP %s response without a backend code", (status, code) => {
    expect(normalizeHttpError(status, { message: "plain transport error" })).toMatchObject({
      code,
      sourceCode: undefined,
      message: "plain transport error",
    });
  });

  it("does not replace an explicit backend retryability decision", () => {
    expect(normalizeHttpError(503, { code: "PERMANENT_FAILURE", message: "do not retry", retryable: false }))
      .toMatchObject({ code: "PERMANENT_FAILURE", retryable: false });
  });
});
