import { type FormEvent, useEffect, useRef, useState } from "react";
import { FileCheck2, RefreshCw, Search } from "lucide-react";
import type { AuthoritativeBill, BusinessCommand, ReconciliationRun } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { canExecute, confirmAction, findAction, token } from "../action-utils";
import { AuthoritativeList } from "../AuthoritativeList";
import { CommandFeedback, DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { evidenceLabel, formatMoney, formatTime } from "../format";
import { referenceBusinessDate, referenceInstant } from "../reference-time";
import { useCommandExecution } from "../useCommandExecution";

export function ReconciliationPage({ service }: { service: PaymentWorkbenchService }) {
  const execution = useCommandExecution(service);
  const [run, setRun] = useState<ReconciliationRun>();
  const [lookupId, setLookupId] = useState("");
  const [billId, setBillId] = useState("");
  const [bill, setBill] = useState<AuthoritativeBill>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedRunId = useRef("");
  const runRequestSequence = useRef(0);
  const [start, setStart] = useState({ merchantId: "reference-merchant", billId: "", revision: "1", runId: "", channelId: "", currency: "", businessDate: "", businessTimezone: "", idempotencyKey: token("reconciliation") });
  const [signal, setSignal] = useState({ merchantId: "reference-merchant", billId: "", revision: "1", channelId: "", currency: "", businessDate: "", businessTimezone: "", signalIdentity: token("bill-signal"), idempotencyKey: token("bill-available") });
  const [decision, setDecision] = useState({ differenceId: "", revision: "1", merchantId: "reference-merchant", actorAlias: "fixture-reconciliation-operator", actorId: "operator-001", actorRole: "RECONCILIATION_OPERATOR", reason: "依据平台与渠道证据完成核对", evidenceRefs: "reference:evidence-001", conclusion: "ACCEPT_DIFFERENCE" as "ACCEPT_DIFFERENCE" | "ESCALATE" | "CONFIRM_PLATFORM_FACT", settlementImpact: "ALLOW" as "ALLOW" | "BLOCK" | "CONFIRM", outcome: "RESOLVED", factConfirmation: false, idempotencyKey: token("difference-decision") });

  useEffect(() => { void service.getReferenceEnvironment().then((value) => {
    const businessTimezone = value.policy?.businessTimezone ?? "";
    const scope = { channelId: value.channelId, currency: value.policy?.enabledCurrencies?.[0] ?? "", businessDate: referenceBusinessDate(referenceInstant(value.currentTime), businessTimezone), businessTimezone };
    setStart((old) => ({ ...old, ...scope, merchantId: value.merchantId }));
    setSignal((old) => ({ ...old, ...scope, merchantId: value.merchantId }));
    setDecision((old) => ({ ...old, merchantId: selectedRunId.current ? old.merchantId : value.merchantId, actorAlias: value.actorAliases?.reconciliationOperator ?? old.actorAlias }));
  }).catch(setError); }, [service]);

  async function syncBusinessDate() {
    try {
      const value = await service.getReferenceEnvironment();
      const instant = referenceInstant(value.currentTime);
      setStart((old) => ({ ...old, businessDate: referenceBusinessDate(instant, old.businessTimezone) }));
      setSignal((old) => ({ ...old, businessDate: referenceBusinessDate(instant, old.businessTimezone) }));
      setNotice(`业务日期已按 Reference Lab 逻辑时钟 ${instant} 更新。`);
    } catch (cause) { setError(cause); }
  }

  async function merchantForRun(value: ReconciliationRun): Promise<string> {
    if (value.merchantIds.length === 1) return value.merchantIds[0];
    if (value.merchantIds.length > 1) return "";
    try {
      const authoritativeBill = await service.getBill(value.billId);
      if (authoritativeBill.merchantId?.trim()) return authoritativeBill.merchantId;
    } catch { /* A bill may be temporarily unreadable; try the linked resource. */ }
    const linked = value.differences.find((item) => !item.resolved) ?? value.differences[0];
    try {
      if (linked?.paymentId) return (await service.getPayment(linked.paymentId)).merchantId;
      if (linked?.refundId) return (await service.getRefund(linked.refundId)).merchantId;
    } catch { /* Keep the field blank so the operator can select the merchant explicitly. */ }
    return "";
  }
  function applyRun(value: ReconciliationRun, merchantId: string) {
    selectedRunId.current = value.runId; setRun(value); setLookupId(value.runId);
    setStart((old) => ({ ...old, billId: value.billId, merchantId, revision: String(value.billRevision ?? 1), channelId: value.scope.channelId, currency: value.scope.currency, businessDate: value.scope.businessDate ?? "", businessTimezone: value.scope.businessTimezone ?? "" }));
    setDecision((old) => ({ ...old, differenceId: value.differences.find((item) => !item.resolved)?.differenceId ?? value.differences[0]?.differenceId ?? "", merchantId, revision: String(value.billRevision ?? 1), idempotencyKey: token("difference-decision") }));
  }
  async function loadRun(id = lookupId) {
    if (!id.trim()) return;
    const target = id.trim();
    const sequence = ++runRequestSequence.current;
    if (selectedRunId.current !== target) {
      setRun(undefined);
      setDecision((old) => ({ ...old, differenceId: "", merchantId: "" }));
      setStart((old) => ({ ...old, merchantId: "" }));
    }
    selectedRunId.current = target; setLoading(true); setError(undefined);
    try {
      const value = await service.getReconciliationRun(target);
      const merchantId = await merchantForRun(value);
      if (runRequestSequence.current === sequence && selectedRunId.current === target) applyRun(value, merchantId);
    } catch (cause) { if (runRequestSequence.current === sequence) setError(cause); }
    finally { if (runRequestSequence.current === sequence) setLoading(false); }
  }
  async function execute(command: BusinessCommand, label: string, id?: string) {
    setError(undefined); setNotice(`${label}已提交，正在观察 Operation。`);
    try { const observed = await execution.run<ReconciliationRun>(command, id ? () => service.getReconciliationRun(id) : undefined); if (observed.resource) applyRun(observed.resource, await merchantForRun(observed.resource)); else if (id && !observed.timedOut) await loadRun(id); setRefreshKey((value) => value + 1); setNotice(observed.timedOut ? `${label}已受理但观察暂未收敛。` : `${label}已受理，Operation 为 ${observed.operation.status}。`); }
    catch (cause) { setError(cause); }
  }
  async function queryBill(event: FormEvent) { event.preventDefault(); setLoading(true); setError(undefined); try { setBill(await service.getBill(billId.trim())); } catch (cause) { setError(cause); } finally { setLoading(false); } }
  async function continueObservation() {
    setError(undefined); setNotice("正在使用同一 Operation ID 继续观察。");
    try {
      const observed = await execution.resume<ReconciliationRun>();
      if (observed.resource) applyRun(observed.resource, await merchantForRun(observed.resource));
      else if (run && !observed.timedOut) await loadRun(run.runId);
      if (!observed.timedOut) setRefreshKey((value) => value + 1);
      setNotice(observed.timedOut ? "Operation 仍未在本次窗口内收敛，可稍后再次继续观察。" : `Operation 已收敛为 ${observed.operation.status}。`);
    } catch (cause) { setError(cause); }
  }
  const evidence = () => decision.evidenceRefs.split(",").map((item) => item.trim()).filter(Boolean);
  const selectedDifference = run?.differences.find((item) => item.differenceId === decision.differenceId);

  return <div className="page-stack"><SectionHeader title="账单与对账" description="权威账单 revision 触发 ReconciliationRun；原始差异、处置与 FactConfirmation 分层保留。" action={<button className="button button--small" type="button" onClick={() => void syncBusinessDate()}>从逻辑时钟同步业务日期</button>} />
    <div className="two-column-layout"><section className="panel"><h3><FileCheck2 size={18} />Bill available / refresh</h3><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void execute({ type: "SIGNAL_BILL_AVAILABLE", input: { merchantId: signal.merchantId, billId: signal.billId, revision: Number(signal.revision), channelId: signal.channelId, currency: signal.currency, businessDate: signal.businessDate, businessTimezone: signal.businessTimezone, signalIdentity: signal.signalIdentity, idempotencyKey: signal.idempotencyKey } }, "账单可用信号"); }}>
      <label><span>商户</span><input required value={signal.merchantId} onChange={(e) => setSignal({ ...signal, merchantId: e.target.value })} /></label><label><span>Bill ID</span><input required value={signal.billId} onChange={(e) => setSignal({ ...signal, billId: e.target.value })} /></label><label><span>Revision</span><input required type="number" min="1" value={signal.revision} onChange={(e) => setSignal({ ...signal, revision: e.target.value })} /></label><label><span>渠道</span><input required value={signal.channelId} onChange={(e) => setSignal({ ...signal, channelId: e.target.value })} /></label><label><span>币种</span><input required value={signal.currency} onChange={(e) => setSignal({ ...signal, currency: e.target.value })} /></label><label><span>业务日期</span><input required type="date" value={signal.businessDate} onChange={(e) => setSignal({ ...signal, businessDate: e.target.value })} /></label><label className="span-2"><span>业务时区</span><input required value={signal.businessTimezone} onChange={(e) => setSignal({ ...signal, businessTimezone: e.target.value })} /></label><label><span>Signal identity</span><input required value={signal.signalIdentity} onChange={(e) => setSignal({ ...signal, signalIdentity: e.target.value })} /></label><label><span>幂等键</span><input required value={signal.idempotencyKey} onChange={(e) => setSignal({ ...signal, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={execution.busy} type="submit">通知账单可用</button></form></section>
      <section className="panel"><h3><FileCheck2 size={18} />运行对账</h3><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void execute({ type: "RUN_RECONCILIATION", input: { merchantId: start.merchantId, billId: start.billId, revision: Number(start.revision), runId: start.runId || undefined, channelId: start.channelId, currency: start.currency, businessDate: start.businessDate, businessTimezone: start.businessTimezone, idempotencyKey: start.idempotencyKey } }, "运行对账"); }}>
      <label><span>商户</span><input required value={start.merchantId} onChange={(e) => setStart({ ...start, merchantId: e.target.value })} /></label><label><span>Bill ID</span><input required value={start.billId} onChange={(e) => setStart({ ...start, billId: e.target.value })} /></label><label><span>Revision</span><input required type="number" min="1" value={start.revision} onChange={(e) => setStart({ ...start, revision: e.target.value })} /></label><label><span>Run ID（可选）</span><input value={start.runId} onChange={(e) => setStart({ ...start, runId: e.target.value })} /></label><label><span>渠道</span><input required value={start.channelId} onChange={(e) => setStart({ ...start, channelId: e.target.value })} /></label><label><span>币种</span><input required value={start.currency} onChange={(e) => setStart({ ...start, currency: e.target.value })} /></label><label><span>业务日期</span><input required type="date" value={start.businessDate} onChange={(e) => setStart({ ...start, businessDate: e.target.value })} /></label><label><span>业务时区</span><input required value={start.businessTimezone} onChange={(e) => setStart({ ...start, businessTimezone: e.target.value })} /></label><label className="span-2"><span>幂等键</span><input required value={start.idempotencyKey} onChange={(e) => setStart({ ...start, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={execution.busy} type="submit">创建 ReconciliationRun</button></form></section></div>
    <div className="two-column-layout"><section className="panel"><h3><Search size={18} />查询 Run</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void loadRun(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Run ID" /><button className="button" type="submit">查询</button></form></section><section className="panel"><h3><Search size={18} />查询权威账单</h3><form className="lookup-form" onSubmit={queryBill}><input value={billId} onChange={(e) => setBillId(e.target.value)} placeholder="Bill ID" /><button className="button" type="submit">查询</button></form>{bill ? <InlineNotice tone="success">{bill.billId} · current revision {bill.currentRevision ?? "—"} · {bill.currency}</InlineNotice> : null}</section></div>
    {bill ? <section><SectionHeader title="权威账单 revision 链" description="每个 revision 与记录保持不可变，后续 revision 不覆盖旧证据。" /><DefinitionList items={[{ label: "Bill", value: <code>{bill.billId}</code> }, { label: "渠道", value: bill.channelId }, { label: "商户", value: bill.merchantId ?? "—" }, { label: "业务日期", value: bill.businessDate ?? "—" }, { label: "Current revision", value: String(bill.currentRevision ?? "—") }]} />{bill.revisions?.flatMap((revision) => revision.records.map((record) => ({ revision, record }))).length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Revision</th><th>Record</th><th>类型</th><th>外部交易</th><th>金额</th><th>状态</th><th>发布时间</th></tr></thead><tbody>{bill.revisions?.flatMap((revision) => revision.records.map((record) => <tr key={`${revision.revision}:${record.recordId}`}><td>{revision.revision}</td><td><code>{record.recordId}</code></td><td>{record.transactionKind}</td><td><code>{record.externalTransactionId}</code></td><td>{formatMoney(record.money)}</td><td>{record.status}</td><td>{formatTime(revision.publishedAt)}</td></tr>))}</tbody></table></div> : <EmptyBlock title="账单尚无可展示记录" />}</section> : null}
    {bill?.revisions?.map((revision) => <section className="panel" key={`bill-revision:${revision.revision}`}>
      <SectionHeader title={`Revision ${revision.revision} 原始证据`} description="回读同一 revision 的发布完整性、载荷指纹与每条账单原文。" />
      <DefinitionList items={[
        { label: "Revision ID", value: revision.revisionId ?? "—" },
        { label: "完整性", value: revision.completeness ?? (revision.complete == null ? "—" : revision.complete ? "完整" : "不完整") },
        { label: "Payload fingerprint", value: <code>{revision.payloadFingerprint ?? "—"}</code> },
        { label: "发布时刻", value: formatTime(revision.publishedAt) },
        { label: "Revision raw evidence", value: <code>{revision.rawEvidence ?? "—"}</code> },
      ]} />
      {revision.records.map((record) => <div className="receipt-row" key={`${revision.revision}:${record.recordId}`}>
        <span><code>{record.recordId}</code> · {record.transactionKind} · {formatMoney(record.money)}</span>
        <span>Raw status: {record.rawStatus ?? record.status} · 发生 {formatTime(record.occurredAt)} · 接收 {formatTime(record.receivedAt)}</span>
        <span>Raw evidence: <code>{record.rawEvidence ?? "—"}</code></span>
      </div>)}
    </section>)}
    {notice ? <InlineNotice tone={execution.timedOut ? "warning" : "info"}>{notice}</InlineNotice> : null}{error ? <ErrorBlock error={error} onRetry={run ? () => void loadRun(run.runId) : undefined} /> : null}{loading || execution.busy ? <LoadingBlock /> : null}<CommandFeedback receipt={execution.receipt} operation={execution.operation} timedOut={execution.timedOut} observationError={execution.observationError} onContinue={() => void continueObservation()} busy={execution.busy} />
    <AuthoritativeList title="ReconciliationRun 权威列表" description="ReconciliationRun 是唯一对账执行主资源；业务 scope 是渠道、币种和业务日，merchantId 只是关联筛选条件。" loadPage={(page) => service.listReconciliationRuns(page)} itemKey={(item) => item.runId} specificFilters={[{ key: "billId", label: "Bill ID" }, { key: "billRevision", label: "Bill revision", kind: "number" }, { key: "channelId", label: "渠道" }, { key: "currency", label: "币种" }, { key: "businessDate", label: "业务日期", kind: "date" }, { key: "effectiveRun", label: "Effective run", kind: "boolean" }]} columns={["Run", "Bill / Revision", "业务范围", "关联商户", "状态", "最终性", "结算阻断", ""]} onOpen={(item) => void loadRun(item.runId)} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.runId}</code></td><td><code>{item.billId} / {item.billRevision ?? "—"}</code></td><td>{item.scope.channelId} · {item.scope.currency} · {item.scope.businessDate ?? "—"}</td><td>{item.merchantIds.join(", ") || "由差异事实关联"}</td><td><StatusBadge status={item.status} /></td><td><StatusBadge status={item.finality} /></td><td>{item.settlementBlocked ? "阻断" : "未阻断"}</td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {run ? <><section className="detail-heading"><div><span>对账运行</span><h2 className="mono-title">{run.runId}</h2></div><div><StatusBadge status={run.status} /><StatusBadge status={run.finality} /><button className="icon-button" type="button" onClick={() => void loadRun(run.runId)}><RefreshCw size={16} /></button></div></section><section className="detail-band"><DefinitionList items={[{ label: "Bill", value: <code>{run.billId}</code> }, { label: "Revision", value: String(run.billRevision ?? "—") }, { label: "渠道", value: run.scope.channelId }, { label: "业务日期", value: run.scope.businessDate ?? "—" }, { label: "时区", value: run.scope.businessTimezone ?? "—" }, { label: "币种", value: run.scope.currency }, { label: "关联商户", value: run.merchantIds.join(", ") || "由差异事实确定" }, { label: "Effective run", value: run.effectiveRun == null ? "未知" : run.effectiveRun ? "是" : "否" }, { label: "结算阻断", value: run.settlementBlocked ? "是" : "否" }]} /><SourceDetails source={run.source} /></section>
      <section><SectionHeader title="对账差异" description="双方事实与 matching basis 保持可观察，处置不会覆盖初始差异。" />{run.differences.length === 0 ? <EmptyBlock title="当前运行无差异" /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>差异</th><th>类型</th><th>关联</th><th>平台金额</th><th>渠道金额</th><th>Matching basis</th><th>状态</th></tr></thead><tbody>{run.differences.map((item) => <tr key={item.differenceId}><td><button className="button button--small" type="button" onClick={() => setDecision({ ...decision, differenceId: item.differenceId })}>{item.differenceId}</button></td><td>{item.differenceType}</td><td><code>{item.paymentId ?? item.refundId ?? item.externalTransactionId ?? "—"}</code></td><td>{formatMoney(item.platformMoney)}</td><td>{formatMoney(item.channelMoney)}</td><td>{item.matchingBasis ?? "—"}</td><td>{item.resolved ? "已解决" : item.settlementBlocked ? "未决/阻断" : "未决"}</td></tr>)}</tbody></table></div>}</section>
      {selectedDifference ? <section className="panel"><SectionHeader title="差异证据与追加历史" description="原平台/账单证据、DifferenceDisposition 与 FactConfirmation 分层保留。" /><DefinitionList items={[{ label: "Difference", value: <code>{selectedDifference.differenceId}</code> }, { label: "平台事实", value: selectedDifference.platformEvidenceRefs.map(evidenceLabel).join(", ") || "—" }, { label: "账单事实", value: selectedDifference.billEvidenceRefs.map(evidenceLabel).join(", ") || "—" }, { label: "平台状态", value: selectedDifference.platformStatus ?? "—" }, { label: "渠道状态", value: selectedDifference.channelStatus ?? "—" }]} />{selectedDifference.dispositions.map((item, index) => <div className="receipt-row" key={`disposition:${item.recordedAt}:${index}`}><span>Disposition · {item.conclusion ?? item.status ?? "—"}</span><span>{item.actorId ?? "—"} · {item.reason ?? "—"}</span><span>{item.evidenceRefs.map(evidenceLabel).join(", ") || "—"} · {formatTime(item.recordedAt)}</span></div>)}{selectedDifference.confirmations.map((item, index) => <div className="receipt-row" key={`confirmation:${item.recordedAt}:${index}`}><span>FactConfirmation</span><span>{item.actorId ?? "—"} · {item.reason ?? "—"}</span><span>{item.evidenceRefs.map(evidenceLabel).join(", ") || "—"} · {formatTime(item.recordedAt)}</span></div>)}</section> : null}
      <section className="panel action-form"><h3>差异处置 / FactConfirmation</h3><form className="form-grid" onSubmit={(e) => { e.preventDefault(); const type = decision.factConfirmation ? "CONFIRM_RECONCILIATION_FACT" : "DISPOSE_RECONCILIATION_DIFFERENCE"; if (!confirmAction(findAction(run.actions, type), decision.factConfirmation ? "确认事实" : "处置差异")) return; void execute({ type, input: { runId: run.runId, differenceId: decision.differenceId, revision: Number(decision.revision), merchantId: decision.merchantId, idempotencyKey: decision.idempotencyKey, actorAlias: decision.actorAlias, actorId: decision.actorId, actorRole: decision.actorRole, reason: decision.reason, evidenceRefs: evidence(), conclusion: decision.conclusion, settlementImpact: decision.settlementImpact, outcome: decision.outcome, confirmation: decision.factConfirmation ? { conclusion: decision.conclusion } : undefined } }, decision.factConfirmation ? "事实确认" : "差异处置", run.runId); }}>
        <label><span>Difference ID</span><input required value={decision.differenceId} onChange={(e) => setDecision({ ...decision, differenceId: e.target.value })} /></label><label><span>Merchant ID</span><input required value={decision.merchantId} onChange={(e) => setDecision({ ...decision, merchantId: e.target.value })} /></label><label><span>Revision</span><input required type="number" value={decision.revision} onChange={(e) => setDecision({ ...decision, revision: e.target.value })} /></label><label><span>结论</span><select required value={decision.conclusion} onChange={(e) => setDecision({ ...decision, conclusion: e.target.value as typeof decision.conclusion })}><option value="ACCEPT_DIFFERENCE">接受差异并保留原事实</option><option value="ESCALATE">继续升级并保持阻断</option><option value="CONFIRM_PLATFORM_FACT">确认平台事实（仅 FactConfirmation）</option></select></label><label><span>结算影响</span><select value={decision.settlementImpact} onChange={(e) => setDecision({ ...decision, settlementImpact: e.target.value as typeof decision.settlementImpact })}><option value="ALLOW">解除结算阻断</option><option value="BLOCK">继续阻断结算</option><option value="CONFIRM">形成确认结算事实</option></select></label><label><span>Actor alias</span><input value={decision.actorAlias} onChange={(e) => setDecision({ ...decision, actorAlias: e.target.value })} /></label><label><span>Actor ID</span><input value={decision.actorId} onChange={(e) => setDecision({ ...decision, actorId: e.target.value })} /></label><label className="span-2"><span>原因</span><input required value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} /></label><label className="span-2"><span>证据引用（逗号分隔）</span><input required value={decision.evidenceRefs} onChange={(e) => setDecision({ ...decision, evidenceRefs: e.target.value })} /></label><label><span>幂等键</span><input required value={decision.idempotencyKey} onChange={(e) => setDecision({ ...decision, idempotencyKey: e.target.value })} /></label><label><span>处置类型</span><select value={decision.factConfirmation ? "fact" : "disposition"} onChange={(e) => setDecision({ ...decision, factConfirmation: e.target.value === "fact" })}><option value="disposition">DifferenceDisposition</option><option value="fact">FactConfirmation</option></select></label><button className="button button--danger span-2" disabled={execution.busy || !canExecute(run.actions, decision.factConfirmation ? "CONFIRM_RECONCILIATION_FACT" : "DISPOSE_RECONCILIATION_DIFFERENCE")} type="submit">提交责任处置</button>
      </form></section>
      <section><SectionHeader title="运行级动作" description="重跑沿用上方“运行对账”表单中可见且可编辑的渠道、币种、业务日期与时区。" /><div className="quick-actions"><button className="button" disabled={!canExecute(run.actions, "RERUN_RECONCILIATION") || execution.busy || !hasCompleteScope(start)} type="button" onClick={() => { if (confirmAction(findAction(run.actions, "RERUN_RECONCILIATION"))) void execute({ type: "RERUN_RECONCILIATION", input: { runId: run.runId, merchantId: decision.merchantId || run.merchantIds[0] || "", billId: run.billId, revision: Number(run.billRevision ?? 1), channelId: start.channelId, currency: start.currency, businessDate: start.businessDate, businessTimezone: start.businessTimezone, idempotencyKey: token("rerun") } }, "重跑对账", run.runId); }}>重跑</button><button className="button button--danger" disabled={!canExecute(run.actions, "COMPLETE_RECONCILIATION") || execution.busy} type="button" onClick={() => { if (confirmAction(findAction(run.actions, "COMPLETE_RECONCILIATION"))) void execute({ type: "COMPLETE_RECONCILIATION", input: { runId: run.runId, merchantId: decision.merchantId || run.merchantIds[0] || "", idempotencyKey: token("complete-run"), actorAlias: decision.actorAlias, actorId: decision.actorId, actorRole: decision.actorRole, reason: decision.reason, evidenceRefs: evidence() } }, "完成对账", run.runId); }}>显式完成</button></div></section>
    </> : null}
  </div>;
}

function hasCompleteScope(value: { channelId: string; currency: string; businessDate: string; businessTimezone: string }): boolean {
  return [value.channelId, value.currency, value.businessDate, value.businessTimezone].every((item) => item.trim().length > 0);
}
