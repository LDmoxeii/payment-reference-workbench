import type { ActionDescriptor, ActionKind } from "../domain/models";

export function findAction(actions: ActionDescriptor[] | undefined, kind: ActionKind): ActionDescriptor | undefined {
  return actions?.find((item) => item.kind === kind && item.executable);
}

export function actionDefault(action: ActionDescriptor | undefined, field: string): string | undefined {
  const value = action?.defaultValues?.[field];
  return typeof value === "string" ? value : undefined;
}

export function requiresField(action: ActionDescriptor | undefined, field: string): boolean {
  return action?.requiredFields?.includes(field) ?? false;
}

export function confirmAction(action: ActionDescriptor | undefined): boolean {
  if (!action || action.confirmation === "none") return true;
  const detail = action.confirmation === "danger"
    ? "该操作可能改变资金相关业务状态，提交后不能由工作台自动撤销。"
    : "该操作会推进当前业务流程。";
  return window.confirm(`${action.label}\n\n${detail}\n请确认业务参数与当前后端环境正确。`);
}

export function receiptNotice(settled: boolean, status?: string | null): string {
  if (!settled) return "操作已受理，但读模型尚未收敛。可稍后手动刷新，不代表业务失败。";
  return `操作已受理，已读取最新业务状态${status ? `：${status}` : ""}。`;
}
