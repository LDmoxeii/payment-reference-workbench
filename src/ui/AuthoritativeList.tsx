import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, RefreshCw } from "lucide-react";
import type { Finality, PageFilters, PageRequest, PageResult } from "../domain/models";
import { EmptyBlock, ErrorBlock, LoadingBlock, SectionHeader } from "./components";

interface FilterDraft { merchantId: string; status: string; finality: string; resourceId: string; createdFrom: string; createdTo: string; }
const emptyFilters: FilterDraft = { merchantId: "", status: "", finality: "", resourceId: "", createdFrom: "", createdTo: "" };

interface Props<T> {
  title: string; description: string; loadPage: (request: PageRequest) => Promise<PageResult<T>>; itemKey: (item: T) => string;
  columns: string[]; renderRow: (item: T, open: () => void) => ReactNode; onOpen: (item: T) => void; refreshKey?: number; extraFilters?: Partial<PageFilters>;
  specificFilters?: Array<{ key: keyof PageFilters; label: string; kind?: "text" | "number" | "boolean" | "date"; placeholder?: string }>;
}

export function AuthoritativeList<T>({ title, description, loadPage, itemKey, columns, renderRow, onOpen, refreshKey, extraFilters, specificFilters = [] }: Props<T>) {
  const [draft, setDraft] = useState<FilterDraft>(emptyFilters);
  const [filters, setFilters] = useState<PageFilters>({});
  const [result, setResult] = useState<PageResult<T>>();
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pageSize, setPageSize] = useState(10);
  const [specificDraft, setSpecificDraft] = useState<Record<string, string>>({});
  const requestSequence = useRef(0);

  async function fetchPage(nextCursor: string | undefined, nextFilters = filters, nextHistory = history) {
    const requestId = ++requestSequence.current;
    setLoading(true); setError(undefined);
    try {
      const value = await loadPage({ filters: { ...nextFilters, ...extraFilters }, cursor: nextCursor, pageSize });
      if (requestSequence.current !== requestId) return;
      setResult(value); setCursor(nextCursor); setHistory(nextHistory);
    } catch (cause) {
      if (requestSequence.current === requestId) setError(cause);
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }

  useEffect(() => { void fetchPage(undefined, filters, []); }, [refreshKey]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next: PageFilters = {
      merchantId: draft.merchantId.trim() || undefined, status: draft.status.trim() || undefined,
      finality: (draft.finality || undefined) as Finality | undefined, resourceId: draft.resourceId.trim() || undefined,
      createdFrom: draft.createdFrom ? new Date(draft.createdFrom).toISOString() : undefined,
      createdTo: draft.createdTo ? new Date(draft.createdTo).toISOString() : undefined,
    };
    for (const field of specificFilters) {
      const value = specificDraft[field.key]?.trim();
      if (!value) continue;
      if (field.kind === "number") Object.assign(next, { [field.key]: Number(value) });
      else if (field.kind === "boolean") Object.assign(next, { [field.key]: value === "true" });
      else Object.assign(next, { [field.key]: value });
    }
    setFilters(next); void fetchPage(undefined, next, []);
  }

  return <section><SectionHeader title={title} description={description} action={<button className="button button--small" type="button" disabled={loading} onClick={() => void fetchPage(cursor)}><RefreshCw size={15} />刷新本页</button>} />
    <form className="panel form-grid" onSubmit={applyFilters}>
      <label><span>商户</span><input value={draft.merchantId} onChange={(event) => setDraft({ ...draft, merchantId: event.target.value })} placeholder="merchantId" /></label>
      <label><span>业务状态</span><input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} placeholder="如 SUCCEEDED" /></label>
      <label><span>最终性</span><select value={draft.finality} onChange={(event) => setDraft({ ...draft, finality: event.target.value })}><option value="">全部</option><option value="NON_FINAL">未终态</option><option value="FINAL">已终态</option><option value="REVIEW_REQUIRED">需人工核对</option></select></label>
      <label><span>稳定资源 ID</span><input value={draft.resourceId} onChange={(event) => setDraft({ ...draft, resourceId: event.target.value })} /></label>
      <label><span>创建时间起</span><input type="datetime-local" value={draft.createdFrom} onChange={(event) => setDraft({ ...draft, createdFrom: event.target.value })} /></label>
      <label><span>创建时间止</span><input type="datetime-local" value={draft.createdTo} onChange={(event) => setDraft({ ...draft, createdTo: event.target.value })} /></label>
      {specificFilters.map((field) => <label key={field.key}><span>{field.label}</span>{field.kind === "boolean" ? <select value={specificDraft[field.key] ?? ""} onChange={(event) => setSpecificDraft({ ...specificDraft, [field.key]: event.target.value })}><option value="">全部</option><option value="true">是</option><option value="false">否</option></select> : <input type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} value={specificDraft[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setSpecificDraft({ ...specificDraft, [field.key]: event.target.value })} />}</label>)}
      <label><span>每页条数</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select></label>
      <div className="form-actions"><button className="button" type="button" onClick={() => { setDraft(emptyFilters); setSpecificDraft({}); setFilters({}); void fetchPage(undefined, {}, []); }}>清空</button><button className="button button--primary" type="submit"><Filter size={15} />应用筛选</button></div>
    </form>
    {error ? <ErrorBlock error={error} onRetry={() => void fetchPage(cursor)} /> : null}{loading ? <LoadingBlock label="正在读取后端权威列表" /> : null}
    {!loading && result?.items.length === 0 ? <EmptyBlock title="当前筛选没有业务数据" detail="这是后端权威空结果；可以调整筛选或创建新资源。" /> : null}
    {!loading && result && result.items.length > 0 ? <div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.items.map((item) => <tr key={itemKey(item)}>{renderRow(item, () => onOpen(item))}</tr>)}</tbody></table></div> : null}
    {result ? <div className="form-actions"><button className="button button--small" type="button" disabled={loading || history.length === 0} onClick={() => { const next = [...history]; const previous = next.pop(); void fetchPage(previous, filters, next); }}><ChevronLeft size={15} />上一页</button><span className="button button--small">第 {history.length + 1} 页 · {result.items.length}/{result.pageSize}</span><button className="button button--small" type="button" disabled={loading || !result.nextCursor} onClick={() => result.nextCursor && void fetchPage(result.nextCursor, filters, [...history, cursor])}>下一页<ChevronRight size={15} /></button></div> : null}
  </section>;
}
