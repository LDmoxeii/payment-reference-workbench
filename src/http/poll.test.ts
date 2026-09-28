import { describe, expect, it, vi } from "vitest";
import type { OperationReceipt } from "../domain/models";
import { pollReceipt } from "./poll";

const receipt: OperationReceipt = {
  operationId: "op-pay-1",
  commandType: "CREATE_PAYMENT",
  resource: { resourceType: "Payment", resourceId: "pay-1" },
  acceptanceStatus: "ACCEPTED",
  acceptedAt: "2026-09-25T01:00:00Z",
  idempotentReplay: false,
  correlationId: "corr-pay-1",
  readAfter: {
    mode: "POLL",
    operationUrl: "/api/operations/op-pay-1",
    resourceUrl: "/api/payments/pay-1",
    retryAfterMs: 1,
  },
  source: { adapter: "wow", sourceStatus: "ACCEPTED" },
};

describe("accepted operation polling", () => {
  it("does not treat acceptance as final and stops on the read-model predicate", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ status: "PROCESSING" })
      .mockResolvedValueOnce({ status: "SUCCEEDED" });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await pollReceipt<{ status: string }>(receipt, { read, isTerminal: (value) => value.status === "SUCCEEDED", wait, intervalMs: 1 });

    expect(result).toMatchObject({ settled: true, attempts: 2, resource: { status: "SUCCEEDED" } });
    expect(wait).toHaveBeenCalledOnce();
  });

  it("returns the latest projection on timeout without inventing failure", async () => {
    const result = await pollReceipt<{ status: string }>(receipt, {
      read: async () => ({ status: "PROCESSING" }),
      isTerminal: () => false,
      attempts: 2,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({ settled: false, attempts: 2, resource: { status: "PROCESSING" } });
  });

  it("READ_ONCE only reads once even when no attempt count is supplied", async () => {
    const readOnceReceipt: OperationReceipt = {
      ...receipt,
      readAfter: { ...receipt.readAfter, mode: "READ_ONCE" },
      source: { adapter: "cap4k", sourceStatus: "ACCEPTED" },
    };
    const read = vi.fn().mockResolvedValue({ status: "PROCESSING" });

    const result = await pollReceipt(readOnceReceipt, { read, isTerminal: () => false, wait: async () => undefined });

    expect(result).toMatchObject({ settled: false, attempts: 1 });
    expect(read).toHaveBeenCalledOnce();
  });
});
