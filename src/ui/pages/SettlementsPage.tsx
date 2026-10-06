import { type FormEvent, useEffect, useRef, useState } from "react";
import { Landmark, RefreshCw, Search, Send } from "lucide-react";
import type { BusinessCommand, ChannelOutcome, Settlement } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { canExecute, confirmAction, findAction, token } from "../action-utils";
import { useConfirmationScope } from "../confirmation";
import { AuthoritativeList } from "../AuthoritativeList";
import { CommandFeedback, DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { formatMoney, formatTime } from "../format";
import { referenceInstant, referencePeriod } from "../reference-time";
import { useCommandExecution } from "../useCommandExecution";

const newExecutionForm = (channelId = "") => ({ executionId: token("execution"), channelId, idempotencyKey: token("execute"), reviewAfterMinutes: "30" });

export function SettlementsPage({ service }: { service: PaymentWorkbenchService }) {
  const execution = useCommandExecution(service);
  const [settlement, setSettlement] = useState<Settlement>();
  const confirmationScope = useConfirmationScope(settlement, service);
  const [lookupId, setLookupId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedSettlementId = useRef("");
  const settlementRequestSequence = useRef(0);
  const [prepare, setPrepare] = useState({ merchantId: "reference-merchant", channelId: "", currency: "CNY", ...referencePeriod(), businessTimezone: "Asia/Shanghai", settlementId: "", idempotencyKey: token("settlement") });
  const [responsibility, setResponsibility] = useState({ actorAlias: "fixture-settlement-operator", actorId: "reference-settlement-operator", actorRole: "SETTLEMENT_OPERATOR", reason: "依据已确认对账事实推进结算", evidenceRefs: "reference:settlement-evidence", idempotencyKey: token("settlement-action") });
  const [executionForm, setExecutionForm] = useState(newExecutionForm);
  const [result, setResult] = useState({ attemptId: "", channelId: "", resultIdentity: token("settlement-result"), externalTransactionId: token("external-settlement"), executionGroupIdentity: "", requestIdentity: "", outcome: "SUCCESS" as ChannelOutcome, occurredAt: referenceInstant() });

  useEffect(() => { void service.getReferenceEnvironment().then((value) => {
    setPrepare((old) => ({ ...old, merchantId: value.merchantId, channelId: value.channelId, businessTimezone: value.policy?.businessTimezone ?? old.businessTimezone, ...referencePeriod(value.currentTime) }));
    setResponsibility((old) => ({ ...old, actorAlias: value.actorAliases?.settlementOperator ?? old.actorAlias }));
    setExecutionForm((old) => ({ ...old, channelId: value.channelId }));
    setResult((old) => ({ ...old, channelId: value.channelId, occurredAt: referenceInstant(value.currentTime) }));
  }).catch(setError); }, [service]);

  async function syncBusinessTime() {
    try {
      const value = await service.getReferenceEnvironment();
      setPrepare((old) => ({ ...old, ...referencePeriod(value.currentTime) }));
      setResult((old) => ({ ...old, occurredAt: referenceInstant(value.currentTime) }));
      setNotice(`周期和结果时间已按 Reference Lab 逻辑时钟 ${referenceInstant(value.currentTime)} 更新。`);
    } catch (cause) { setError(cause); }
  }

  function apply(value: Settlement) {
    selectedSettlementId.current = value.settlementId;
    setSettlement(value); setLookupId(value.settlementId);
    const latest = value.executions.at(-1);
    setExecutionForm((old) => ({ ...old, channelId: value.channelId ?? old.channelId }));
    if (latest) setResult((old) => ({ ...old, attemptId: latest.executionId, externalTransactionId: latest.externalSettlementId ?? old.externalTransactionId, executionGroupIdentity: latest.executionGroupIdentity ?? old.executionGroupIdentity, requestIdentity: latest.requestIdentity ?? old.requestIdentity, channelId: value.channelId ?? old.channelId }));
  }
  async function load(id = lookupId) {
    const target = id.trim();
    if (!target) return;
    const requestId = ++settlementRequestSequence.current;
    if (selectedSettlementId.current !== target) {
      setSettlement(undefined);
      setExecutionForm(newExecutionForm());
      setResult((old) => ({
        ...old, attemptId: "", channelId: "", externalTransactionId: "",
        executionGroupIdentity: "", requestIdentity: "", resultIdentity: token("settlement-result"),
      }));
    }
    selectedSettlementId.current = target;
    setLookupId(target); setLoading(true); setError(undefined);
    try {
      const value = await service.getSettlement(target);
      if (requestId === settlementRequestSequence.current && selectedSettlementId.current === target) apply(value);
    } catch (cause) {
      if (requestId === settlementRequestSequence.current && selectedSettlementId.current === target) setError(cause);
    } finally {
      if (requestId === settlementRequestSequence.current) setLoading(false);
    }
  }
  async function execute(command: BusinessCommand, label: string, id?: string): Promise<boolean> {
    const priorSelection = selectedSettlementId.current;
    ++settlementRequestSequence.current;
    setLoading(false);
    setError(undefined); setNotice(`${label}已提交，正在观察 Operation。`);
    try {
      const observed = await execution.run<Settlement>(command, id ? () => service.getSettlement(id) : undefined);
      if (selectedSettlementId.current === priorSelection) {
        if (observed.resource) apply(observed.resource);
        else if (id && !observed.timedOut) await load(id);
      }
      setRefreshKey((value) => value + 1);
      setNotice(observed.timedOut ? `${label}已受理但观察暂未收敛。` : `${label}已受理，Operation 为 ${observed.operation.status}。`);
      return Boolean(observed.resource) && !observed.timedOut && observed.operation.status !== "FAILED";
    }
    catch (cause) { setError(cause); return false; }
  }
  async function continueObservation() {
    const priorSelection = selectedSettlementId.current;
    setError(undefined); setNotice("正在使用同一 Operation ID 继续观察。");
    try {
      const observed = await execution.resume<Settlement>();
      if (selectedSettlementId.current === priorSelection) {
        if (observed.resource && (!priorSelection || priorSelection === observed.resource.settlementId)) apply(observed.resource);
        else if (settlement && !observed.timedOut) await load(settlement.settlementId);
      }
      if (!observed.timedOut) setRefreshKey((value) => value + 1);
      setNotice(observed.timedOut ? "Operation 仍未在本次窗口内收敛，可稍后再次继续观察。" : `Operation 已收敛为 ${observed.operation.status}。`);
    } catch (cause) { setError(cause); }
  }
  const evidence = () => responsibility.evidenceRefs.split(",").map((item) => item.trim()).filter(Boolean);
  const responsible = (idempotencyKey = responsibility.idempotencyKey) => ({ merchantId: settlement?.merchantId ?? prepare.merchantId, idempotencyKey, actorAlias: responsibility.actorAlias, actorId: responsibility.actorId, actorRole: responsibility.actorRole, reason: responsibility.reason, evidenceRefs: evidence() });
  async function submitExecution(event: FormEvent) {
    event.preventDefault();
    if (!settlement || !await confirmAction(findAction(settlement.actions, "EXECUTE_SETTLEMENT"), undefined, confirmationScope)) return;
    const completed = await execute({ type: "EXECUTE_SETTLEMENT", input: { settlementId: settlement.settlementId, merchantId: settlement.merchantId, executionId: executionForm.executionId, channelId: executionForm.channelId, idempotencyKey: executionForm.idempotencyKey, reviewAfterMinutes: executionForm.reviewAfterMinutes ? Number(executionForm.reviewAfterMinutes) : undefined } }, "执行结算", settlement.settlementId);
    if (completed) setExecutionForm(newExecutionForm(executionForm.channelId));
  }

  return <div className="page-stack"><SectionHeader title="结算" description="准备候选、确认冻结、执行与结果收敛；UNKNOWN 必须保持原 execution identity，不能重付。" action={<button className="button button--small" type="button" onClick={() => void syncBusinessTime()}>从逻辑时钟同步时间</button>} />
    <div className="two-column-layout"><section className="panel"><h3><Landmark size={18} />准备结算</h3><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void execute({ type: "PREPARE_SETTLEMENT", input: { merchantId: prepare.merchantId, channelId: prepare.channelId || undefined, currency: prepare.currency, periodStart: prepare.periodStart, periodEnd: prepare.periodEnd, businessTimezone: prepare.businessTimezone, settlementId: prepare.settlementId || undefined, idempotencyKey: prepare.idempotencyKey } }, "准备结算"); }}>
      <label><span>商户</span><input required value={prepare.merchantId} onChange={(e) => setPrepare({ ...prepare, merchantId: e.target.value })} /></label><label><span>币种</span><select value={prepare.currency} onChange={(e) => setPrepare({ ...prepare, currency: e.target.value })}><option>CNY</option></select></label><label><span>渠道（可选）</span><input value={prepare.channelId} onChange={(e) => setPrepare({ ...prepare, channelId: e.target.value })} /></label><label><span>业务时区</span><input required value={prepare.businessTimezone} onChange={(e) => setPrepare({ ...prepare, businessTimezone: e.target.value })} /></label><label><span>周期开始（ISO）</span><input required value={prepare.periodStart} onChange={(e) => setPrepare({ ...prepare, periodStart: e.target.value })} /></label><label><span>周期结束（ISO）</span><input required value={prepare.periodEnd} onChange={(e) => setPrepare({ ...prepare, periodEnd: e.target.value })} /></label><label><span>Settlement ID（可选）</span><input value={prepare.settlementId} onChange={(e) => setPrepare({ ...prepare, settlementId: e.target.value })} /></label><label><span>幂等键</span><input required value={prepare.idempotencyKey} onChange={(e) => setPrepare({ ...prepare, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={execution.busy} type="submit">准备结算候选</button>
    </form></section><section className="panel"><h3><Search size={18} />查询结算</h3><form className="lookup-form" onSubmit={(e) => { e.preventDefault(); void load(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Settlement ID" /><button className="button" type="submit">查询</button></form><InlineNotice>确认后 scope、items、金额与 version 冻结；作废或替代不能绕过成功事实和 UNKNOWN 阻断。</InlineNotice></section></div>
    {notice ? <InlineNotice tone={execution.timedOut ? "warning" : "info"}>{notice}</InlineNotice> : null}{error ? <ErrorBlock error={error} onRetry={selectedSettlementId.current ? () => void load(selectedSettlementId.current) : undefined} /> : null}{loading ? <LoadingBlock label="正在读取结算权威详情" /> : null}{execution.busy ? <LoadingBlock /> : null}<CommandFeedback receipt={execution.receipt} operation={execution.operation} timedOut={execution.timedOut} observationError={execution.observationError} onContinue={() => void continueObservation()} busy={execution.busy} />
    <AuthoritativeList title="Settlement 权威列表" description="后端返回的 Page 与 cursor 是列表唯一权威来源。" loadPage={(page) => service.listSettlements(page)} itemKey={(item) => item.settlementId} specificFilters={[{ key: "channelId", label: "渠道" }, { key: "currency", label: "币种" }, { key: "period", label: "结算周期" }, { key: "executionStatus", label: "执行状态" }]} columns={["Settlement", "商户", "周期", "净额", "状态", "最终性", ""]} onOpen={(item) => void load(item.settlementId)} refreshKey={refreshKey} renderRow={(item, open) => <><td><code>{item.settlementId}</code></td><td>{item.merchantId}</td><td>{item.periodStart ?? "—"} → {item.periodEnd ?? "—"}</td><td>{formatMoney(item.netAmount)}</td><td><StatusBadge status={item.status} /></td><td><StatusBadge status={item.finality} /></td><td><button className="button button--small" type="button" onClick={open}>详情</button></td></>} />
    {settlement ? <><section className="detail-heading"><div><span>结算详情</span><h2 className="mono-title">{settlement.settlementId}</h2></div><div><StatusBadge status={settlement.status} /><StatusBadge status={settlement.finality} /><button className="icon-button" type="button" onClick={() => void load(settlement.settlementId)}><RefreshCw size={16} /></button></div></section>
      <section className="detail-band"><DefinitionList items={[{ label: "商户", value: settlement.merchantId }, { label: "渠道", value: settlement.channelId ?? "—" }, { label: "Scope", value: <code>{settlement.scopeId ?? "—"}</code> }, { label: "Version", value: String(settlement.version ?? "—") }, { label: "周期", value: `${settlement.periodStart ?? "—"} → ${settlement.periodEnd ?? "—"}` }, { label: "业务时区", value: settlement.businessTimezone ?? "—" }, { label: settlement.finality === "FINAL" ? "历史诊断" : "当前阻断", value: settlement.blockerSummary ?? "—" }, { label: "替代关系", value: <code>{settlement.predecessorSettlementId ?? "—"} → {settlement.replacementSettlementId ?? "—"}</code> }]} /><div className="money-summary"><div><span>收入</span><strong>{formatMoney(settlement.grossAmount)}</strong></div><div><span>退款</span><strong>{formatMoney(settlement.refundAmount)}</strong></div><div><span>费用 / 调整</span><strong>{formatMoney(settlement.feeAmount)} / {formatMoney(settlement.adjustmentAmount)}</strong></div><div><span>净额</span><strong>{formatMoney(settlement.netAmount)}</strong></div></div><SourceDetails source={settlement.source} /></section>
      <section><SectionHeader title="结算构成" description="每个候选均保留来源、INCLUDED/EXCLUDED 和 reason code。" />{settlement.items.length === 0 ? <EmptyBlock title="暂无结算 item" /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>来源</th><th>业务对象</th><th>处置</th><th>金额影响</th><th>原因</th></tr></thead><tbody>{settlement.items.map((item) => <tr key={item.settlementItemId}><td><code>{item.settlementItemId}</code></td><td>{item.sourceKind}</td><td><code>{item.paymentId ?? item.refundId ?? item.sourceIdentity ?? "—"}</code></td><td>{item.disposition}</td><td>{formatMoney(item.amountImpact)}</td><td>{item.reasonCode}</td></tr>)}</tbody></table></div>}</section>
      <section><SectionHeader title="执行记录" />{settlement.executions.length === 0 ? <EmptyBlock title="尚无结算执行" /> : <div className="timeline-list">{settlement.executions.map((item) => <article className="timeline-item" key={item.executionId}><div className="timeline-item__icon"><Send size={16} /></div><div><div className="item-title"><code>{item.executionId}</code><StatusBadge status={item.status} /></div><p>{formatMoney(item.money)} · {item.externalSettlementId ?? "尚无外部结算号"}</p><span>{formatTime(item.submittedAt)} · group {item.executionGroupIdentity ?? "—"} · request {item.requestIdentity ?? "—"} · {item.receipts.length} 个结果收件</span>{item.receipts.map((receipt) => <div className="receipt-row" key={receipt.receiptId}><code>{receipt.resultIdentity}</code><span>{receipt.disposition ?? receipt.outcome ?? "已记录"}</span><span>{receipt.externalTransactionId ?? formatTime(receipt.recordedAt)}</span></div>)}</div></article>)}</div>}</section>
      <section className="panel"><h3>责任字段</h3><div className="form-grid"><label><span>Actor alias</span><input value={responsibility.actorAlias} onChange={(e) => setResponsibility({ ...responsibility, actorAlias: e.target.value })} /></label><label><span>Actor ID</span><input value={responsibility.actorId} onChange={(e) => setResponsibility({ ...responsibility, actorId: e.target.value })} /></label><label><span>Actor role</span><input value={responsibility.actorRole} onChange={(e) => setResponsibility({ ...responsibility, actorRole: e.target.value })} /></label><label><span>幂等键</span><input value={responsibility.idempotencyKey} onChange={(e) => setResponsibility({ ...responsibility, idempotencyKey: e.target.value })} /></label><label className="span-2"><span>原因</span><input value={responsibility.reason} onChange={(e) => setResponsibility({ ...responsibility, reason: e.target.value })} /></label><label className="span-2"><span>证据引用（逗号分隔）</span><input value={responsibility.evidenceRefs} onChange={(e) => setResponsibility({ ...responsibility, evidenceRefs: e.target.value })} /></label></div></section>
      <section><SectionHeader title="确认与执行" /><div className="two-column-layout"><section className="panel"><h3>确认冻结 / 作废 / 替代</h3><InlineNotice>作废与创建替代是两个统一业务动作；页面只按 action descriptor 展示并直接调用所选动作，具体传输组合由适配器完成。</InlineNotice><div className="quick-actions">{findAction(settlement.actions, "CONFIRM_SETTLEMENT") ? <button className="button button--danger" disabled={!canExecute(settlement.actions, "CONFIRM_SETTLEMENT") || execution.busy} type="button" onClick={async () => { if (await confirmAction(findAction(settlement.actions, "CONFIRM_SETTLEMENT"), undefined, confirmationScope)) void execute({ type: "CONFIRM_SETTLEMENT", input: { settlementId: settlement.settlementId, ...responsible() } }, "确认结算", settlement.settlementId); }}>确认并冻结</button> : null}{findAction(settlement.actions, "VOID_SETTLEMENT") ? <button className="button button--danger" disabled={!canExecute(settlement.actions, "VOID_SETTLEMENT") || execution.busy} type="button" onClick={async () => { if (await confirmAction(findAction(settlement.actions, "VOID_SETTLEMENT"), undefined, confirmationScope)) void execute({ type: "VOID_SETTLEMENT", input: { settlementId: settlement.settlementId, ...responsible(token("void")) } }, "作废结算", settlement.settlementId); }}>作废</button> : null}{findAction(settlement.actions, "CREATE_SETTLEMENT_REPLACEMENT") ? <button className="button button--danger" disabled={!canExecute(settlement.actions, "CREATE_SETTLEMENT_REPLACEMENT") || execution.busy} type="button" onClick={async () => { if (await confirmAction(findAction(settlement.actions, "CREATE_SETTLEMENT_REPLACEMENT"), undefined, confirmationScope)) void execute({ type: "CREATE_SETTLEMENT_REPLACEMENT", input: { settlementId: settlement.settlementId, replacementSettlementId: token("replacement"), ...responsible(token("replacement-command")) } }, "创建替代结算", settlement.settlementId); }}>创建替代</button> : null}</div></section>
        <form className="panel form-grid" onSubmit={submitExecution}><h3 className="span-2">执行结算</h3><label><span>期望 Execution ID</span><input required value={executionForm.executionId} onChange={(e) => setExecutionForm({ ...executionForm, executionId: e.target.value })} /></label><label><span>执行渠道</span><input required value={executionForm.channelId} onChange={(e) => setExecutionForm({ ...executionForm, channelId: e.target.value })} /></label><label><span>UNKNOWN 后复核分钟</span><input type="number" value={executionForm.reviewAfterMinutes} onChange={(e) => setExecutionForm({ ...executionForm, reviewAfterMinutes: e.target.value })} /></label><label><span>幂等键</span><input required value={executionForm.idempotencyKey} onChange={(e) => setExecutionForm({ ...executionForm, idempotencyKey: e.target.value })} /></label><button className="button button--primary span-2" disabled={!canExecute(settlement.actions, "EXECUTE_SETTLEMENT") || execution.busy} type="submit">发起新 execution</button><div className="span-2"><InlineNotice>提交后以服务端返回的实际 execution identity 为权威；若实现支持 caller-supplied identity，它应与期望值一致。明确 FAILURE 后才开放新 execution，UNKNOWN 不会开放新执行。</InlineNotice></div></form></div></section>
      <section className="panel action-form"><h3>Reference 结算结果</h3><form className="form-grid" onSubmit={async (e: FormEvent) => { e.preventDefault(); if (!settlement.netAmount || !await confirmAction(findAction(settlement.actions, "RECEIVE_SETTLEMENT_RESULT"), "提交结算结果", confirmationScope)) return; void execute({ type: "RECEIVE_SETTLEMENT_RESULT", input: { resourceType: "SETTLEMENT", resourceId: settlement.settlementId, attemptId: result.attemptId, channelId: result.channelId || settlement.channelId || "", resultIdentity: result.resultIdentity, externalTransactionId: result.externalTransactionId, money: settlement.netAmount, outcome: result.outcome, occurredAt: result.occurredAt, executionGroupIdentity: result.executionGroupIdentity || undefined, requestIdentity: result.requestIdentity || undefined } }, "结算结果", settlement.settlementId); }}>
        <label><span>Execution / Attempt ID</span><select required value={result.attemptId} onChange={(e) => { const selected = settlement.executions.find((item) => item.executionId === e.target.value); setResult({ ...result, attemptId: e.target.value, externalTransactionId: selected?.externalSettlementId ?? result.externalTransactionId, executionGroupIdentity: selected?.executionGroupIdentity ?? result.executionGroupIdentity, requestIdentity: selected?.requestIdentity ?? result.requestIdentity }); }}><option value="">请选择</option>{settlement.executions.map((item) => <option key={item.executionId}>{item.executionId}</option>)}</select></label><label><span>结果</span><select value={result.outcome} onChange={(e) => setResult({ ...result, outcome: e.target.value as ChannelOutcome })}><option>SUCCESS</option><option>FAILURE</option><option>UNKNOWN</option></select></label><label><span>渠道</span><input required value={result.channelId} onChange={(e) => setResult({ ...result, channelId: e.target.value })} /></label><label><span>Result identity</span><input required value={result.resultIdentity} onChange={(e) => setResult({ ...result, resultIdentity: e.target.value })} /></label><label><span>外部结算号（由 execution 预填）</span><input required value={result.externalTransactionId} onChange={(e) => setResult({ ...result, externalTransactionId: e.target.value })} /></label><label><span>发生时间</span><input required value={result.occurredAt} onChange={(e) => setResult({ ...result, occurredAt: e.target.value })} /></label><label><span>Execution group identity</span><input value={result.executionGroupIdentity} onChange={(e) => setResult({ ...result, executionGroupIdentity: e.target.value })} /></label><label><span>Request identity</span><input value={result.requestIdentity} onChange={(e) => setResult({ ...result, requestIdentity: e.target.value })} /></label><button className="button button--danger span-2" disabled={!settlement.netAmount || !canExecute(settlement.actions, "RECEIVE_SETTLEMENT_RESULT") || execution.busy} type="submit">提交结算结果</button>
      </form></section>
    </> : null}
  </div>;
}
