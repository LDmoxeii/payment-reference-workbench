import { describe, expect, it, vi } from "vitest";
import { BusinessError } from "../domain/errors";
import type { Operation, OperationReceipt, Payment } from "../domain/models";
import type { PaymentWorkbenchService } from "./workbench-service";
import { observeReceipt } from "./workbench-service";

function receipt(mode: OperationReceipt["readAfter"]["mode"]): OperationReceipt {
  return {
    operationId: "op-1",
    commandType: "CREATE_PAYMENT",
    resource: { resourceType: "Payment", resourceId: "pay-1" },
    acceptanceStatus: "ACCEPTED",
    acceptedAt: "2026-09-25T01:00:00Z",
    idempotentReplay: false,
    correlationId: "corr-1",
    readAfter: {
      mode,
      operationUrl: "/api/operations/op-1",
      resourceUrl: "/api/payments/pay-1",
      retryAfterMs: 1,
    },
    source: { adapter: mode === "POLL" ? "wow" : "cap4k", sourceStatus: "ACCEPTED" },
  };
}

function operation(status: Operation["status"]): Operation {
  return {
    operationId: "op-1",
    commandType: "CREATE_PAYMENT",
    resource: { resourceType: "Payment", resourceId: "pay-1" },
    status,
    source: { adapter: "wow", sourceStatus: status },
  };
}

const payment = {
  resourceType: "payment",
  paymentId: "pay-1",
  merchantId: "merchant-1",
  merchantOrderId: "order-1",
  money: { currency: "CNY", amountMinor: "100" },
  paymentMethod: "DEFAULT",
  status: "PAYABLE",
  finality: "NON_FINAL",
  attempts: [],
  reviewIds: [],
  actions: [],
  source: { adapter: "wow" },
} satisfies Payment;

describe("OperationReceipt observation", () => {
  it("POLL waits for an Operation terminal state and only then reads the resource", async () => {
    const getOperation = vi.fn()
      .mockResolvedValueOnce(operation("ACCEPTED"))
      .mockResolvedValueOnce(operation("PROCESSING"))
      .mockResolvedValueOnce(operation("SUCCEEDED"));
    const getPayment = vi.fn().mockResolvedValue(payment);
    const service = { getOperation, getPayment } as unknown as PaymentWorkbenchService;
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await observeReceipt(service, receipt("POLL"), { attempts: 4, intervalMs: 1, wait });

    expect(result).toMatchObject({ operation: { status: "SUCCEEDED" }, resource: { paymentId: "pay-1" }, timedOut: false });
    expect(getOperation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(getPayment).toHaveBeenCalledWith("pay-1");
  });

  it("READ_ONCE does not turn a still-processing Operation into a domain failure", async () => {
    const getOperation = vi.fn().mockResolvedValue(operation("PROCESSING"));
    const getPayment = vi.fn();
    const service = { getOperation, getPayment } as unknown as PaymentWorkbenchService;

    const result = await observeReceipt(service, receipt("READ_ONCE"));

    expect(result).toMatchObject({
      operation: { status: "PROCESSING" },
      timedOut: true,
      observationError: {
        code: "OBSERVATION_TIMEOUT",
        retryable: true,
        correlationId: "corr-1",
        details: { operationId: "op-1", attempts: 1 },
      },
    });
    expect(result).not.toHaveProperty("resource");
    expect(getOperation).toHaveBeenCalledOnce();
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("keeps the terminal Operation but reports observation timeout while its projection is RESOURCE_NOT_READY", async () => {
    const getOperation = vi.fn().mockResolvedValue(operation("SUCCEEDED"));
    const getPayment = vi.fn().mockRejectedValue(new BusinessError({
      code: "RESOURCE_NOT_READY",
      message: "projection is catching up",
      fields: [],
      retryable: true,
      correlationId: "corr-1",
    }));
    const service = { getOperation, getPayment } as unknown as PaymentWorkbenchService;

    const result = await observeReceipt(service, receipt("POLL"), { attempts: 1 });

    expect(result).toMatchObject({
      operation: operation("SUCCEEDED"),
      timedOut: true,
      observationError: {
        code: "OBSERVATION_TIMEOUT",
        retryable: true,
        details: {
          operationId: "op-1",
          resource: { resourceType: "Payment", resourceId: "pay-1" },
          readAfter: { mode: "POLL" },
          attempts: 1,
        },
      },
    });
    expect(result.operation.status).toBe("SUCCEEDED");
    expect(result).not.toHaveProperty("resource");
  });
});
