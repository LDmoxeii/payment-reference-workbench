import type { ActionDescriptor, ActionKind } from "../domain/models";
import { getConfirmation, isConfirmationScopeActive, requestConfirmation, type ConfirmationScope } from "./confirmation";

export function findAction(actions: ActionDescriptor[] | undefined, kind: ActionKind): ActionDescriptor | undefined {
  return actions?.find((item) => item.kind === kind);
}

export function canExecute(actions: ActionDescriptor[] | undefined, kind: ActionKind): boolean {
  return Boolean(findAction(actions, kind)?.executable);
}

export async function confirmAction(action: ActionDescriptor | undefined, fallbackLabel?: string, scope?: ConfirmationScope): Promise<boolean> {
  if (!isConfirmationScopeActive(scope) || action?.executable === false || getConfirmation()) return false;
  const confirmation = action?.confirmation ?? "confirm";
  if (confirmation === "none") return scope?.active !== false;
  const label = action?.label ?? fallbackLabel ?? "确认执行";
  const detail = confirmation === "danger"
    ? "该操作会改变资金或责任相关业务事实，工作台不会自动撤销。"
    : "该操作会推进当前业务流程。";
  const accepted = await requestConfirmation(`${label}\n\n${detail}\n请确认输入与当前 reference 环境正确。`, scope);
  return accepted && isConfirmationScopeActive(scope);
}

export function token(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
