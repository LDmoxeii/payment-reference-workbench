import type { BackendId, RecentRecord, ResourceType } from "../domain/models";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecentStore {
  list(backendId: BackendId): RecentRecord[];
  remember(record: Omit<RecentRecord, "accessedAt"> & { accessedAt?: string }): void;
  remove(backendId: BackendId, resourceType: ResourceType, id: string): void;
  clear(backendId: BackendId): void;
}

const KEY = "payment-reference-workbench:recent:v1";
const MAX_RECORDS_PER_BACKEND = 20;

export function createRecentStore(storage: StorageLike | undefined): RecentStore {
  const load = (): RecentRecord[] => {
    if (!storage) return [];
    try {
      const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isRecentRecord) : [];
    } catch {
      return [];
    }
  };
  const save = (records: RecentRecord[]): void => {
    if (storage) storage.setItem(KEY, JSON.stringify(records));
  };
  return {
    list(backendId) {
      return load().filter((record) => record.backendId === backendId).sort((a, b) => b.accessedAt.localeCompare(a.accessedAt));
    },
    remember(record) {
      const normalized: RecentRecord = { ...record, accessedAt: record.accessedAt ?? new Date().toISOString() };
      const rest = load().filter((entry) => !(entry.backendId === normalized.backendId && entry.resourceType === normalized.resourceType && entry.id === normalized.id));
      const sameBackend = [normalized, ...rest.filter((entry) => entry.backendId === normalized.backendId)].slice(0, MAX_RECORDS_PER_BACKEND);
      save([...sameBackend, ...rest.filter((entry) => entry.backendId !== normalized.backendId)]);
    },
    remove(backendId, resourceType, id) {
      save(load().filter((entry) => !(entry.backendId === backendId && entry.resourceType === resourceType && entry.id === id)));
    },
    clear(backendId) {
      save(load().filter((entry) => entry.backendId !== backendId));
    },
  };
}

function isRecentRecord(value: unknown): value is RecentRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RecentRecord>;
  return typeof record.id === "string" && typeof record.label === "string" && typeof record.backendId === "string" && typeof record.resourceType === "string" && typeof record.accessedAt === "string";
}
