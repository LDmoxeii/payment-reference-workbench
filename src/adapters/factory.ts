import type { BackendId } from "../domain/models";
import type { FetchLike } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import { Cap4kPaymentAdapter } from "./cap4k-adapter";
import { WowPaymentAdapter } from "./wow-adapter";

/** Runtime-only values. Pages never branch on this configuration. */
export interface AdapterRuntimeOptions {
  apiBaseUrl: string;
  fetchImpl?: FetchLike;
  /** Stable reference fixture selected by the workbench. */
  fixtureId?: string;
  /** Optional reconciliation actor alias. Responsibility commands still carry their action-specific alias. */
  actorAlias?: string;
  /** Allows deterministic tests and an explicit expiry policy at the composition boundary. */
  now?: () => Date;
}

export interface AdapterFactoryConfig extends AdapterRuntimeOptions {
  backend: BackendId;
}

export function createPaymentBackendAdapter(config: AdapterFactoryConfig): PaymentBackendAdapter {
  switch (config.backend) {
    case "wow":
      return new WowPaymentAdapter(config);
    case "cap4k":
      return new Cap4kPaymentAdapter(config);
  }
}
