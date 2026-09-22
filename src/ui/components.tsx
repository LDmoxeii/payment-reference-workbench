import type { ReactNode } from "react";
import { AlertCircle, ChevronRight, Inbox, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { BusinessError } from "../domain/errors";
import { statusLabel, statusTone } from "./format";

export function StatusBadge({ status }: { status?: string | null }) {
  return <span className={`status status--${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
      {action ? <div className="section-header__action">{action}</div> : null}
    </div>
  );
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
  return (
    <div className="error-block" role="alert">
      <AlertCircle size={20} />
      <div className="error-block__body">
        <strong>{message}</strong>
        {business ? <span>{business.code}{business.sourceCode ? ` · ${business.sourceCode}` : ""} · {business.retryable ? "可重试" : "不可重试"}</span> : null}
        {business?.fields.map((field) => <span key={field.field}>{field.field}：{field.message}</span>)}
        {business && ((business.sourceMessage && business.sourceMessage !== message) || business.diagnostic !== undefined) ? <details><summary>源错误与诊断</summary>{business.sourceMessage && business.sourceMessage !== message ? <pre>{business.sourceMessage}</pre> : null}{business.diagnostic !== undefined ? <pre>{diagnosticText(business.diagnostic)}</pre> : null}</details> : null}
      </div>
      {onRetry ? <button className="icon-button" type="button" onClick={onRetry} title="重试"><RefreshCw size={17} /></button> : null}
    </div>
  );
}

function diagnosticText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="definition-list">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function SourceDetails({ source }: { source: { adapter: string; sourceStatus?: string | null; sourceId?: string | null; diagnostic?: string | null } }) {
  return (
    <details className="source-details">
      <summary>源实现信息</summary>
      <DefinitionList items={[
        { label: "适配来源", value: source.adapter.toUpperCase() },
        { label: "源状态", value: source.sourceStatus ?? "—" },
        { label: "源标识", value: <code>{source.sourceId ?? "—"}</code> },
        { label: "诊断", value: source.diagnostic ?? "—" },
      ]} />
    </details>
  );
}

export function RecentLink({ label, id, status, onOpen, onRemove }: { label: string; id: string; status?: string; onOpen: () => void; onRemove?: () => void }) {
  return <div className="recent-row"><button className="recent-link" type="button" onClick={onOpen}><span><strong>{label}</strong><code>{id}</code></span>{status ? <StatusBadge status={status} /> : null}<ChevronRight size={17} /></button>{onRemove ? <button className="recent-remove" type="button" onClick={onRemove} title="移除本地记录" aria-label={`移除 ${label} 的本地记录`}><Trash2 size={16} /></button> : null}</div>;
}

export function InlineNotice({ tone = "info", children }: { tone?: "info" | "success" | "warning"; children: ReactNode }) {
  return <div className={`inline-notice inline-notice--${tone}`}>{children}</div>;
}
