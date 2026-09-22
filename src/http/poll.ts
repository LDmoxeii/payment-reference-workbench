import type { OperationReceipt } from "../domain/models";

export interface PollOptions<T> {
  read: () => Promise<T>;
  isTerminal: (resource: T) => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export interface PollResult<T> {
  receipt: OperationReceipt;
  resource?: T;
  settled: boolean;
  attempts: number;
}

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a read model after an accepted command without treating acceptance as a terminal result. */
export async function pollReceipt<T>(receipt: OperationReceipt, options: PollOptions<T>): Promise<PollResult<T>> {
  if (!receipt.accepted || receipt.refresh === "none") return { receipt, settled: false, attempts: 0 };
  const attempts = options.attempts ?? (receipt.refresh === "read_once" ? 1 : 8);
  const intervalMs = options.intervalMs ?? 450;
  const wait = options.wait ?? defaultWait;
  let last: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await options.read();
    if (options.isTerminal(last)) return { receipt, resource: last, settled: true, attempts: attempt };
    if (attempt < attempts) await wait(intervalMs);
  }
  return { receipt, resource: last, settled: false, attempts };
}
