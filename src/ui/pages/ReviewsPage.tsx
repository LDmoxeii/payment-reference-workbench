import { type FormEvent, useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { ManualReviewItem, MerchantNotification, ReferenceEnvironment } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { canExecute, confirmAction, findAction, token } from "../action-utils";
import { useConfirmationScope } from "../confirmation";
import { AuthoritativeList } from "../AuthoritativeList";
import { CommandFeedback, DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { evidenceLabel, formatTime } from "../format";
import { useCommandExecution } from "../useCommandExecution";

export function ReviewsPage({ service }: { service: PaymentWorkbenchService }) {
  const execution = useCommandExecution(service);
  const [review, setReview] = useState<ManualReviewItem>();
  const [notification, setNotification] = useState<MerchantNotification>();
  const confirmationScope = useConfirmationScope(review, service);
  const notificationConfirmationScope = useConfirmationScope(notification, service);
  const [reviewId, setReviewId] = useState("");
  const [notificationId, setNotificationId] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedReviewId = useRef("");
  const selectedNotificationId = useRef("");
  const reviewRequestSequence = useRef(0);
  const notificationRequestSequence = useRef(0);
  const lastCommandTarget = useRef<{ kind: "review" | "notification"; id: string } | undefined>(undefined);
  const [environment, setEnvironment] = useState<ReferenceEnvironment>();
  const [resolution, setResolution] = useState({ merchantId: "", outcome: "CONFIRM_SUCCESS", actorAlias: "fixture-reconciliation-operator", actorId: "reference-reconciliation-operator", actorRole: "RECONCILIATION_OPERATOR", reason: "依据完整证据完成核对", evidenceRefs: "reference:review-evidence", remediationReference: "reference:review-remediation", idempotencyKey: token("review-resolution") });
  const [notificationRetryKey, setNotificationRetryKey] = useState(() => token("notification-retry"));

  function actorAliasForReview(value: ManualReviewItem, reference = environment): string | undefined {
    const aliases = reference?.actorAliases;
    if (value.type.toUpperCase().includes("PAYMENT")) return aliases?.paymentReviewer;
    if (value.type.toUpperCase().includes("REFUND")) return aliases?.refundReviewer;
    if (value.type.toUpperCase().includes("SETTLEMENT")) return aliases?.settlementReviewer;
    return aliases?.reconciliationOperator;
  }
  useEffect(() => { void service.getReferenceEnvironment().then((value) => { setEnvironment(value); setResolution((old) => ({ ...old, merchantId: value.merchantId, actorAlias: value.actorAliases?.reconciliationOperator ?? old.actorAlias })); }).catch(setError); }, [service]);
  function applyReview(value: ManualReviewItem) {
    selectedReviewId.current = value.reviewId;
    setReview(value); setReviewId(value.reviewId);
    setResolution((old) => ({ ...old, merchantId: value.merchantId ?? environment?.merchantId ?? old.merchantId, actorAlias: actorAliasForReview(value) ?? old.actorAlias }));
  }
  function applyNotification(value: MerchantNotification) {
    selectedNotificationId.current = value.notificationId;
    setNotification(value); setNotificationId(value.notificationId);
  }
  async function loadReview(id = reviewId) {
    const target = id.trim();
    if (!target) return;
    const requestId = ++reviewRequestSequence.current;
    if (selectedReviewId.current !== target) {
      setReview(undefined);
      setResolution((old) => ({ ...old, idempotencyKey: token("review-resolution") }));
    }
    selectedReviewId.current = target;
    setReviewId(target); setReviewLoading(true); setError(undefined);
    try {
      const value = await service.getManualReview(target);
      if (requestId === reviewRequestSequence.current && selectedReviewId.current === target) applyReview(value);
    } catch (cause) {
      if (requestId === reviewRequestSequence.current && selectedReviewId.current === target) setError(cause);
    } finally {
      if (requestId === reviewRequestSequence.current) setReviewLoading(false);
    }
  }
  async function loadNotification(id = notificationId) {
    const target = id.trim();
    if (!target) return;
    const requestId = ++notificationRequestSequence.current;
    if (selectedNotificationId.current !== target) {
      setNotification(undefined);
      setNotificationRetryKey(token("notification-retry"));
    }
    selectedNotificationId.current = target;
    setNotificationId(target); setNotificationLoading(true); setError(undefined);
    try {
      const value = await service.getNotification(target);
      if (requestId === notificationRequestSequence.current && selectedNotificationId.current === target) applyNotification(value);
    } catch (cause) {
      if (requestId === notificationRequestSequence.current && selectedNotificationId.current === target) setError(cause);
    } finally {
      if (requestId === notificationRequestSequence.current) setNotificationLoading(false);
    }
  }
  async function submitResolution(event: FormEvent) {
    event.preventDefault(); if (!review || !await confirmAction(findAction(review.actions, "RESOLVE_MANUAL_REVIEW"), "处置人工核对", confirmationScope)) return;
    const target = review.reviewId;
    lastCommandTarget.current = { kind: "review", id: target };
    ++reviewRequestSequence.current;
    setReviewLoading(false);
    setError(undefined); setNotice("人工核对处置已提交，正在观察 Operation。");
    try {
      const observed = await execution.run<ManualReviewItem>({ type: "RESOLVE_MANUAL_REVIEW", input: { reviewId: review.reviewId, reviewType: review.type, merchantId: resolution.merchantId, outcome: resolution.outcome, actorAlias: resolution.actorAlias || undefined, actorId: resolution.actorId || undefined, actorRole: resolution.actorRole || undefined, reason: resolution.reason, evidenceRefs: resolution.evidenceRefs.split(",").map((item) => item.trim()).filter(Boolean), remediationReference: resolution.remediationReference || undefined, idempotencyKey: resolution.idempotencyKey } }, () => service.getManualReview(target));
      if (selectedReviewId.current === target) {
        if (observed.resource) applyReview(observed.resource);
        else if (!observed.timedOut) await loadReview(target);
      }
      setRefreshKey((value) => value + 1);
      if (!observed.timedOut && observed.operation.status === "SUCCEEDED") setResolution((old) => ({ ...old, idempotencyKey: token("review-resolution") }));
      setNotice(observed.timedOut ? "处置已受理，观察尚未收敛。" : `处置 Operation：${observed.operation.status}`);
    } catch (cause) { setError(cause); }
  }
  async function retryNotification() {
    if (!notification || !await confirmAction(undefined, "重试商户通知", notificationConfirmationScope)) return;
    const target = notification.notificationId;
    lastCommandTarget.current = { kind: "notification", id: target };
    ++notificationRequestSequence.current;
    setNotificationLoading(false);
    setError(undefined); setNotice("通知重试已提交。");
    try {
      const observed = await execution.run<MerchantNotification>({ type: "RETRY_NOTIFICATION", input: { notificationId: target, merchantId: notification.merchantId ?? environment?.merchantId ?? "", idempotencyKey: notificationRetryKey } }, () => service.getNotification(target));
      if (selectedNotificationId.current === target) {
        if (observed.resource) applyNotification(observed.resource);
        else if (!observed.timedOut) await loadNotification(target);
      }
      setRefreshKey((value) => value + 1);
      if (!observed.timedOut && observed.operation.status === "SUCCEEDED") setNotificationRetryKey(token("notification-retry"));
      setNotice(observed.timedOut ? "通知重试已受理，观察尚未收敛。" : `通知重试 Operation：${observed.operation.status}`);
    } catch (cause) { setError(cause); }
  }
  async function continueObservation() {
    const target = lastCommandTarget.current;
    setError(undefined); setNotice("正在使用同一 Operation ID 继续观察。");
    try {
      const observed = await execution.resume();
      if (target?.kind === "review" && selectedReviewId.current === target.id && !observed.timedOut) await loadReview(target.id);
      if (target?.kind === "notification" && selectedNotificationId.current === target.id && !observed.timedOut) await loadNotification(target.id);
      if (!observed.timedOut) setRefreshKey((value) => value + 1);
      setNotice(observed.timedOut ? "Operation 仍未在本次窗口内收敛，可稍后再次继续观察。" : `Operation 已收敛为 ${observed.operation.status}。`);
    } catch (cause) { setError(cause); }
  }

  return <div className="page-stack"><SectionHeader title="人工核对与通知" description="人工责任字段、证据和追加处置历史不可被前端覆盖；通知按稳定 identity 展示并安全重试。" />
    <div className="two-column-layout"><section className="panel"><h3><Search size={18} />查询人工核对</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void loadReview(); }}><input value={reviewId} onChange={(e) => setReviewId(e.target.value)} placeholder="Review ID" /><button className="button" type="submit">查询</button></form></section><section className="panel"><h3><Bell size={18} />查询通知</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void loadNotification(); }}><input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder="Notification ID" /><button className="button" type="submit">查询</button></form></section></div>
    {notice ? <InlineNotice tone={execution.timedOut ? "warning" : "info"}>{notice}</InlineNotice> : null}{error ? <ErrorBlock error={error} /> : null}{reviewLoading ? <LoadingBlock label="正在读取人工核对权威详情" /> : null}{notificationLoading ? <LoadingBlock label="正在读取通知权威详情" /> : null}{execution.busy ? <LoadingBlock /> : null}<CommandFeedback receipt={execution.receipt} operation={execution.operation} timedOut={execution.timedOut} observationError={execution.observationError} onContinue={() => void continueObservation()} busy={execution.busy} />
    <AuthoritativeList title="ManualReviewItem 权威列表" description="可按商户、类型、状态、最终性、关联资源和阻断范围筛选。" loadPage={(page) => service.listManualReviews(page)} itemKey={(item) => item.reviewId} specificFilters={[{ key: "type", label: "核对类型" }, { key: "relatedResourceId", label: "关联资源 ID" }, { key: "blockingScope", label: "阻断范围" }]} columns={["Review", "类型", "商户", "状态", "最终性", "阻断范围", ""]} onOpen={(item) => void loadReview(item.reviewId)} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.reviewId}</code></td><td>{item.type}</td><td>{item.merchantId ?? "—"}</td><td><StatusBadge status={item.status} /></td><td><StatusBadge status={item.finality} /></td><td>{item.blockingScopes.join(", ") || "—"}</td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {review ? <><section className="detail-heading"><div><span>人工核对详情</span><h2 className="mono-title">{review.reviewId}</h2></div><div><StatusBadge status={review.status} /><StatusBadge status={review.finality} /><button className="icon-button" type="button" onClick={() => void loadReview(review.reviewId)}><RefreshCw size={16} /></button></div></section><section className="detail-band"><DefinitionList items={[{ label: "类型", value: review.type }, { label: "商户", value: review.merchantId ?? "—" }, { label: "摘要", value: review.summary ?? "—" }, { label: "阻断范围", value: review.blockingScopes.join(", ") || "—" }, { label: "关联资源", value: review.relatedResources.map((item) => `${item.resourceType}:${item.resourceId}`).join(", ") || "—" }, { label: "证据", value: review.evidenceRefs.map(evidenceLabel).join(", ") || "—" }, { label: "创建", value: formatTime(review.createdAt) }, { label: "解决", value: formatTime(review.resolvedAt) }]} /><SourceDetails source={review.source} /></section>
      <section><SectionHeader title="处置历史" />{review.dispositions.length === 0 ? <EmptyBlock title="暂无处置" /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Outcome</th><th>Actor</th><th>原因</th><th>证据</th><th>记录时间</th></tr></thead><tbody>{review.dispositions.map((item, index) => <tr key={`${item.recordedAt}:${index}`}><td>{item.outcome}</td><td>{item.actorId ?? "—"} / {item.actorRole ?? "—"}</td><td>{item.reason}</td><td>{item.evidenceRefs.map(evidenceLabel).join(", ")}</td><td>{formatTime(item.recordedAt)}</td></tr>)}</tbody></table></div>}</section>
      <section className="panel action-form"><h3><ShieldCheck size={18} />提交责任处置</h3><form className="form-grid" onSubmit={submitResolution}><label><span>Outcome</span><select value={resolution.outcome} onChange={(e) => setResolution({ ...resolution, outcome: e.target.value })}><option value="CONFIRM_SUCCESS">确认成功</option><option value="CONFIRM_FAILURE">确认失败</option><option value="KEEP_ACCEPTED_SUCCESS">保留已接受成功并记录补救</option><option value="KEEP_CURRENT_TERMINAL">保留当前终态</option><option value="ACCEPT_DIFFERENCE">接受差异且不进入结算</option><option value="ESCALATE">升级并保持阻断</option></select></label><label><span>商户</span><input required value={resolution.merchantId} onChange={(e) => setResolution({ ...resolution, merchantId: e.target.value })} /></label><label><span>Actor alias</span><input value={resolution.actorAlias} onChange={(e) => setResolution({ ...resolution, actorAlias: e.target.value })} /></label><label><span>Actor ID</span><input value={resolution.actorId} onChange={(e) => setResolution({ ...resolution, actorId: e.target.value })} /></label><label><span>Actor role</span><input value={resolution.actorRole} onChange={(e) => setResolution({ ...resolution, actorRole: e.target.value })} /></label><label><span>幂等键</span><input required value={resolution.idempotencyKey} onChange={(e) => setResolution({ ...resolution, idempotencyKey: e.target.value })} /></label><label className="span-2"><span>原因</span><input required value={resolution.reason} onChange={(e) => setResolution({ ...resolution, reason: e.target.value })} /></label><label className="span-2"><span>证据引用（逗号分隔）</span><input required value={resolution.evidenceRefs} onChange={(e) => setResolution({ ...resolution, evidenceRefs: e.target.value })} /></label><label className="span-2"><span>补救引用（保留已接受成功时必填）</span><input value={resolution.remediationReference} onChange={(e) => setResolution({ ...resolution, remediationReference: e.target.value })} /></label><button className="button button--danger span-2" disabled={!canExecute(review.actions, "RESOLVE_MANUAL_REVIEW") || execution.busy} type="submit">确认处置</button></form></section>
    </> : null}
    <AuthoritativeList title="商户通知投递历史" description="notification identity、content identity 与每次投递尝试均保持稳定。" loadPage={(page) => service.listNotifications(page)} itemKey={(item) => item.notificationId} columns={["Notification", "Content identity", "业务资源", "状态", "尝试次数", "创建时间", ""]} onOpen={(item) => void loadNotification(item.notificationId)} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.notificationId}</code></td><td><code>{item.contentIdentity ?? "—"}</code></td><td><code>{item.resource ? `${item.resource.resourceType}:${item.resource.resourceId}` : "—"}</code></td><td><StatusBadge status={item.status} /></td><td>{item.attempts.length}</td><td>{formatTime(item.createdAt)}</td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {notification ? <section className="panel"><SectionHeader title="通知详情" action={<button className="button button--danger" type="button" disabled={execution.busy} onClick={() => void retryNotification()}>重试通知</button>} /><DefinitionList items={[{ label: "Notification", value: <code>{notification.notificationId}</code> }, { label: "Content identity", value: <code>{notification.contentIdentity ?? "—"}</code> }, { label: "状态", value: <StatusBadge status={notification.status} /> }, { label: "尝试次数", value: String(notification.attempts.length) }]} />{notification.attempts.map((item, index) => <div className="receipt-row" key={`${item.attemptId}:${index}`}><code>{item.attemptId ?? `attempt-${index + 1}`}</code><span>{item.status}</span><span>{formatTime(item.attemptedAt)} · {item.diagnostic ?? "—"}</span></div>)}</section> : null}
  </div>;
}
