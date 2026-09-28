import { createPaymentBackendAdapter, type AdapterFactoryConfig } from "../adapters/factory";
import type { PaymentBackendAdapter } from "../adapters/adapter";
import { BusinessError } from "../domain/errors";
import type {
  ApiErrorShape,
  AuthoritativeBill,
  ManualReviewItem,
  MerchantNotification,
  Operation,
  OperationReceipt,
  Payment,
  ReconciliationRun,
  Refund,
  Settlement,
} from "../domain/models";

/** UI code receives only this backend-neutral service. */
export type PaymentWorkbenchService = PaymentBackendAdapter;
export type WorkbenchServiceConfig = AdapterFactoryConfig;

export function createWorkbenchService(config: WorkbenchServiceConfig): PaymentWorkbenchService {
  return createPaymentBackendAdapter(config);
}

export type ReceiptResource = Payment | Refund | ReconciliationRun | Settlement | ManualReviewItem | AuthoritativeBill | MerchantNotification;

export interface ObserveResult<T extends ReceiptResource = ReceiptResource> {
  operation: Operation;
  resource?: T;
  timedOut: boolean;
  /** Observer failure only; it never replaces Operation.error or domain status. */
  observationError?: ApiErrorShape;
}

export interface ObserveOptions<T extends ReceiptResource = ReceiptResource> {
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
  read?: () => Promise<T>;
}

/**
 * Observe the accepted command exactly as described by readAfter. A timeout is an
 * observer result, never a mutation of the operation or domain resource.
 */
export async function observeReceipt<T extends ReceiptResource = ReceiptResource>(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  options: ObserveOptions<T> = {},
): Promise<ObserveResult<T>> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = receipt.readAfter.mode === "READ_ONCE" ? 1 : options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? receipt.readAfter.retryAfterMs ?? 100;
  let operation: Operation | undefined;

  for (let index = 0; index < attempts; index += 1) {
    try {
      operation = await service.getOperation(receipt.operationId);
    } catch (error) {
      if (!operation) throw new AcceptedObservationError(receipt, observationFailure(error, receipt));
      return { operation, timedOut: true, observationError: observationFailure(error, receipt) };
    }
    if (isTerminalOperation(operation)) {
      let resource: T | ReceiptResource | undefined;
      try {
        resource = await readResourceSafely(service, receipt, options.read);
      } catch (error) {
        return { operation, timedOut: true, observationError: observationFailure(error, receipt) };
      }
      const resourceExpected = Boolean(receipt.resource);
      const resourcePending = operation.status === "SUCCEEDED" && resourceExpected && resource === undefined;
      if (!resourcePending) {
        return { operation, resource: resource as T | undefined, timedOut: false };
      }
      if (receipt.readAfter.mode === "READ_ONCE") {
        return { operation, timedOut: true, observationError: resourceNotReady(receipt) };
      }
    }
    if (index + 1 < attempts) await wait(intervalMs);
  }

  if (!operation) operation = await service.getOperation(receipt.operationId);
  return {
    operation,
    timedOut: true,
    observationError: observationTimeout(receipt, attempts),
  };
}

export function isTerminalOperation(operation: Operation): boolean {
  return operation.status === "SUCCEEDED" || operation.status === "FAILED" || operation.status === "REVIEW_REQUIRED";
}

async function readResourceSafely<T extends ReceiptResource>(
  service: PaymentWorkbenchService,
  receipt: OperationReceipt,
  override?: () => Promise<T>,
): Promise<T | ReceiptResource | undefined> {
  if (!receipt.resource) return undefined;
  try {
    if (override) return await override();
    const type = receipt.resource.resourceType.toLowerCase();
    const id = receipt.resource.resourceId;
    if (type.includes("payment")) return await service.getPayment(id);
    if (type.includes("refund")) return await service.getRefund(id);
    if (type.includes("reconciliation") || type.includes("run")) return await service.getReconciliationRun(id);
    if (type.includes("settlement")) return await service.getSettlement(id);
    if (type.includes("review")) return await service.getManualReview(id);
    if (type.includes("notification")) return await service.getNotification(id);
    if (type.includes("bill") || type.includes("statement")) return await service.getBill(id);
    return undefined;
  } catch (error) {
    if (error instanceof BusinessError && error.code === "RESOURCE_NOT_READY") return undefined;
    throw error;
  }
}

export function receiptResourceId(receipt: OperationReceipt): string | undefined {
  return receipt.resource?.resourceId;
}

/** Raised only when an accepted command has no readable Operation yet. */
export class AcceptedObservationError extends Error {
  readonly receipt: OperationReceipt;
  readonly observationError: ApiErrorShape;

  constructor(receipt: OperationReceipt, observationError: ApiErrorShape) {
    super(`命令已受理（${receipt.operationId}），Operation 观察失败：${observationError.message}`);
    this.name = "AcceptedObservationError";
    this.receipt = receipt;
    this.observationError = observationError;
  }
}

function observationFailure(error: unknown, receipt: OperationReceipt): ApiErrorShape {
  if (error instanceof BusinessError) {
    return {
      code: error.code, message: error.message, fields: error.fields,
      retryable: error.retryable, correlationId: error.correlationId ?? receipt.correlationId ?? undefined,
      details: error.details, diagnostic: error.diagnostic,
      sourceCode: error.sourceCode, sourceMessage: error.sourceMessage,
    };
  }
  return {
    code: "OBSERVATION_FAILED",
    message: error instanceof Error ? error.message : "Operation 或资源读取失败",
    fields: [], retryable: true, correlationId: receipt.correlationId ?? undefined,
    details: { operationId: receipt.operationId, resource: receipt.resource ?? null },
  };
}

function resourceNotReady(receipt: OperationReceipt): ApiErrorShape {
  return {
    code: "RESOURCE_NOT_READY", message: "命令已受理，Operation 已完成，但详情尚未更新。",
    fields: [], retryable: true, correlationId: receipt.correlationId ?? undefined,
    details: { operationId: receipt.operationId, resource: receipt.resource ?? null, readAfter: receipt.readAfter },
  };
}

function observationTimeout(receipt: OperationReceipt, attempts: number): ApiErrorShape {
  return {
    code: "OBSERVATION_TIMEOUT",
    message: "操作观察暂未在本次等待窗口内收敛，可按同一 operationId 继续观察。",
    details: {
      operationId: receipt.operationId,
      resource: receipt.resource ?? null,
      readAfter: receipt.readAfter,
      attempts,
    },
    correlationId: receipt.correlationId ?? undefined,
    retryable: true,
    fields: [],
  };
}
