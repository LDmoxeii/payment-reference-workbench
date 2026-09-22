import { describe, expect, it, vi } from "vitest";
import type { OperationReceipt } from "../domain/models";
import { pollReceipt } from "./poll";

const receipt: OperationReceipt = {
  resourceType: "payment",
  resourceId: "pay-1",
  accepted: true,
  reused: false,
  refresh: "poll",
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
});
