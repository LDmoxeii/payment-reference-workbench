import { createWorkbenchService } from "../services/workbench-service";
import { createRecentStore } from "../services/recent-store";
import type { BackendId } from "../domain/models";

function backendId(value: string | undefined): BackendId {
  if (value === "wow" || value === "cap4k") return value;
  throw new Error(`VITE_PAYMENT_ADAPTER 必须是 wow 或 cap4k，当前为 ${value ?? "未配置"}`);
}

export const runtimeConfig = {
  backend: backendId(import.meta.env.VITE_PAYMENT_ADAPTER),
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/backend/api",
  verificationMaterial: import.meta.env.VITE_CAP4K_VERIFICATION_MATERIAL || undefined,
};

export const workbenchService = createWorkbenchService(runtimeConfig);
export const recentStore = createRecentStore(window.localStorage);
