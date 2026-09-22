import { FormEvent, useEffect, useState } from "react";
import { Activity, Clock3, CreditCard, FileClock, Plus, RefreshCw, Search, Send, Undo2 } from "lucide-react";
import { createMoney, decimalToMinor } from "../../domain/money";
import type { ActionKind, Payment, PaymentTrace, RecentRecord, Refund } from "../../domain/models";
import { resolvePaymentReceipt, resolveRefundReceipt, type PaymentWorkbenchService } from "../../services/workbench-service";
import { actionDefault, confirmAction, findAction, receiptNotice, requiresField } from "../action-utils";
import { DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, RecentLink, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { formatMoney, formatTime } from "../format";

interface Props {
  service: PaymentWorkbenchService;
  recent: RecentRecord[];
  initialId?: string;
  onRemember: (record: Omit<RecentRecord, "accessedAt" | "backendId">) => void;
  onOpenRefund: (refundId: string) => void;
}

const token = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function PaymentsPage({ service, recent, initialId, onRemember, onOpenRefund }: Props) {
  const [lookupId, setLookupId] = useState(initialId ?? "");
  const [payment, setPayment] = useState<Payment>();
  const [trace, setTrace] = useState<PaymentTrace>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [openForm, setOpenForm] = useState<"result" | "refund" | "review" | null>(null);
  const [create, setCreate] = useState({ merchantId: "reference-merchant", merchantOrderNo: token("order"), idempotencyKey: token("idem"), amount: "100.00", currency: "CNY", paymentMethod: "DEFAULT", expiresAt: "" });
  const [result, setResult] = useState({ result: "SUCCEEDED", channel: "", attemptId: "", notificationId: token("notice"), channelTransactionId: token("channel-txn") });
  const [refund, setRefund] = useState({ merchantRefundNo: token("refund"), idempotencyKey: token("refund-idem"), amount: "20.00", reason: "商户退款", initialResult: "SUCCEEDED" });
  const [review, setReview] = useState({ reviewId: "", decisionIdentity: token("decision"), decision: "ACCEPT_LATE_SUCCESS", operatorIdentity: "operator-001", operatorRole: "PLATFORM_OPERATOR", authorizationMaterial: "reference-authorized", reason: "依据渠道证据完成复核", evidence: "reference channel evidence", eligibilityImpact: "RESTORE" });

  useEffect(() => { if (initialId && initialId !== payment?.id) { setLookupId(initialId); void loadPayment(initialId); } }, [initialId]);

  function applyPayment(value: Payment) {
    const resultAction = findAction(value.actions, "SUBMIT_PAYMENT_RESULT");
    const refundAction = findAction(value.actions, "CREATE_REFUND");
    setPayment(value); setLookupId(value.id);
    setResult((current) => ({ ...current, attemptId: value.attempts[0]?.id ?? current.attemptId, channel: actionDefault(resultAction, "channel") ?? current.channel }));
    setRefund((current) => ({ ...current, initialResult: actionDefault(refundAction, "initialResult") ?? current.initialResult }));
    setReview((current) => ({ ...current, reviewId: value.reviewIds[0] ?? current.reviewId }));
    onRemember({ resourceType: "payment", id: value.id, label: value.merchantOrderNo || "支付", status: value.status });
  }

  function rememberRefund(value: Refund) {
    onRemember({ resourceType: "refund", id: value.id, label: value.merchantRefundNo || "退款", status: value.status });
  }

  async function loadPayment(id = lookupId, clearNotice = true) {
    if (!id.trim()) return;
    setLoading(true); setError(undefined); if (clearNotice) setNotice(undefined); setTrace(undefined);
    try {
      const value = await service.getPayment(id.trim());
      applyPayment(value);
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(undefined); setNotice(undefined);
    try {
      const receipt = await service.createPayment({
        merchantId: create.merchantId.trim(), merchantOrderNo: create.merchantOrderNo.trim(), idempotencyKey: create.idempotencyKey.trim(),
        amount: createMoney(create.currency, decimalToMinor(create.amount, create.currency)), paymentMethod: create.paymentMethod.trim(),
        expiresAt: create.expiresAt ? new Date(create.expiresAt).toISOString() : undefined,
      });
      setLookupId(receipt.resourceId);
      setNotice(receipt.reused ? "命中幂等请求，正在读取原支付。" : "支付意图已受理，正在等待读模型可见。");
      const resolution = await resolvePaymentReceipt(service, receipt, { isReady: () => true });
      if (resolution.resource) applyPayment(resolution.resource);
      setNotice(receipt.reused ? "已返回原支付，未重复创建。" : receiptNotice(resolution.settled, resolution.resource?.status));
      setCreate((value) => ({ ...value, merchantOrderNo: token("order"), idempotencyKey: token("idem") }));
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function perform(kind: ActionKind) {
    if (!payment) return;
    const descriptor = findAction(payment.actions, kind);
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined); setNotice(undefined);
    try {
      if (kind === "GET_PAYMENT_TRACE") {
        const value = await service.getPaymentTrace(payment.id); setTrace(value); setNotice(value.partial ? "当前后端仅提供局部轨迹。" : "已读取完整业务轨迹。"); setLoading(false); return;
      }
      const beforeAttempts = payment.attempts.length;
      const receipt = kind === "START_PAYMENT_ATTEMPT"
        ? await service.startPaymentAttempt(payment.id)
        : kind === "EXPIRE_PAYMENT"
          ? await service.expirePayment(payment.id)
          : await service.executeAction({ kind, resourceId: payment.id, payload: { ...review, decidedAt: new Date().toISOString(), remediationReference: null } });
      setNotice("操作已受理，正在读取最新业务状态。");
      const resolution = await resolvePaymentReceipt(service, receipt, {
        isReady: kind === "START_PAYMENT_ATTEMPT"
          ? (value) => value.attempts.length > beforeAttempts
          : kind === "EXPIRE_PAYMENT"
            ? (value) => value.status === "CLOSED"
            : undefined,
      });
      if (resolution.resource) applyPayment(resolution.resource);
      setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function submitResult(event: FormEvent) {
    event.preventDefault(); if (!payment) return;
    const descriptor = findAction(payment.actions, "SUBMIT_PAYMENT_RESULT");
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined);
    try {
      const receipt = await service.submitPaymentResult({ paymentId: payment.id, attemptId: result.attemptId, notificationId: result.notificationId, channel: result.channel, channelTransactionId: result.channelTransactionId, amount: payment.amount, result: result.result as "SUCCEEDED" | "FAILED" | "UNKNOWN", verified: true });
      setNotice("渠道结果已受理，正在等待支付状态收敛。");
      const resolution = await resolvePaymentReceipt(service, receipt, { isReady: (value) => ["SUCCEEDED", "FAILED", "CLOSED", "PENDING_CONFIRMATION"].includes(value.status) });
      if (resolution.resource) applyPayment(resolution.resource);
      setOpenForm(null); setResult((value) => ({ ...value, notificationId: token("notice"), channelTransactionId: token("channel-txn") }));
      setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  async function submitRefund(event: FormEvent) {
    event.preventDefault(); if (!payment) return;
    const descriptor = findAction(payment.actions, "CREATE_REFUND");
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined);
    try {
      const hasInitialResult = requiresField(descriptor, "initialResult");
      const receipt = await service.createRefund({ paymentId: payment.id, merchantId: payment.merchantId, merchantRefundNo: refund.merchantRefundNo, idempotencyKey: refund.idempotencyKey, amount: createMoney(payment.amount.currency, decimalToMinor(refund.amount, payment.amount.currency)), reason: refund.reason, initialResult: hasInitialResult ? refund.initialResult as "SUCCEEDED" | "FAILED" | "UNKNOWN" : undefined });
      onRemember({ resourceType: "refund", id: receipt.resourceId, label: refund.merchantRefundNo, status: receipt.sourceStatus ?? undefined });
      setNotice(`退款已受理：${receipt.resourceId}，正在读取退款状态。`);
      const resolution = await resolveRefundReceipt(service, receipt, {
        isReady: hasInitialResult ? (value) => ["SUCCEEDED", "FAILED", "PENDING_CONFIRMATION"].includes(value.status) : () => true,
      });
      if (resolution.resource) rememberRefund(resolution.resource);
      setOpenForm(null); setRefund((value) => ({ ...value, merchantRefundNo: token("refund"), idempotencyKey: token("refund-idem") }));
      const updatedPayment = await service.getPayment(payment.id); applyPayment(updatedPayment);
      setNotice(`退款 ${receipt.resourceId}：${receiptNotice(resolution.settled, resolution.resource?.status)}`);
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  const executable = (kind: ActionKind) => payment?.actions.find((item) => item.kind === kind && item.executable);

  return (
    <div className="page-stack">
      <SectionHeader title="支付受理" description="创建收款意图，观察支付尝试与渠道结果。" />
      <div className="two-column-layout">
        <section className="panel">
          <h3><Plus size={18} /> 创建支付</h3>
          <form className="form-grid" onSubmit={submitCreate}>
            <label><span>商户</span><input value={create.merchantId} onChange={(e) => setCreate({ ...create, merchantId: e.target.value })} required /></label>
            <label><span>商户订单号</span><input value={create.merchantOrderNo} onChange={(e) => setCreate({ ...create, merchantOrderNo: e.target.value })} required /></label>
            <label className="span-2"><span>幂等键</span><input value={create.idempotencyKey} onChange={(e) => setCreate({ ...create, idempotencyKey: e.target.value })} required /></label>
            <label><span>金额</span><input inputMode="decimal" value={create.amount} onChange={(e) => setCreate({ ...create, amount: e.target.value })} required /></label>
            <label><span>币种</span><select value={create.currency} onChange={(e) => setCreate({ ...create, currency: e.target.value })}><option>CNY</option></select></label>
            <label><span>支付方式</span><input value={create.paymentMethod} onChange={(e) => setCreate({ ...create, paymentMethod: e.target.value })} required /></label>
            <label><span>到期时间</span><input type="datetime-local" value={create.expiresAt} onChange={(e) => setCreate({ ...create, expiresAt: e.target.value })} /></label>
            <button className="button button--primary span-2" type="submit" disabled={loading}><CreditCard size={17} />创建支付意图</button>
          </form>
        </section>
        <section className="panel">
          <h3><Search size={18} /> 按支付号查询</h3>
          <form className="lookup-form" onSubmit={(event) => { event.preventDefault(); void loadPayment(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Payment ID" /><button className="button" type="submit" disabled={loading}><Search size={17} />查询</button></form>
          <div className="compact-recent"><span>本地最近记录（非后端全量）</span>{recent.slice(0, 4).map((item) => <RecentLink key={item.id} label={item.label} id={item.id} status={item.status} onOpen={() => { setLookupId(item.id); void loadPayment(item.id); }} />)}</div>
        </section>
      </div>

      {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
      {error ? <ErrorBlock error={error} onRetry={payment ? () => void loadPayment(payment.id) : undefined} /> : null}
      {loading ? <LoadingBlock /> : null}
      {!loading && !payment ? <EmptyBlock title="尚未选择支付" detail="创建支付或按支付号查询。" /> : null}
      {payment ? <>
        <section className="detail-heading"><div><span>支付详情</span><h2 className="mono-title">{payment.id}</h2></div><div><StatusBadge status={payment.status} /><button className="icon-button" type="button" title="刷新" onClick={() => void loadPayment(payment.id)}><RefreshCw size={17} /></button></div></section>
        <section className="detail-band">
          <DefinitionList items={[
            { label: "商户", value: payment.merchantId }, { label: "商户订单号", value: payment.merchantOrderNo }, { label: "金额", value: formatMoney(payment.amount) },
            { label: "支付方式", value: payment.paymentMethod }, { label: "创建时间", value: formatTime(payment.createdAt) }, { label: "到期时间", value: formatTime(payment.expiresAt) },
            { label: "渠道交易号", value: <code>{payment.channelTransactionId ?? "—"}</code> }, { label: "结算资格", value: payment.settlementEligible == null ? "未知" : payment.settlementEligible ? "可结算" : "不可结算" },
          ]} />
          <div className="money-summary"><div><span>支付金额</span><strong>{formatMoney(payment.amount)}</strong></div><div><span>已成功退款</span><strong>{formatMoney(payment.refundSummary.successful)}</strong></div><div><span>处理中占用</span><strong>{formatMoney(payment.refundSummary.reserved)}</strong></div><div><span>可退款</span><strong>{formatMoney(payment.refundSummary.refundable)}</strong></div></div>
          <SourceDetails source={payment.source} />
        </section>

        <section><SectionHeader title="支付尝试与回执" description={`${payment.attempts.length} 次尝试`} />
          <div className="timeline-list">{payment.attempts.length === 0 ? <EmptyBlock title="暂无支付尝试" /> : payment.attempts.map((attempt) => <article className="timeline-item" key={attempt.id}><div className="timeline-item__icon"><Activity size={17} /></div><div><div className="item-title"><code>{attempt.id}</code><StatusBadge status={attempt.status} /></div><p>{attempt.channel} · {attempt.channelTransactionId ?? "尚无渠道交易号"}</p><span>{formatTime(attempt.initiatedAt)} · {attempt.receiptCount} 个回执</span>{attempt.receipts.map((receipt) => <div className="receipt-row" key={receipt.id}><code>{receipt.id}</code><span>{receipt.disposition ?? receipt.result ?? "已记录"}</span><span>{receipt.summary ?? "—"}</span></div>)}</div></article>)}</div>
        </section>

        <section><SectionHeader title="当前可执行动作" description="动作来自统一业务对象的能力声明。" />
          <div className="action-grid">{payment.actions.map((item) => <div className={`action-item ${item.executable ? "" : "action-item--disabled"}`} key={item.kind}><div><strong>{item.label}</strong><span>{item.executable ? "当前可执行" : item.reason}</span></div>{item.executable ? <button className="button button--small" type="button" onClick={() => { if (item.kind === "SUBMIT_PAYMENT_RESULT") setOpenForm("result"); else if (item.kind === "CREATE_REFUND") setOpenForm("refund"); else if (item.kind === "ADJUDICATE_PAYMENT") setOpenForm("review"); else void perform(item.kind); }}>{item.kind === "GET_PAYMENT_TRACE" ? <FileClock size={15} /> : item.kind === "CREATE_REFUND" ? <Undo2 size={15} /> : <Send size={15} />}{item.label}</button> : null}</div>)}</div>
        </section>

        {openForm === "result" && executable("SUBMIT_PAYMENT_RESULT") ? <section className="panel action-form"><h3>提交渠道支付结果</h3><form className="form-grid" onSubmit={submitResult}>
          <label><span>支付尝试</span><select value={result.attemptId} onChange={(e) => setResult({ ...result, attemptId: e.target.value })}>{payment.attempts.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
          <label><span>结果</span><select value={result.result} onChange={(e) => setResult({ ...result, result: e.target.value })}><option value="SUCCEEDED">成功</option><option value="FAILED">失败</option><option value="UNKNOWN">未知</option></select></label>
          <label><span>渠道</span><input value={result.channel} onChange={(e) => setResult({ ...result, channel: e.target.value })} required /></label><label><span>通知号</span><input value={result.notificationId} onChange={(e) => setResult({ ...result, notificationId: e.target.value })} required /></label>
          <label className="span-2"><span>渠道交易号</span><input value={result.channelTransactionId} onChange={(e) => setResult({ ...result, channelTransactionId: e.target.value })} required /></label><div className="form-actions span-2"><button className="button" type="button" onClick={() => setOpenForm(null)}>取消</button><button className="button button--danger" type="submit"><Send size={16} />提交渠道结果</button></div>
        </form></section> : null}

        {openForm === "refund" && executable("CREATE_REFUND") ? <section className="panel action-form"><h3>创建退款</h3><form className="form-grid" onSubmit={submitRefund}>
          <label><span>商户退款号</span><input value={refund.merchantRefundNo} onChange={(e) => setRefund({ ...refund, merchantRefundNo: e.target.value })} required /></label><label><span>退款金额</span><input inputMode="decimal" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} required /></label>
          <label><span>幂等键</span><input value={refund.idempotencyKey} onChange={(e) => setRefund({ ...refund, idempotencyKey: e.target.value })} /></label><label><span>原因</span><input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></label>
          {requiresField(executable("CREATE_REFUND"), "initialResult") ? <label className="span-2"><span>Reference 结果</span><select value={refund.initialResult} onChange={(e) => setRefund({ ...refund, initialResult: e.target.value })}><option value="SUCCEEDED">成功</option><option value="FAILED">失败</option><option value="UNKNOWN">未知</option></select></label> : null}
          <div className="form-actions span-2"><button className="button" type="button" onClick={() => setOpenForm(null)}>取消</button><button className="button button--danger" type="submit"><Undo2 size={16} />提交退款</button></div>
        </form></section> : null}

        {openForm === "review" && executable("ADJUDICATE_PAYMENT") ? <section className="panel action-form"><h3>裁决支付复核</h3><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void perform("ADJUDICATE_PAYMENT"); setOpenForm(null); }}>
          <label><span>复核标识</span><input value={review.reviewId} onChange={(e) => setReview({ ...review, reviewId: e.target.value })} required /></label><label><span>裁决</span><select value={review.decision} onChange={(e) => setReview({ ...review, decision: e.target.value })}><option>ACCEPT_LATE_SUCCESS</option><option>CONFIRM_FAILURE</option><option>KEEP_ACCEPTED_SUCCESS_WITH_REMEDIATION</option></select></label>
          <label><span>操作员</span><input value={review.operatorIdentity} onChange={(e) => setReview({ ...review, operatorIdentity: e.target.value })} required /></label><label><span>角色</span><input value={review.operatorRole} onChange={(e) => setReview({ ...review, operatorRole: e.target.value })} required /></label>
          <label><span>原因</span><input value={review.reason} onChange={(e) => setReview({ ...review, reason: e.target.value })} required /></label><label><span>证据</span><input value={review.evidence} onChange={(e) => setReview({ ...review, evidence: e.target.value })} required /></label>
          <div className="form-actions span-2"><button className="button" type="button" onClick={() => setOpenForm(null)}>取消</button><button className="button button--danger" type="submit">确认裁决</button></div>
        </form></section> : null}

        {trace ? <section><SectionHeader title="业务轨迹" description={trace.partial ? "当前后端提供局部轨迹" : "完整支付关联轨迹"} /><div className="trace-summary"><div><Clock3 /><span>退款</span><strong>{trace.refunds.length}</strong></div><div><Clock3 /><span>对账</span><strong>{trace.reconciliations.length}</strong></div><div><Clock3 /><span>结算</span><strong>{trace.settlements.length}</strong></div><div><Clock3 /><span>通知</span><strong>{trace.notifications.length}</strong></div></div>{trace.refunds.map((item) => <button className="trace-link" type="button" key={item.id} onClick={() => onOpenRefund(item.id)}><StatusBadge status={item.status} /><code>{item.id}</code><span>{formatMoney(item.amount)}</span></button>)}</section> : null}
      </> : null}
    </div>
  );
}
