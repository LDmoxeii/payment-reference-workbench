import { type FormEvent, useEffect, useRef, useState } from "react";
import { Activity, Play, RefreshCw, Search, Send, Undo2 } from "lucide-react";
import { createMoney, decimalToMinor } from "../../domain/money";
import type { BusinessCommand, ChannelOutcome, Payment, ReferenceEnvironment, Refund } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { canExecute, confirmAction, findAction, token } from "../action-utils";
import { AuthoritativeList } from "../AuthoritativeList";
import { CommandFeedback, DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { formatMoney, formatTime } from "../format";
import { useCommandExecution } from "../useCommandExecution";

const requestDefaults = () => ({ merchantId: "reference-merchant", paymentId: "", merchantRefundId: token("refund"), idempotencyKey: token("refund-request"), amount: "20.00", currency: "CNY", reason: "商户申请部分退款" });
type RetryCommand = { command: BusinessCommand; label: string; resourceId?: string };

export function RefundsPage({ service, initialId }: { service: PaymentWorkbenchService; initialId?: string }) {
  const execution = useCommandExecution(service);
  const [request, setRequest] = useState(requestDefaults);
  const [refund, setRefund] = useState<Refund>();
  const [budget, setBudget] = useState<Payment["refundBudget"]>();
  const [lookupId, setLookupId] = useState(initialId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [retryCommand, setRetryCommand] = useState<RetryCommand>();
  const [refreshKey, setRefreshKey] = useState(0);
  const refundContext = useRef(0);
  const [attempt, setAttempt] = useState({ attemptId: "", idempotencyKey: token("refund-attempt"), paymentMethod: "DEFAULT", riskReason: "" });
  const [submission, setSubmission] = useState({ attemptId: "", submissionId: token("refund-submission"), idempotencyKey: token("refund-submit") });
  const [result, setResult] = useState({ attemptId: "", channelId: "", resultIdentity: token("refund-result"), externalTransactionId: "", outcome: "SUCCESS" as ChannelOutcome, occurredAt: new Date().toISOString(), failureDisposition: "" });

  async function loadBudget(paymentId: string, context: number) {
    try {
      const nextBudget = (await service.getPayment(paymentId)).refundBudget;
      if (refundContext.current === context) setBudget(nextBudget);
    } catch (cause) {
      if (refundContext.current === context) { setBudget(undefined); setError(cause); }
    }
  }
  function applyRefundInContext(value: Refund, context: number) {
    if (refundContext.current !== context) return;
    setRefund(value); setLookupId(value.refundId);
    setBudget(undefined);
    void loadBudget(value.paymentId, context);
    const latest = value.attempts.at(-1);
    if (latest) { setSubmission((old) => ({ ...old, attemptId: latest.attemptId })); setResult((old) => ({ ...old, attemptId: latest.attemptId, externalTransactionId: latest.externalTransactionId ?? old.externalTransactionId, channelId: latest.channelId || old.channelId })); }
  }
  function applyRefund(value: Refund) {
    const context = ++refundContext.current;
    setLoading(false); setError(undefined);
    applyRefundInContext(value, context);
  }
  async function loadRefund(id = lookupId) {
    if (!id.trim()) return;
    const context = ++refundContext.current;
    setLoading(true); setError(undefined);
    setBudget(undefined);
    try { applyRefundInContext(await service.getRefund(id.trim()), context); }
    catch (cause) { if (refundContext.current === context) { setBudget(undefined); setError(cause); } }
    finally { if (refundContext.current === context) setLoading(false); }
  }
  useEffect(() => { if (initialId) void loadRefund(initialId); }, [initialId]);
  useEffect(() => { void service.getReferenceEnvironment().then((value) => { const configured = value as ReferenceEnvironment & { paymentMethod?: string }; setRequest((old) => ({ ...old, merchantId: value.merchantId })); setAttempt((old) => ({ ...old, paymentMethod: configured.paymentMethod ?? old.paymentMethod })); setResult((old) => ({ ...old, channelId: value.channelId })); }).catch(setError); }, [service]);

  async function run(command: BusinessCommand, label: string, id?: string): Promise<boolean> {
    setError(undefined); setNotice(`${label}已提交，正在观察 Operation。`);
    try {
      const observed = await execution.run<Refund>(command);
      if (observed.resource) applyRefund(observed.resource);
      else if (id) await loadRefund(id);
      setRefreshKey((value) => value + 1);
      setRetryCommand(undefined);
      setNotice(observed.timedOut ? `${label}已受理但观察暂未收敛。` : `${label}已受理，Operation 为 ${observed.operation.status}。`);
      return Boolean(observed.resource) && !observed.timedOut && observed.operation.status !== "FAILED";
    } catch (cause) { setError(cause); setRetryCommand({ command, label, resourceId: id }); return false; }
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (await run({ type: "REQUEST_REFUND", input: { merchantId: request.merchantId.trim(), paymentId: request.paymentId.trim(), merchantRefundId: request.merchantRefundId.trim(), idempotencyKey: request.idempotencyKey.trim(), money: createMoney(request.currency, decimalToMinor(request.amount, request.currency)), reason: request.reason.trim() } }, "退款申请")) setRequest(requestDefaults());
  }

  async function continueObservation() {
    setError(undefined); setNotice("正在使用同一 Operation ID 继续观察。");
    try {
      const observed = await execution.resume<Refund>();
      if (observed.resource) applyRefund(observed.resource);
      else if (refund) await loadRefund(refund.refundId);
      setNotice(observed.timedOut ? "Operation 仍未在本次窗口内收敛，可稍后再次继续观察。" : `Operation 已收敛为 ${observed.operation.status}。`);
    } catch (cause) { setError(cause); }
  }

  const executable = (kind: Parameters<typeof canExecute>[1]) => canExecute(refund?.actions, kind);
  return <div className="page-stack"><SectionHeader title="退款" description="申请只创建退款并预占预算；attempt、提交和渠道结果是分开的业务步骤。" />
    <div className="two-column-layout"><section className="panel"><h3><Undo2 size={18} />申请部分退款</h3><form className="form-grid" onSubmit={submitRequest}>
      <label><span>商户</span><input required value={request.merchantId} onChange={(e) => setRequest({ ...request, merchantId: e.target.value })} /></label><label><span>来源支付 ID</span><input required value={request.paymentId} onChange={(e) => setRequest({ ...request, paymentId: e.target.value })} /></label>
      <label><span>商户退款号</span><input required value={request.merchantRefundId} onChange={(e) => setRequest({ ...request, merchantRefundId: e.target.value })} /></label><label><span>退款金额</span><input required inputMode="decimal" value={request.amount} onChange={(e) => setRequest({ ...request, amount: e.target.value })} /></label>
      <label><span>币种</span><select value={request.currency} onChange={(e) => setRequest({ ...request, currency: e.target.value })}><option>CNY</option></select></label><label><span>原因</span><input required value={request.reason} onChange={(e) => setRequest({ ...request, reason: e.target.value })} /></label>
      <label className="span-2"><span>幂等键</span><input required value={request.idempotencyKey} onChange={(e) => setRequest({ ...request, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={execution.busy} type="submit">申请并预占退款预算</button>
    </form></section><section className="panel"><h3><Search size={18} />按稳定 ID 查询</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void loadRefund(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Refund ID" /><button className="button" type="submit"><Search size={16} />查询</button></form><InlineNotice>退款成功将预占转换为成功金额；明确整体失败才释放，UNKNOWN/人工核对继续占用。</InlineNotice></section></div>
    {notice ? <InlineNotice tone={execution.timedOut ? "warning" : "info"}>{notice}</InlineNotice> : null}{error ? <ErrorBlock error={error} onRetry={retryCommand ? () => void run(retryCommand.command, retryCommand.label, retryCommand.resourceId) : refund ? () => void loadRefund(refund.refundId) : undefined} /> : null}{loading || execution.busy ? <LoadingBlock label={execution.busy ? "正在观察命令结果" : undefined} /> : null}
    <CommandFeedback receipt={execution.receipt} operation={execution.operation} timedOut={execution.timedOut} observationError={execution.observationError} onContinue={() => void continueObservation()} busy={execution.busy} />
    <AuthoritativeList title="退款权威列表" description="opaque cursor 翻页保持同一筛选快照语义。" loadPage={(page) => service.listRefunds(page)} itemKey={(item) => item.refundId} specificFilters={[{ key: "paymentId", label: "来源支付 ID" }, { key: "merchantRefundId", label: "商户退款号" }]} columns={["退款", "支付", "金额", "状态", "最终性", "申请时间", ""]} onOpen={applyRefund} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.refundId}</code></td><td><code>{item.paymentId}</code></td><td>{formatMoney(item.money)}</td><td><StatusBadge status={item.status} /></td><td><StatusBadge status={item.finality} /></td><td>{formatTime(item.requestedAt)}</td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {refund ? <><section className="detail-heading"><div><span>退款详情</span><h2 className="mono-title">{refund.refundId}</h2></div><div><StatusBadge status={refund.status} /><StatusBadge status={refund.finality} /><button className="icon-button" type="button" title="刷新" onClick={() => void loadRefund(refund.refundId)}><RefreshCw size={16} /></button></div></section>
      <section className="detail-band"><DefinitionList items={[{ label: "商户退款号", value: refund.merchantRefundId }, { label: "来源支付", value: <code>{refund.paymentId}</code> }, { label: "商户", value: refund.merchantId }, { label: "金额", value: formatMoney(refund.money) }, { label: "原因", value: refund.reason ?? "—" }, { label: "预算占用", value: refund.reservationActive == null ? "未知" : refund.reservationActive ? "占用中" : "已释放或转成功" }, { label: "人工核对", value: refund.reviewIds.length ? refund.reviewIds.map((id) => <code key={id}>{id} </code>) : "—" }, { label: "申请时间", value: formatTime(refund.requestedAt) }, { label: "完成时间", value: formatTime(refund.finalizedAt) }]} />{budget ? <div className="money-summary"><div><span>原支付</span><strong>{formatMoney(budget.originalAmount)}</strong></div><div><span>成功退款</span><strong>{formatMoney(budget.succeededAmount)}</strong></div><div><span>预占</span><strong>{formatMoney(budget.reservedAmount)}</strong></div><div><span>可退款</span><strong>{formatMoney(budget.availableAmount)}</strong></div></div> : <InlineNotice tone="warning">尚未读到来源支付的权威退款预算。</InlineNotice>}<SourceDetails source={refund.source} /></section>
      <section><SectionHeader title="RefundAttempt 与收件" /><div className="timeline-list">{refund.attempts.length === 0 ? <EmptyBlock title="尚无退款 attempt" /> : refund.attempts.map((item) => <article className="timeline-item" key={item.attemptId}><div className="timeline-item__icon"><Activity size={16} /></div><div><div className="item-title"><code>{item.attemptId}</code><StatusBadge status={item.status} /></div><p>{item.channelId} · {item.externalTransactionId ?? "无渠道退款号"}</p><span>{formatTime(item.createdAt)} · {item.submissions.length} 次提交 · {item.receipts.length} 个结果收件</span>{item.submissions.map((submissionReceipt) => <div className="receipt-row" key={`submission:${submissionReceipt.submissionId}`}><code>{submissionReceipt.submissionId}</code><span>{submissionReceipt.outcome ?? "已提交"}</span><span>{submissionReceipt.channelReference ?? formatTime(submissionReceipt.submittedAt)}</span></div>)}{item.receipts.map((receipt) => <div className="receipt-row" key={`result:${receipt.receiptId}`}><code>{receipt.resultIdentity}</code><span>{receipt.disposition ?? receipt.outcome ?? "已记录"}</span><span>{receipt.summary ?? formatTime(receipt.recordedAt)}</span></div>)}</div></article>)}</div></section>
      <section><SectionHeader title="推进退款流程" /><div className="two-column-layout">
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(refund.actions, "CREATE_REFUND_ATTEMPT"))) return; void run({ type: "CREATE_REFUND_ATTEMPT", input: { resourceId: refund.refundId, attemptId: attempt.attemptId || undefined, idempotencyKey: attempt.idempotencyKey, paymentMethod: attempt.paymentMethod, riskReason: attempt.riskReason || undefined } }, "创建退款 attempt", refund.refundId); }}><h3 className="span-2"><Play size={16} />创建 attempt</h3><label><span>Attempt ID（可选）</span><input value={attempt.attemptId} onChange={(e) => setAttempt({ ...attempt, attemptId: e.target.value })} /></label><label><span>支付方式</span><input value={attempt.paymentMethod} onChange={(e) => setAttempt({ ...attempt, paymentMethod: e.target.value })} /></label><label><span>幂等键</span><input required value={attempt.idempotencyKey} onChange={(e) => setAttempt({ ...attempt, idempotencyKey: e.target.value })} /></label><label><span>风控原因</span><input value={attempt.riskReason} onChange={(e) => setAttempt({ ...attempt, riskReason: e.target.value })} /></label><button className="button button--primary span-2" disabled={!executable("CREATE_REFUND_ATTEMPT") || execution.busy} type="submit">创建 attempt</button></form>
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(refund.actions, "SUBMIT_REFUND_ATTEMPT"))) return; void run({ type: "SUBMIT_REFUND_ATTEMPT", input: { resourceId: refund.refundId, attemptId: submission.attemptId, submissionId: submission.submissionId || undefined, idempotencyKey: submission.idempotencyKey } }, "提交退款 attempt", refund.refundId); }}><h3 className="span-2"><Send size={16} />提交 attempt</h3><label className="span-2"><span>Attempt</span><select required value={submission.attemptId} onChange={(e) => setSubmission({ ...submission, attemptId: e.target.value })}><option value="">请选择</option>{refund.attempts.map((item) => <option key={item.attemptId}>{item.attemptId}</option>)}</select></label><label><span>Submission ID</span><input value={submission.submissionId} onChange={(e) => setSubmission({ ...submission, submissionId: e.target.value })} /></label><label><span>幂等键</span><input required value={submission.idempotencyKey} onChange={(e) => setSubmission({ ...submission, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={!executable("SUBMIT_REFUND_ATTEMPT") || execution.busy} type="submit">提交 attempt</button></form>
      </div></section>
      <section className="panel action-form"><h3><Send size={16} />Reference 退款结果</h3><InlineNotice>退款已终态时仍可通过统一 action 提交 duplicate、late 或 conflicting 收件，用于验证成功事实与预算不会被迟到失败回退。</InlineNotice><form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(refund.actions, "RECEIVE_REFUND_RESULT"), "提交退款渠道结果")) return; void run({ type: "RECEIVE_REFUND_RESULT", input: { resourceType: "REFUND", resourceId: refund.refundId, attemptId: result.attemptId, channelId: result.channelId, resultIdentity: result.resultIdentity, externalTransactionId: result.externalTransactionId, money: refund.money, outcome: result.outcome, occurredAt: result.occurredAt, failureDisposition: result.failureDisposition || undefined } }, "退款渠道结果", refund.refundId); }}>
        <label><span>Attempt（可输入未知引用做异常实验）</span><input required list="refund-result-attempts" value={result.attemptId} onChange={(e) => { const selected = refund.attempts.find((item) => item.attemptId === e.target.value); setResult({ ...result, attemptId: e.target.value, externalTransactionId: selected?.externalTransactionId ?? result.externalTransactionId, channelId: selected?.channelId ?? result.channelId }); }} /><datalist id="refund-result-attempts">{refund.attempts.map((item) => <option key={item.attemptId} value={item.attemptId} />)}</datalist></label><label><span>结果</span><select value={result.outcome} onChange={(e) => setResult({ ...result, outcome: e.target.value as ChannelOutcome })}><option>SUCCESS</option><option>FAILURE</option><option>UNKNOWN</option></select></label>
        <label><span>渠道</span><input required value={result.channelId} onChange={(e) => setResult({ ...result, channelId: e.target.value })} /></label><label><span>Result identity</span><input required value={result.resultIdentity} onChange={(e) => setResult({ ...result, resultIdentity: e.target.value })} /></label><label><span>渠道退款号（由已提交 attempt 预填）</span><input required value={result.externalTransactionId} onChange={(e) => setResult({ ...result, externalTransactionId: e.target.value })} /></label><label><span>发生时间</span><input required value={result.occurredAt} onChange={(e) => setResult({ ...result, occurredAt: e.target.value })} /></label><label className="span-2"><span>失败处置（仅 FAILURE）</span><input value={result.failureDisposition} onChange={(e) => setResult({ ...result, failureDisposition: e.target.value })} /></label><div className="span-2"><InlineNotice tone="warning">正常结果应沿用 attempt 的渠道退款号；仅在 Reference Lab 异常场景中显式覆盖。</InlineNotice></div><button className="button button--danger span-2" disabled={!executable("RECEIVE_REFUND_RESULT") || execution.busy} type="submit">提交可信退款结果</button>
      </form></section>
    </> : null}
  </div>;
}
