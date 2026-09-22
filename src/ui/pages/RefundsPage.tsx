import { FormEvent, useEffect, useState } from "react";
import { Activity, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import type { RecentRecord, Refund } from "../../domain/models";
import { resolveRefundReceipt, type PaymentWorkbenchService } from "../../services/workbench-service";
import { actionDefault, confirmAction, findAction, receiptNotice } from "../action-utils";
import { DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, RecentLink, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { formatMoney, formatTime } from "../format";

interface Props {
  service: PaymentWorkbenchService;
  recent: RecentRecord[];
  initialId?: string;
  onRemember: (record: Omit<RecentRecord, "accessedAt" | "backendId">) => void;
}

const token = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function RefundsPage({ service, recent, initialId, onRemember }: Props) {
  const [lookupId, setLookupId] = useState(initialId ?? "");
  const [refund, setRefund] = useState<Refund>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [showResult, setShowResult] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [result, setResult] = useState({ result: "SUCCEEDED", channel: "", attemptId: "", notificationId: token("refund-notice"), channelRefundId: token("channel-refund") });
  const [review, setReview] = useState({ reviewId: "", decisionId: token("refund-decision"), decision: "CONFIRM_FAILURE", reason: "渠道确认未发生退款", evidence: "reference bank trace" });

  useEffect(() => { if (initialId && initialId !== refund?.id) { setLookupId(initialId); void loadRefund(initialId); } }, [initialId]);

  function applyRefund(value: Refund) {
    const resultAction = findAction(value.actions, "SUBMIT_REFUND_RESULT");
    setRefund(value); setLookupId(value.id);
    setResult((current) => ({ ...current, attemptId: value.attempts[0]?.id ?? current.attemptId, channel: actionDefault(resultAction, "channel") ?? current.channel }));
    setReview((current) => ({ ...current, reviewId: value.reviewIds[0] ?? current.reviewId }));
    onRemember({ resourceType: "refund", id: value.id, label: value.merchantRefundNo || "退款", status: value.status });
  }

  async function loadRefund(id = lookupId, clearNotice = true) {
    if (!id.trim()) return;
    setLoading(true); setError(undefined); if (clearNotice) setNotice(undefined);
    try {
      const value = await service.getRefund(id.trim());
      applyRefund(value);
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function submitResult(event: FormEvent) {
    event.preventDefault(); if (!refund) return;
    const descriptor = findAction(refund.actions, "SUBMIT_REFUND_RESULT");
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined);
    try {
      const receipt = await service.submitRefundResult({ refundId: refund.id, attemptId: result.attemptId, notificationId: result.notificationId, channel: result.channel, channelRefundId: result.channelRefundId, amount: refund.amount, result: result.result as "SUCCEEDED" | "FAILED" | "UNKNOWN" });
      setNotice("退款渠道结果已受理，正在等待退款状态收敛。");
      const resolution = await resolveRefundReceipt(service, receipt, { isReady: (value) => ["SUCCEEDED", "FAILED", "REJECTED", "PENDING_CONFIRMATION"].includes(value.status) });
      if (resolution.resource) applyRefund(resolution.resource);
      setShowResult(false); setResult((value) => ({ ...value, notificationId: token("refund-notice"), channelRefundId: token("channel-refund") }));
      setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault(); if (!refund) return;
    const descriptor = findAction(refund.actions, "ADJUDICATE_REFUND");
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined);
    try {
      const receipt = await service.adjudicateRefund(refund.id, review);
      setNotice("退款复核裁决已受理，正在读取最新业务状态。");
      const resolution = await resolveRefundReceipt(service, receipt);
      if (resolution.resource) applyRefund(resolution.resource);
      setShowReview(false); setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  const canResult = refund?.actions.some((item) => item.kind === "SUBMIT_REFUND_RESULT" && item.executable);
  const canReview = refund?.actions.some((item) => item.kind === "ADJUDICATE_REFUND" && item.executable);

  return (
    <div className="page-stack">
      <SectionHeader title="退款处理" description="查看退款事实、渠道结果与退款预算占用。" />
      <section className="panel lookup-panel"><div><h3><Search size={18} /> 按退款号查询</h3><form className="lookup-form" onSubmit={(event) => { event.preventDefault(); void loadRefund(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Refund ID" /><button className="button" type="submit"><Search size={17} />查询</button></form></div><div className="compact-recent"><span>本地最近记录（非后端全量）</span>{recent.slice(0, 5).map((item) => <RecentLink key={item.id} label={item.label} id={item.id} status={item.status} onOpen={() => { setLookupId(item.id); void loadRefund(item.id); }} />)}</div></section>
      {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
      {error ? <ErrorBlock error={error} onRetry={refund ? () => void loadRefund(refund.id) : undefined} /> : null}
      {loading ? <LoadingBlock /> : null}
      {!loading && !refund ? <EmptyBlock title="尚未选择退款" detail="退款从成功支付详情创建，也可以按退款号查询。" /> : null}
      {refund ? <>
        <section className="detail-heading"><div><span>退款详情</span><h2 className="mono-title">{refund.id}</h2></div><div><StatusBadge status={refund.status} /><button className="icon-button" type="button" title="刷新" onClick={() => void loadRefund(refund.id)}><RefreshCw size={17} /></button></div></section>
        <section className="detail-band"><DefinitionList items={[
          { label: "商户退款号", value: refund.merchantRefundNo }, { label: "来源支付", value: <code>{refund.paymentId}</code> }, { label: "商户", value: refund.merchantId },
          { label: "退款金额", value: formatMoney(refund.amount) }, { label: "申请时间", value: formatTime(refund.requestedAt) }, { label: "完成时间", value: formatTime(refund.finalizedAt) },
          { label: "渠道退款号", value: <code>{refund.channelRefundId ?? "—"}</code> }, { label: "预算占用", value: refund.reservationActive == null ? "未知" : refund.reservationActive ? "占用中" : "已释放或转成功" },
        ]} /><SourceDetails source={refund.source} /></section>

        <section><SectionHeader title="退款尝试与回执" description={`${refund.attempts.length} 次尝试`} /><div className="timeline-list">{refund.attempts.length === 0 ? <EmptyBlock title="暂无退款尝试" /> : refund.attempts.map((attempt) => <article className="timeline-item" key={attempt.id}><div className="timeline-item__icon"><Activity size={17} /></div><div><div className="item-title"><code>{attempt.id}</code><StatusBadge status={attempt.status} /></div><p>{attempt.channel} · {attempt.channelRefundId ?? "尚无渠道退款号"}</p><span>{formatTime(attempt.initiatedAt)} · {attempt.receiptCount} 个回执</span>{attempt.receipts.map((receipt) => <div className="receipt-row" key={receipt.id}><code>{receipt.id}</code><span>{receipt.disposition ?? receipt.result ?? "已记录"}</span><span>{receipt.summary ?? "—"}</span></div>)}</div></article>)}</div></section>

        <section><SectionHeader title="当前可执行动作" /><div className="action-grid">{refund.actions.map((item) => <div className={`action-item ${item.executable ? "" : "action-item--disabled"}`} key={item.kind}><div><strong>{item.label}</strong><span>{item.executable ? "当前可执行" : item.reason}</span></div>{item.executable ? <button className="button button--small" type="button" onClick={() => item.kind === "SUBMIT_REFUND_RESULT" ? setShowResult(true) : setShowReview(true)}>{item.kind === "SUBMIT_REFUND_RESULT" ? <Send size={15} /> : <ShieldCheck size={15} />}{item.label}</button> : null}</div>)}</div></section>

        {showResult && canResult ? <section className="panel action-form"><h3>提交退款渠道结果</h3><form className="form-grid" onSubmit={submitResult}><label><span>退款尝试</span><select value={result.attemptId} onChange={(e) => setResult({ ...result, attemptId: e.target.value })}>{refund.attempts.map((item) => <option key={item.id}>{item.id}</option>)}</select></label><label><span>结果</span><select value={result.result} onChange={(e) => setResult({ ...result, result: e.target.value })}><option value="SUCCEEDED">成功</option><option value="FAILED">失败</option><option value="UNKNOWN">未知</option></select></label><label><span>渠道</span><input value={result.channel} onChange={(e) => setResult({ ...result, channel: e.target.value })} /></label><label><span>通知号</span><input value={result.notificationId} onChange={(e) => setResult({ ...result, notificationId: e.target.value })} /></label><label className="span-2"><span>渠道退款号</span><input value={result.channelRefundId} onChange={(e) => setResult({ ...result, channelRefundId: e.target.value })} /></label><div className="form-actions span-2"><button className="button" type="button" onClick={() => setShowResult(false)}>取消</button><button className="button button--danger" type="submit"><Send size={16} />提交结果</button></div></form></section> : null}
        {showReview && canReview ? <section className="panel action-form"><h3>退款复核裁决</h3><form className="form-grid" onSubmit={submitReview}><label><span>复核标识</span><input value={review.reviewId} onChange={(e) => setReview({ ...review, reviewId: e.target.value })} /></label><label><span>裁决</span><select value={review.decision} onChange={(e) => setReview({ ...review, decision: e.target.value })}><option>CONFIRM_FAILURE</option><option>ACCEPT_SUCCESS</option><option>KEEP_UNKNOWN</option></select></label><label><span>决定标识</span><input value={review.decisionId} onChange={(e) => setReview({ ...review, decisionId: e.target.value })} /></label><label><span>原因</span><input value={review.reason} onChange={(e) => setReview({ ...review, reason: e.target.value })} /></label><label className="span-2"><span>证据</span><input value={review.evidence} onChange={(e) => setReview({ ...review, evidence: e.target.value })} /></label><div className="form-actions span-2"><button className="button" type="button" onClick={() => setShowReview(false)}>取消</button><button className="button button--danger" type="submit"><ShieldCheck size={16} />确认裁决</button></div></form></section> : null}
      </> : null}
    </div>
  );
}
