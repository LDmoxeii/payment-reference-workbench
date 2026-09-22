import { createPaymentBackendAdapter, type AdapterFactoryConfig } from "../adapters/factory";
import type { PaymentBackendAdapter } from "../adapters/adapter";
import { BusinessError } from "../domain/errors";
import type { OperationReceipt, Payment, Reconciliation, Refund, Settlement } from "../domain/models";
import { pollReceipt, type PollResult } from "../http/poll";

/**
 * The service exposed to UI code. It deliberately has no backend discriminator:
 * callers use `profile.capabilities` and resource `actions` instead.
 */
export type PaymentWorkbenchService = PaymentBackendAdapter;

export type WorkbenchServiceConfig = AdapterFactoryConfig;

export function createWorkbenchService(config: WorkbenchServiceConfig): PaymentWorkbenchService {
  return createPaymentBackendAdapter(config);
}

type ReceiptResource = Payment | Refund | Reconciliation | Settlement;

interface ResolveOptions<T extends ReceiptResource> {
  isReady?: (resource: T) => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}

async function resolveReceipt<T extends ReceiptResource>(
  receipt: OperationReceipt,
  read: () => Promise<T>,
  options: ResolveOptions<T> = {},
): Promise<PollResult<T>> {
  let lastNotFound: BusinessError | undefined;
  const result = await pollReceipt<T | undefined>(receipt, {
    read: async () => {
      try {
        return await read();
      } catch (error) {
        if (error instanceof BusinessError && error.code === "NOT_FOUND" && receipt.refresh === "poll") {
          lastNotFound = error;
          return undefined;
        }
        throw error;
      }
    },
    isTerminal: (resource) => resource !== undefined && (options.isReady?.(resource) ?? defaultReady(receipt, resource)),
    attempts: options.attempts,
    intervalMs: options.intervalMs,
    wait: options.wait,
  });
  if (!result.resource && lastNotFound) throw lastNotFound;
  return result as PollResult<T>;
}

export function resolvePaymentReceipt(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  options?: ResolveOptions<Payment>,
): Promise<PollResult<Payment>> {
  return resolveReceipt(receipt, () => service.getPayment(receipt.resourceId), options);
}

export function resolveRefundReceipt(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  options?: ResolveOptions<Refund>,
): Promise<PollResult<Refund>> {
  return resolveReceipt(receipt, () => service.getRefund(receipt.resourceId), options);
}

export function resolveReconciliationReceipt(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  options?: ResolveOptions<Reconciliation>,
): Promise<PollResult<Reconciliation>> {
  return resolveReceipt(receipt, () => service.getReconciliation(receipt.resourceId), options);
}

export function resolveSettlementReceipt(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  options?: ResolveOptions<Settlement>,
): Promise<PollResult<Settlement>> {
  return resolveReceipt(receipt, () => service.getSettlement(receipt.resourceId), options);
}

function defaultReady(receipt: OperationReceipt, resource: ReceiptResource): boolean {
  if (receipt.refresh === "read_once") return true;
  if (receipt.sourceStatus && resource.source.sourceStatus && receipt.sourceStatus !== resource.source.sourceStatus) return true;
  const status = resource.status;
  return ["SUCCEEDED", "FAILED", "CLOSED", "COMPLETED", "BLOCKED", "PENDING_CONFIRMATION", "REVIEW_REQUIRED", "VOIDED"].includes(status);
}
