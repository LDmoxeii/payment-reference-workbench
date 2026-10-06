import { useLayoutEffect, useMemo } from "react";

export interface ConfirmationScope { active: boolean }
export interface ConfirmationRequest { id: number; message: string }

let current: (ConfirmationRequest & { scope?: ConfirmationScope; resolve: (value: boolean) => void }) | undefined;
let nextId = 0;
const listeners = new Set<() => void>();

function notify() { for (const listener of listeners) listener(); }
export function isConfirmationScopeActive(scope?: ConfirmationScope): boolean { return scope?.active !== false; }
export function getConfirmation(): ConfirmationRequest | undefined { return current; }
export function subscribeConfirmation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && current) answerConfirmation(current.id, false);
  };
}

export function answerConfirmation(id: number, accepted: boolean) {
  if (current?.id !== id) return;
  const request = current;
  current = undefined;
  notify();
  request.resolve(accepted && isConfirmationScopeActive(request.scope));
}

function cancelScope(scope: ConfirmationScope) {
  scope.active = false;
  if (current?.scope === scope) answerConfirmation(current.id, false);
}

/** Context changes and unmounts invalidate a pending command, rather than queue it. */
export function useConfirmationScope(context: unknown, owner?: unknown, selection?: unknown): ConfirmationScope {
  const scope = useMemo<ConfirmationScope>(() => ({ active: true }), [context, owner, selection]);
  useLayoutEffect(() => {
    scope.active = true;
    return () => cancelScope(scope);
  }, [scope]);
  return scope;
}

/** Every application request requires an explicit choice in ConfirmationHost. */
export async function requestConfirmation(message: string, scope?: ConfirmationScope): Promise<boolean> {
  if (!isConfirmationScopeActive(scope) || current) return false;
  if (!listeners.size) return false;
  const accepted = await new Promise<boolean>((resolve) => {
    current = { id: ++nextId, message, scope, resolve };
    notify();
  });
  return accepted && isConfirmationScopeActive(scope);
}
