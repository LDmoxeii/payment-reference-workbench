import { describe, expect, it } from "vitest";
import { createRecentStore, type StorageLike } from "./recent-store";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("recent record navigation", () => {
  it("isolates identifiers by adapter and updates an existing record", () => {
    const store = createRecentStore(memoryStorage());
    store.remember({ backendId: "wow", resourceType: "payment", id: "same-id", label: "WOW order", accessedAt: "2026-09-21T01:00:00Z" });
    store.remember({ backendId: "cap4k", resourceType: "payment", id: "same-id", label: "CAP order", accessedAt: "2026-09-21T02:00:00Z" });
    store.remember({ backendId: "wow", resourceType: "payment", id: "same-id", label: "WOW order updated", status: "SUCCEEDED", accessedAt: "2026-09-21T03:00:00Z" });

    expect(store.list("wow")).toEqual([expect.objectContaining({ label: "WOW order updated", status: "SUCCEEDED" })]);
    expect(store.list("cap4k")).toEqual([expect.objectContaining({ label: "CAP order" })]);
  });

  it("removes only the selected backend record", () => {
    const store = createRecentStore(memoryStorage());
    store.remember({ backendId: "wow", resourceType: "refund", id: "refund-1", label: "WOW refund" });
    store.remember({ backendId: "cap4k", resourceType: "refund", id: "refund-1", label: "CAP refund" });

    store.remove("wow", "refund", "refund-1");

    expect(store.list("wow")).toHaveLength(0);
    expect(store.list("cap4k")).toHaveLength(1);
  });

  it("clears only the selected backend history", () => {
    const store = createRecentStore(memoryStorage());
    store.remember({ backendId: "wow", resourceType: "payment", id: "payment-wow", label: "WOW payment" });
    store.remember({ backendId: "cap4k", resourceType: "payment", id: "payment-cap", label: "CAP payment" });

    store.clear("wow");

    expect(store.list("wow")).toHaveLength(0);
    expect(store.list("cap4k")).toEqual([expect.objectContaining({ id: "payment-cap" })]);
  });
});
