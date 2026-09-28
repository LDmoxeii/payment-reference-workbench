import type { ActionDescriptor, ActionKind } from "../domain/models";

export function findAction(actions: ActionDescriptor[] | undefined, kind: ActionKind): ActionDescriptor | undefined {
  return actions?.find((item) => item.kind === kind);
}

export function canExecute(actions: ActionDescriptor[] | undefined, kind: ActionKind): boolean {
  return Boolean(findAction(actions, kind)?.executable);
}

export function confirmAction(action: ActionDescriptor | undefined, fallbackLabel?: string): boolean {
  const confirmation = action?.confirmation ?? "confirm";
  if (confirmation === "none") return true;
  const label = action?.label ?? fallbackLabel ?? "确认执行";
  const detail = confirmation === "danger"
    ? "该操作会改变资金或责任相关业务事实，工作台不会自动撤销。"
    : "该操作会推进当前业务流程。";
  return window.confirm(`${label}\n\n${detail}\n请确认输入与当前 reference 环境正确。`);
}

export function token(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
