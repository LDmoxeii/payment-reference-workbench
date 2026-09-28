import { useRef, useState } from "react";
import type { ApiErrorShape, BusinessCommand, Operation, OperationReceipt } from "../domain/models";
import { AcceptedObservationError, observeReceipt, type ObserveResult, type PaymentWorkbenchService, type ReceiptResource } from "../services/workbench-service";

export interface CommandExecution {
  busy: boolean;
  receipt?: OperationReceipt;
  operation?: Operation;
  timedOut: boolean;
  observationError?: ApiErrorShape;
  run<T extends ReceiptResource>(command: BusinessCommand, read?: () => Promise<T>): Promise<ObserveResult<T>>;
  resume<T extends ReceiptResource>(): Promise<ObserveResult<T>>;
  clear(): void;
}

export function useCommandExecution(service: PaymentWorkbenchService): CommandExecution {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<OperationReceipt>();
  const [operation, setOperation] = useState<Operation>();
  const [timedOut, setTimedOut] = useState(false);
  const [observationError, setObservationError] = useState<ApiErrorShape>();
  const readRef = useRef<(() => Promise<ReceiptResource>) | undefined>(undefined);
  const generation = useRef(0);

  async function run<T extends ReceiptResource>(command: BusinessCommand, read?: () => Promise<T>): Promise<ObserveResult<T>> {
    const current = ++generation.current;
    setBusy(true); setReceipt(undefined); setOperation(undefined); setTimedOut(false); setObservationError(undefined);
    readRef.current = undefined;
    try {
      const accepted = await service.execute(command);
      if (generation.current === current) {
        setReceipt(accepted);
        readRef.current = read as (() => Promise<ReceiptResource>) | undefined;
      }
      const observed = await observeReceipt<T>(service, accepted, { read }).catch((error: unknown) => {
        if (generation.current === current && error instanceof AcceptedObservationError) {
          setTimedOut(true); setObservationError(error.observationError);
        }
        throw error;
      });
      if (generation.current === current) {
        setOperation(observed.operation); setTimedOut(observed.timedOut); setObservationError(observed.observationError);
      }
      return observed;
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function resume<T extends ReceiptResource>(): Promise<ObserveResult<T>> {
    if (!receipt) throw new Error("没有可继续观察的 OperationReceipt。");
    const current = ++generation.current;
    setBusy(true); setTimedOut(false); setObservationError(undefined);
    try {
      const observed = await observeReceipt<T>(service, receipt, { read: readRef.current as (() => Promise<T>) | undefined }).catch((error: unknown) => {
        if (generation.current === current && error instanceof AcceptedObservationError) {
          setTimedOut(true); setObservationError(error.observationError);
        }
        throw error;
      });
      if (generation.current === current) {
        setOperation(observed.operation); setTimedOut(observed.timedOut); setObservationError(observed.observationError);
      }
      return observed;
    } finally { if (generation.current === current) setBusy(false); }
  }

  return { busy, receipt, operation, timedOut, observationError, run, resume, clear: () => { generation.current += 1; setBusy(false); setReceipt(undefined); setOperation(undefined); setTimedOut(false); setObservationError(undefined); readRef.current = undefined; } };
}
