import type { ReactNode } from "react";
import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { BusinessError } from "../domain/errors";
import type { ApiErrorShape, Operation, OperationReceipt } from "../domain/models";
import { formatTime, statusLabel, statusTone } from "./format";

export function StatusBadge({ status }: { status?: string | null }) {
  return <span className={`status status--${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action ? <div className="section-header__action">{action}</div> : null}</div>;
}

export function LoadingBlock({ label = "正在读取业务事实" }: { label?: string }) {
  return <div className="state-block"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>;
}

export function EmptyBlock({ title, detail }: { title: string; detail?: string }) {
  return <div className="state-block state-block--empty"><Inbox size={22} /><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</div>;
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const business = error instanceof BusinessError ? error : null;
  const message = error instanceof Error ? error.message : "请求失败";
  return <div className="error-block" role="alert"><AlertCircle size={20} /><div className="error-block__body">
    <strong>{message}</strong>
    {business ? <span>{business.code} · {business.retryable ? "可安全重试" : "请检查输入或当前业务状态"}{business.correlationId ? ` · correlation ${business.correlationId}` : ""}</span> : <span>网络或客户端异常</span>}
    {business?.fields.map((field) => <span key={`${field.field}:${field.code ?? ""}`}>{field.field}：{field.message}</span>)}
    {business && (business.details !== undefined || business.diagnostic !== undefined || business.sourceMessage) ? <details><summary>错误详情与源诊断</summary>{business.sourceMessage ? <pre>{business.sourceMessage}</pre> : null}{business.details !== undefined ? <pre>{diagnosticText(business.details)}</pre> : null}{business.diagnostic !== undefined ? <pre>{diagnosticText(business.diagnostic)}</pre> : null}</details> : null}
  </div>{onRetry ? <button className="icon-button" type="button" onClick={onRetry} title="重试"><RefreshCw size={17} /></button> : null}</div>;
}

function diagnosticText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="definition-list">{items.map((item, index) => <div key={`${item.label}:${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function SourceDetails({ source }: { source: { adapter: string; sourceStatus?: string | null; sourceId?: string | null; diagnostic?: unknown } }) {
  return <details className="source-details"><summary>源实现诊断（只读）</summary><DefinitionList items={[
    { label: "适配来源", value: source.adapter.toUpperCase() }, { label: "源状态", value: source.sourceStatus ?? "—" },
    { label: "源标识", value: <code>{source.sourceId ?? "—"}</code> }, { label: "诊断", value: source.diagnostic === undefined ? "—" : <pre>{diagnosticText(source.diagnostic)}</pre> },
  ]} /></details>;
}

export function InlineNotice({ tone = "info", children }: { tone?: "info" | "success" | "warning"; children: ReactNode }) {
  return <div className={`inline-notice inline-notice--${tone}`}>{children}</div>;
}

export function CommandFeedback({ receipt, operation, timedOut, observationError, onContinue, busy = false }: { receipt?: OperationReceipt; operation?: Operation; timedOut?: boolean; observationError?: ApiErrorShape; onContinue?: () => void; busy?: boolean }) {
  if (!receipt) return null;
  return <section className="panel"><SectionHeader title="最近一次命令" description="受理回执、异步 Operation 与业务资源是三个独立层次。" />
    <DefinitionList items={[
      { label: "命令", value: receipt.commandType }, { label: "受理", value: <StatusBadge status={receipt.acceptanceStatus} /> },
      { label: "Operation", value: <code>{receipt.operationId}</code> }, { label: "Operation 状态", value: operation ? <StatusBadge status={operation.status} /> : timedOut ? "观察超时" : "等待观察" },
      { label: "资源", value: receipt.resource ? <code>{receipt.resource.resourceType}:{receipt.resource.resourceId}</code> : "—" }, { label: "Read after", value: receipt.readAfter.mode },
      { label: "受理时间", value: formatTime(receipt.acceptedAt) }, { label: "Correlation", value: <code>{receipt.correlationId ?? "—"}</code> },
    ]} />
    {timedOut ? <><InlineNotice tone="warning"><span><strong>{observationError?.code ?? "OBSERVATION_TIMEOUT"}</strong> · 观察窗口已超时，但这不表示领域操作失败。可以继续使用同一 Operation ID 与资源引用观察。</span></InlineNotice>{observationError ? <details className="source-details"><summary>观察诊断</summary><DefinitionList items={[{ label: "稳定错误码", value: observationError.code }, { label: "可重试", value: observationError.retryable ? "是" : "否" }, { label: "Correlation", value: <code>{observationError.correlationId ?? receipt.correlationId ?? "—"}</code> }, { label: "详情", value: <pre>{diagnosticText(observationError.details)}</pre> }]} /></details> : null}{onContinue ? <button className="button button--small" type="button" disabled={busy} onClick={onContinue}><RefreshCw size={15} />继续观察同一 Operation</button> : null}</> : null}
    {operation?.error ? <details className="source-details"><summary>Operation 错误</summary><pre>{diagnosticText(operation.error)}</pre></details> : null}
  </section>;
}
