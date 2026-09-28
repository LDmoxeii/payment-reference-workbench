import { type FormEvent, useEffect, useState } from "react";
import { Activity, Clock3, CreditCard, Play, RefreshCw, Search, Send } from "lucide-react";
import { createMoney, decimalToMinor } from "../../domain/money";
import type { BusinessCommand, ChannelOutcome, MerchantNotification, Operation, Payment, PaymentTimeline, ReferenceEnvironment } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { canExecute, confirmAction, findAction, token } from "../action-utils";
import { AuthoritativeList } from "../AuthoritativeList";
import { CommandFeedback, DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { evidenceLabel, formatMoney, formatTime } from "../format";
import { useCommandExecution } from "../useCommandExecution";

const defaults = () => ({ merchantId: "reference-merchant", merchantOrderId: token("order"), idempotencyKey: token("pay"), amount: "100.00", currency: "CNY", paymentMethod: "DEFAULT", expiresAt: "" });
type RetryCommand = { command: BusinessCommand; label: string; resourceId?: string };

export async function loadCompletePaymentTimeline(service: PaymentWorkbenchService, paymentId: string, pageSize = 50): Promise<PaymentTimeline> {
  let cursor: string | undefined;
  let timeline: PaymentTimeline | undefined;
  const entries: PaymentTimeline["entries"] = [];
  const seenCursors = new Set<string>();
  do {
    const page = await service.getPaymentTimeline(paymentId, { pageSize, cursor });
    timeline = page;
    entries.push(...page.entries);
    const nextCursor = page.nextCursor ?? undefined;
    if (nextCursor && seenCursors.has(nextCursor)) throw new Error("Payment Timeline 分页 cursor 未前进，已停止读取以避免重复数据。");
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  if (!timeline) throw new Error("Payment Timeline 未返回权威页面。");
  return { ...timeline, paymentId, entries, nextCursor: null, pageSize };
}

export function PaymentsPage({ service, initialId }: { service: PaymentWorkbenchService; initialId?: string }) {
  const execution = useCommandExecution(service);
  const [create, setCreate] = useState(defaults);
  const [payment, setPayment] = useState<Payment>();
  const [lookupId, setLookupId] = useState(initialId ?? "");
  const [timeline, setTimeline] = useState<PaymentTimeline>();
  const [notifications, setNotifications] = useState<MerchantNotification[]>();
  const [operationId, setOperationId] = useState("");
  const [inspectedOperation, setInspectedOperation] = useState<Operation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [retryCommand, setRetryCommand] = useState<RetryCommand>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [attempt, setAttempt] = useState({ attemptId: "", idempotencyKey: token("attempt"), paymentMethod: "DEFAULT", riskReason: "" });
  const [submission, setSubmission] = useState({ attemptId: "", submissionId: token("submission"), idempotencyKey: token("submit") });
  const [result, setResult] = useState({ attemptId: "", channelId: "", resultIdentity: token("result"), externalTransactionId: "", outcome: "SUCCESS" as ChannelOutcome, occurredAt: new Date().toISOString(), failureDisposition: "" });

  async function loadPayment(id = lookupId) {
    if (!id.trim()) return;
    setLoading(true); setError(undefined);
    try { const value = await service.getPayment(id.trim()); applyPayment(value); }
    catch (cause) { setError(cause); } finally { setLoading(false); }
  }
  function applyPayment(value: Payment) {
    setPayment(value); setLookupId(value.paymentId);
    const latest = value.attempts.at(-1);
    if (latest) { setSubmission((old) => ({ ...old, attemptId: latest.attemptId })); setResult((old) => ({ ...old, attemptId: latest.attemptId, externalTransactionId: latest.externalTransactionId ?? old.externalTransactionId, channelId: latest.channelId || old.channelId })); }
  }
  useEffect(() => { if (initialId) void loadPayment(initialId); }, [initialId]);
  useEffect(() => { void service.getReferenceEnvironment().then((value) => { const configured = value as ReferenceEnvironment & { paymentMethod?: string }; setCreate((old) => ({ ...old, merchantId: value.merchantId, paymentMethod: configured.paymentMethod ?? old.paymentMethod })); setAttempt((old) => ({ ...old, paymentMethod: configured.paymentMethod ?? old.paymentMethod })); setResult((old) => ({ ...old, channelId: value.channelId })); }).catch(setError); }, [service]);

  async function run(command: BusinessCommand, label: string, id?: string): Promise<boolean> {
    setError(undefined); setNotice(`${label}已提交，正在观察 Operation 与业务资源。`);
    try {
      const observed = await execution.run<Payment>(command);
      const target = id ?? observed.resource?.paymentId ?? execution.receipt?.resource?.resourceId;
      if (observed.resource) applyPayment(observed.resource);
      else if (target) await loadPayment(target);
      setRefreshKey((value) => value + 1);
      setRetryCommand(undefined);
      setNotice(observed.timedOut ? `${label}已受理，观察暂未收敛；这不是业务失败。` : `${label}已受理，Operation 为 ${observed.operation.status}。`);
      return Boolean(observed.resource) && !observed.timedOut && observed.operation.status !== "FAILED";
    } catch (cause) { setError(cause); setRetryCommand({ command, label, resourceId: id }); return false; }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    const input = { merchantId: create.merchantId.trim(), merchantOrderId: create.merchantOrderId.trim(), idempotencyKey: create.idempotencyKey.trim(), money: createMoney(create.currency, decimalToMinor(create.amount, create.currency)), paymentMethod: create.paymentMethod.trim(), expiresAt: create.expiresAt ? new Date(create.expiresAt).toISOString() : undefined };
    if (await run({ type: "CREATE_PAYMENT", input }, "支付意图创建")) setCreate(defaults());
  }

  async function loadTimeline() {
    if (!payment) return;
    setLoading(true); setError(undefined);
    try { setTimeline(await loadCompletePaymentTimeline(service, payment.paymentId)); }
    catch (cause) { setError(cause); } finally { setLoading(false); }
  }

  async function loadNotifications() {
    if (!payment) return;
    setLoading(true); setError(undefined);
    try {
      const page = await service.listNotifications({ filters: { merchantId: payment.merchantId, paymentId: payment.paymentId }, pageSize: 100 });
      setNotifications(page.items);
    } catch (cause) { setError(cause); } finally { setLoading(false); }
  }

  async function loadOperation() {
    if (!operationId.trim()) return;
    setLoading(true); setError(undefined);
    try { setInspectedOperation(await service.getOperation(operationId.trim())); }
    catch (cause) { setError(cause); } finally { setLoading(false); }
  }

  async function continueObservation() {
    setError(undefined); setNotice("正在使用同一 Operation ID 继续观察。");
    try {
      const observed = await execution.resume<Payment>();
      if (observed.resource) applyPayment(observed.resource);
      else if (payment) await loadPayment(payment.paymentId);
      setNotice(observed.timedOut ? "Operation 仍未在本次窗口内收敛，可稍后再次继续观察。" : `Operation 已收敛为 ${observed.operation.status}。`);
    } catch (cause) { setError(cause); }
  }

  const executeAllowed = (kind: Parameters<typeof canExecute>[1]) => canExecute(payment?.actions, kind);
  return <div className="page-stack">
    <SectionHeader title="支付" description="创建支付意图后，显式创建 attempt、提交 attempt，再由 reference 可信入口接收渠道结果。" />
    <div className="two-column-layout"><section className="panel"><h3><CreditCard size={18} />创建支付意图</h3><form className="form-grid" onSubmit={submitCreate}>
      <label><span>商户</span><input required value={create.merchantId} onChange={(e) => setCreate({ ...create, merchantId: e.target.value })} /></label><label><span>商户订单号</span><input required value={create.merchantOrderId} onChange={(e) => setCreate({ ...create, merchantOrderId: e.target.value })} /></label>
      <label><span>金额</span><input required inputMode="decimal" value={create.amount} onChange={(e) => setCreate({ ...create, amount: e.target.value })} /></label><label><span>币种</span><select value={create.currency} onChange={(e) => setCreate({ ...create, currency: e.target.value })}><option>CNY</option></select></label>
      <label><span>支付方式</span><input required value={create.paymentMethod} onChange={(e) => setCreate({ ...create, paymentMethod: e.target.value })} /></label><label><span>到期时间</span><input type="datetime-local" value={create.expiresAt} onChange={(e) => setCreate({ ...create, expiresAt: e.target.value })} /></label>
      <label className="span-2"><span>幂等键</span><input required value={create.idempotencyKey} onChange={(e) => setCreate({ ...create, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={execution.busy} type="submit">创建但不自动发起</button>
    </form></section><section className="panel"><h3><Search size={18} />按稳定 ID 查询</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void loadPayment(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Payment ID" /><button className="button" type="submit"><Search size={16} />查询</button></form><InlineNotice>HTTP 2xx 或 ACCEPTED 只表示命令受理；请继续观察 Operation 和支付状态。</InlineNotice></section></div>
    {notice ? <InlineNotice tone={execution.timedOut ? "warning" : "info"}>{notice}</InlineNotice> : null}{error ? <ErrorBlock error={error} onRetry={retryCommand ? () => void run(retryCommand.command, retryCommand.label, retryCommand.resourceId) : payment ? () => void loadPayment(payment.paymentId) : undefined} /> : null}{loading || execution.busy ? <LoadingBlock label={execution.busy ? "正在观察命令结果" : undefined} /> : null}
    <CommandFeedback receipt={execution.receipt} operation={execution.operation} timedOut={execution.timedOut} observationError={execution.observationError} onContinue={() => void continueObservation()} busy={execution.busy} />
    <AuthoritativeList title="支付权威列表" description="筛选与 opaque cursor 原样交给后端；不使用浏览器最近记录代替。" loadPage={(request) => service.listPayments(request)} itemKey={(item) => item.paymentId} specificFilters={[{ key: "merchantOrderId", label: "商户订单号" }]} columns={["支付", "商户订单", "金额", "状态", "最终性", "创建时间", ""]} onOpen={applyPayment} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.paymentId}</code></td><td>{item.merchantOrderId}</td><td>{formatMoney(item.money)}</td><td><StatusBadge status={item.status} /></td><td><StatusBadge status={item.finality} /></td><td>{formatTime(item.createdAt)}</td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {payment ? <><section className="detail-heading"><div><span>支付详情</span><h2 className="mono-title">{payment.paymentId}</h2></div><div><StatusBadge status={payment.status} /><StatusBadge status={payment.finality} /><button className="icon-button" type="button" onClick={() => void loadPayment(payment.paymentId)} title="刷新"><RefreshCw size={16} /></button></div></section>
      <section className="detail-band"><DefinitionList items={[{ label: "商户", value: payment.merchantId }, { label: "商户订单", value: payment.merchantOrderId }, { label: "金额", value: formatMoney(payment.money) }, { label: "支付方式", value: payment.paymentMethod }, { label: "成功事实", value: <code>{payment.successFactId ?? "—"}</code> }, { label: "外部交易", value: <code>{payment.externalTransactionId ?? "—"}</code> }, { label: "人工核对", value: payment.reviewIds.length ? payment.reviewIds.map((id) => <code key={id}>{id} </code>) : "—" }, { label: "创建", value: formatTime(payment.createdAt) }, { label: "到期", value: formatTime(payment.expiresAt) }]} />
      {payment.refundBudget ? <div className="money-summary"><div><span>原支付</span><strong>{formatMoney(payment.refundBudget.originalAmount)}</strong></div><div><span>成功退款</span><strong>{formatMoney(payment.refundBudget.succeededAmount)}</strong></div><div><span>预占</span><strong>{formatMoney(payment.refundBudget.reservedAmount)}</strong></div><div><span>可退款</span><strong>{formatMoney(payment.refundBudget.availableAmount)}</strong></div></div> : null}{payment.feeSnapshot !== undefined ? <details className="source-details"><summary>费用规则快照</summary><pre>{JSON.stringify(payment.feeSnapshot, null, 2)}</pre></details> : null}<SourceDetails source={payment.source} /></section>
      <section><SectionHeader title="Attempt 与收件" description="submission receipt 与 result receipt 分开保留。" /><div className="timeline-list">{payment.attempts.length === 0 ? <EmptyBlock title="尚无支付 attempt" /> : payment.attempts.map((item) => <article className="timeline-item" key={item.attemptId}><div className="timeline-item__icon"><Activity size={16} /></div><div><div className="item-title"><code>{item.attemptId}</code><StatusBadge status={item.status} /></div><p>{item.channelId} · {item.externalTransactionId ?? "无外部交易号"}</p><span>{formatTime(item.createdAt)} · {item.submissions.length} 次提交 · {item.receipts.length} 个结果收件</span>{item.submissions.map((submissionReceipt) => <div className="receipt-row" key={`submission:${submissionReceipt.submissionId}`}><code>{submissionReceipt.submissionId}</code><span>{submissionReceipt.outcome ?? "已提交"}</span><span>{submissionReceipt.channelReference ?? formatTime(submissionReceipt.submittedAt)}</span></div>)}{item.receipts.map((receipt) => <div className="receipt-row" key={`result:${receipt.receiptId}`}><code>{receipt.resultIdentity}</code><span>{receipt.disposition ?? receipt.outcome ?? "已记录"}</span><span>{receipt.summary ?? formatTime(receipt.recordedAt)}</span></div>)}</div></article>)}</div></section>
      <section><SectionHeader title="推进支付流程" description="按钮是否可执行仅来自统一资源 actions。" /><div className="two-column-layout">
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(payment.actions, "CREATE_PAYMENT_ATTEMPT"))) return; void run({ type: "CREATE_PAYMENT_ATTEMPT", input: { resourceId: payment.paymentId, attemptId: attempt.attemptId || undefined, idempotencyKey: attempt.idempotencyKey, paymentMethod: attempt.paymentMethod, riskReason: attempt.riskReason || undefined } }, "创建支付 attempt", payment.paymentId); }}><h3 className="span-2"><Play size={16} />创建 attempt</h3><label><span>Attempt ID（可选）</span><input value={attempt.attemptId} onChange={(e) => setAttempt({ ...attempt, attemptId: e.target.value })} /></label><label><span>支付方式</span><input value={attempt.paymentMethod} onChange={(e) => setAttempt({ ...attempt, paymentMethod: e.target.value })} /></label><label><span>幂等键</span><input required value={attempt.idempotencyKey} onChange={(e) => setAttempt({ ...attempt, idempotencyKey: e.target.value })} /></label><label><span>风控原因</span><input value={attempt.riskReason} onChange={(e) => setAttempt({ ...attempt, riskReason: e.target.value })} /></label><button className="button button--primary span-2" disabled={!executeAllowed("CREATE_PAYMENT_ATTEMPT") || execution.busy} type="submit">创建 attempt</button></form>
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(payment.actions, "SUBMIT_PAYMENT_ATTEMPT"))) return; void run({ type: "SUBMIT_PAYMENT_ATTEMPT", input: { resourceId: payment.paymentId, attemptId: submission.attemptId, submissionId: submission.submissionId || undefined, idempotencyKey: submission.idempotencyKey } }, "提交支付 attempt", payment.paymentId); }}><h3 className="span-2"><Send size={16} />提交 attempt</h3><label className="span-2"><span>Attempt</span><select required value={submission.attemptId} onChange={(e) => setSubmission({ ...submission, attemptId: e.target.value })}><option value="">请选择</option>{payment.attempts.map((item) => <option key={item.attemptId}>{item.attemptId}</option>)}</select></label><label><span>Submission ID</span><input value={submission.submissionId} onChange={(e) => setSubmission({ ...submission, submissionId: e.target.value })} /></label><label><span>幂等键</span><input required value={submission.idempotencyKey} onChange={(e) => setSubmission({ ...submission, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={!executeAllowed("SUBMIT_PAYMENT_ATTEMPT") || execution.busy} type="submit">提交 attempt</button></form>
      </div></section>
      <section className="panel action-form"><h3><Send size={16} />Reference 渠道结果</h3><InlineNotice>即使支付已经终态，统一 action 仍允许提交 duplicate、late 或 conflicting 可信收件；后端只追加裁决证据，不回退已确定事实。</InlineNotice><form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (!confirmAction(findAction(payment.actions, "RECEIVE_PAYMENT_RESULT"), "提交渠道支付结果")) return; void run({ type: "RECEIVE_PAYMENT_RESULT", input: { resourceType: "PAYMENT", resourceId: payment.paymentId, attemptId: result.attemptId, channelId: result.channelId, resultIdentity: result.resultIdentity, externalTransactionId: result.externalTransactionId, money: payment.money, outcome: result.outcome, occurredAt: result.occurredAt, failureDisposition: result.failureDisposition || undefined } }, "支付渠道结果", payment.paymentId); }}>
        <label><span>Attempt（可输入未知引用做异常实验）</span><input required list="payment-result-attempts" value={result.attemptId} onChange={(e) => { const selected = payment.attempts.find((item) => item.attemptId === e.target.value); setResult({ ...result, attemptId: e.target.value, externalTransactionId: selected?.externalTransactionId ?? result.externalTransactionId, channelId: selected?.channelId ?? result.channelId }); }} /><datalist id="payment-result-attempts">{payment.attempts.map((item) => <option key={item.attemptId} value={item.attemptId} />)}</datalist></label><label><span>结果</span><select value={result.outcome} onChange={(e) => setResult({ ...result, outcome: e.target.value as ChannelOutcome })}><option>SUCCESS</option><option>FAILURE</option><option>UNKNOWN</option></select></label>
        <label><span>渠道</span><input required value={result.channelId} onChange={(e) => setResult({ ...result, channelId: e.target.value })} /></label><label><span>Result identity</span><input required value={result.resultIdentity} onChange={(e) => setResult({ ...result, resultIdentity: e.target.value })} /></label><label><span>外部交易号（由已提交 attempt 预填）</span><input required value={result.externalTransactionId} onChange={(e) => setResult({ ...result, externalTransactionId: e.target.value })} /></label><label><span>发生时间</span><input required value={result.occurredAt} onChange={(e) => setResult({ ...result, occurredAt: e.target.value })} /></label><label className="span-2"><span>失败处置（仅 FAILURE）</span><input value={result.failureDisposition} onChange={(e) => setResult({ ...result, failureDisposition: e.target.value })} /></label><div className="span-2"><InlineNotice tone="warning">正常结果应保持 attempt 提交后读模型中的外部交易号；仅在复现 unknown-reference、invalid 或 conflict 时显式覆盖。</InlineNotice></div><button className="button button--danger span-2" disabled={!executeAllowed("RECEIVE_PAYMENT_RESULT") || execution.busy} type="submit">提交可信结果（不可编辑 verified）</button>
      </form></section>
      <section><SectionHeader title="其他动作与全链路 Timeline" /><div className="quick-actions"><button className="button" type="button" disabled={!executeAllowed("CLOSE_EXPIRED_PAYMENT") || execution.busy} onClick={() => { if (confirmAction(findAction(payment.actions, "CLOSE_EXPIRED_PAYMENT"))) void run({ type: "CLOSE_EXPIRED_PAYMENT", input: { paymentId: payment.paymentId } }, "关闭到期支付", payment.paymentId); }}>关闭到期支付</button><button className="button" type="button" onClick={() => void loadTimeline()}><Clock3 size={15} />读取 Timeline</button><button className="button" type="button" onClick={() => void loadNotifications()}><Send size={15} />读取关联通知</button></div></section>
      <section className="two-column-layout"><div className="panel"><h3>按 Operation ID 查询</h3><form className="lookup-form" onSubmit={(event) => { event.preventDefault(); void loadOperation(); }}><input value={operationId} onChange={(event) => setOperationId(event.target.value)} placeholder="Operation ID" /><button className="button" type="submit">查询</button></form>{inspectedOperation ? <DefinitionList items={[{ label: "Operation", value: <code>{inspectedOperation.operationId}</code> }, { label: "命令", value: inspectedOperation.commandType }, { label: "状态", value: <StatusBadge status={inspectedOperation.status} /> }, { label: "资源", value: inspectedOperation.resource ? `${inspectedOperation.resource.resourceType}:${inspectedOperation.resource.resourceId}` : "—" }, { label: "错误", value: inspectedOperation.error?.message ?? "—" }]} /> : <InlineNotice>可粘贴任一 receipt 的 operationId，重新读取后端权威 Operation。</InlineNotice>}</div><div className="panel"><h3>关联通知</h3>{notifications === undefined ? <InlineNotice>点击“读取关联通知”按当前 Payment 查询权威通知。</InlineNotice> : notifications.length === 0 ? <EmptyBlock title="当前支付暂无通知" /> : <div className="timeline-list">{notifications.map((notification) => <article className="timeline-item" key={notification.notificationId}><div className="timeline-item__icon"><Send size={16} /></div><div><div className="item-title"><code>{notification.notificationId}</code><StatusBadge status={notification.status} /></div><p>Content identity：<code>{notification.contentIdentity ?? "—"}</code></p><span>{notification.attempts.length} 次投递 · {formatTime(notification.createdAt)}</span></div></article>)}</div>}</div></section>
      {timeline ? <section><SectionHeader title="Payment Timeline" description={`已沿 opaque cursor 读取到末页，共 ${timeline.entries.length} 个事件；按服务端 recordedAt、eventId 稳定排序。`} /><div className="timeline-list">{timeline.entries.map((entry) => <article className="timeline-item" key={entry.eventId}><div className="timeline-item__icon"><Clock3 size={16} /></div><div><div className="item-title"><code>{entry.eventId}</code><StatusBadge status={entry.outcome} /></div><p>{entry.category} · {entry.summary ?? "—"}</p><span>业务发生 {formatTime(entry.occurredAt)} · 平台记录 {formatTime(entry.recordedAt)}</span><div className="receipt-row"><span>关联：{entry.relatedResourceRefs.map((item) => `${item.resourceType}:${item.resourceId}`).join(", ") || "—"}</span><span>责任：{entry.actorId ?? "—"}{entry.reason ? ` · ${entry.reason}` : ""}</span><span>证据：{entry.evidenceRefs.map(evidenceLabel).join(", ") || "—"}{entry.money ? ` · ${formatMoney(entry.money)}` : ""}</span></div></div></article>)}</div></section> : null}
    </> : null}
  </div>;
}
