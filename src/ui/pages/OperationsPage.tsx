import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileJson2, Landmark, Play, RefreshCw, Search, Settings2 } from "lucide-react";
import { minorToDecimal } from "../../domain/money";
import type { ActionDescriptor, ActionKind, RecentRecord, Reconciliation, Settlement } from "../../domain/models";
import { resolveReconciliationReceipt, resolveSettlementReceipt, type PaymentWorkbenchService } from "../../services/workbench-service";
import { confirmAction, receiptNotice } from "../action-utils";
import { DefinitionList, EmptyBlock, ErrorBlock, InlineNotice, LoadingBlock, RecentLink, SectionHeader, SourceDetails, StatusBadge } from "../components";
import { formatMoney } from "../format";

interface Props {
  service: PaymentWorkbenchService;
  recent: RecentRecord[];
  initialRecord?: RecentRecord;
  onRemember: (record: Omit<RecentRecord, "accessedAt" | "backendId">) => void;
}

type ResourceMode = "reconciliation" | "settlement";

export function OperationsPage({ service, recent, initialRecord, onRemember }: Props) {
  const [mode, setMode] = useState<ResourceMode>(initialRecord?.resourceType === "settlement" ? "settlement" : "reconciliation");
  const [lookupId, setLookupId] = useState(initialRecord?.id ?? "");
  const [reconciliation, setReconciliation] = useState<Reconciliation>();
  const [settlement, setSettlement] = useState<Settlement>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [actionKind, setActionKind] = useState<ActionKind>();
  const [actionResourceId, setActionResourceId] = useState("");
  const [payload, setPayload] = useState("{}");

  const quickActions = useMemo(() => Array.from(new Set(service.profile.capabilities.flatMap((item) => item.level !== "unavailable" ? item.actions ?? [] : []))).filter((kind) => operationAction(kind)), [service]);

  useEffect(() => { if (initialRecord && initialRecord.id !== lookupId) { const next = initialRecord.resourceType === "settlement" ? "settlement" : "reconciliation"; setMode(next); setLookupId(initialRecord.id); void load(next, initialRecord.id); } }, [initialRecord]);

  async function load(nextMode = mode, id = lookupId) {
    if (!id.trim()) return;
    setLoading(true); setError(undefined); setNotice(undefined);
    try {
      if (nextMode === "reconciliation") {
        const value = await service.getReconciliation(id.trim()); setReconciliation(value); setSettlement(undefined); setLookupId(value.id);
        onRemember({ resourceType: "reconciliation", id: value.id, label: `${value.channelId} · ${value.reconciliationDate ?? value.id}`, status: value.status });
      } else {
        const value = await service.getSettlement(id.trim()); setSettlement(value); setReconciliation(undefined); setLookupId(value.id);
        onRemember({ resourceType: "settlement", id: value.id, label: `${value.merchantId} · ${value.currency}`, status: value.status });
      }
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  function openAction(kind: ActionKind, resourceId?: string) {
    setActionKind(kind);
    const id = resourceId ?? (kind === "DISPOSE_RECONCILIATION_DIFFERENCE" ? reconciliation?.items.find((item) => !item.resolved)?.id : reconciliation?.id ?? settlement?.id ?? "");
    setActionResourceId(id ?? "");
    setPayload(JSON.stringify(defaultPayload(kind, reconciliation, settlement), null, 2));
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault(); if (!actionKind) return;
    const descriptor = currentActions.find((item) => item.kind === actionKind) ?? quickActionDescriptor(actionKind);
    if (!confirmAction(descriptor)) return;
    setLoading(true); setError(undefined);
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      const receipt = await service.executeAction({ kind: actionKind, resourceId: actionResourceId || undefined, payload: body });
      setNotice(`操作已受理：${receipt.resourceId}，正在读取最新业务状态。`); setActionKind(undefined);
      onRemember({ resourceType: receipt.resourceType, id: receipt.resourceId, label: actionLabel(actionKind), status: receipt.sourceStatus ?? undefined });
      if (receipt.resourceType === "reconciliation") {
        const resolution = await resolveReconciliationReceipt(service, receipt);
        if (resolution.resource) {
          setReconciliation(resolution.resource); setSettlement(undefined); setMode("reconciliation"); setLookupId(resolution.resource.id);
          onRemember({ resourceType: "reconciliation", id: resolution.resource.id, label: `${resolution.resource.channelId} · ${resolution.resource.reconciliationDate ?? resolution.resource.id}`, status: resolution.resource.status });
        }
        setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
      } else if (receipt.resourceType === "settlement") {
        const resolution = await resolveSettlementReceipt(service, receipt);
        if (resolution.resource) {
          setSettlement(resolution.resource); setReconciliation(undefined); setMode("settlement"); setLookupId(resolution.resource.id);
          onRemember({ resourceType: "settlement", id: resolution.resource.id, label: `${resolution.resource.merchantId} · ${resolution.resource.currency}`, status: resolution.resource.status });
        }
        setNotice(receiptNotice(resolution.settled, resolution.resource?.status));
      }
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }

  const currentActions: ActionDescriptor[] = reconciliation?.actions ?? settlement?.actions ?? [];

  return (
    <div className="page-stack">
      <SectionHeader title="平台运营" description="查询对账与结算事实，并执行当前后端公开的运营动作。" action={<div className="segmented"><button type="button" className={mode === "reconciliation" ? "active" : ""} onClick={() => { setMode("reconciliation"); setLookupId(""); }}>对账</button><button type="button" className={mode === "settlement" ? "active" : ""} onClick={() => { setMode("settlement"); setLookupId(""); }}>结算</button></div>} />
      <div className="two-column-layout">
        <section className="panel"><h3><Search size={18} /> 按 ID 查询{mode === "reconciliation" ? "对账批次" : "结算单"}</h3><form className="lookup-form" onSubmit={(event) => { event.preventDefault(); void load(); }}><input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder={mode === "reconciliation" ? "Reconciliation Batch ID" : "Settlement ID"} /><button className="button" type="submit"><Search size={17} />查询</button></form><div className="compact-recent">{recent.filter((item) => item.resourceType === mode).slice(0, 4).map((item) => <RecentLink key={item.id} label={item.label} id={item.id} status={item.status} onOpen={() => { setLookupId(item.id); void load(mode, item.id); }} />)}</div></section>
        <section className="panel"><h3><Settings2 size={18} /> 可直接发起的运营动作</h3><div className="quick-actions">{quickActions.length === 0 ? <EmptyBlock title="当前适配器没有直接运营入口" /> : quickActions.map((kind) => <button className="button button--small" type="button" key={kind} onClick={() => openAction(kind)}><Play size={15} />{actionLabel(kind)}</button>)}</div></section>
      </div>
      {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
      {error ? <ErrorBlock error={error} /> : null}
      {loading ? <LoadingBlock /> : null}

      {reconciliation ? <>
        <section className="detail-heading"><div><span>对账批次</span><h2 className="mono-title">{reconciliation.id}</h2></div><div><StatusBadge status={reconciliation.status} /><button className="icon-button" type="button" onClick={() => void load("reconciliation", reconciliation.id)} title="刷新"><RefreshCw size={17} /></button></div></section>
        <section className="detail-band"><DefinitionList items={[{ label: "渠道", value: reconciliation.channelId }, { label: "币种", value: reconciliation.currency }, { label: "对账日", value: reconciliation.reconciliationDate ?? "—" }, { label: "账单", value: <code>{reconciliation.statementId ?? "—"}</code> }, { label: "Revision", value: String(reconciliation.revision ?? "—") }, { label: "结算阻断", value: reconciliation.settlementBlocked == null ? "未知" : reconciliation.settlementBlocked ? "已阻断" : "未阻断" }, { label: "阻断原因", value: reconciliation.blockingReason ?? "—" }]} /><SourceDetails source={reconciliation.source} /></section>
        <section><SectionHeader title="对账明细" description={`${reconciliation.items.length} 条`} /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>标识</th><th>类型</th><th>业务对象</th><th>金额</th><th>解决</th><th>结算</th></tr></thead><tbody>{reconciliation.items.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td>{item.differenceType}</td><td><code>{item.paymentId ?? item.refundId ?? "—"}</code></td><td>{formatMoney(item.amount)}</td><td>{item.resolved ? "已解决" : "未解决"}</td><td>{item.settlementBlocked ? "阻断" : "可继续"}</td></tr>)}</tbody></table></div></section>
      </> : null}

      {settlement ? <>
        <section className="detail-heading"><div><span>商户结算单</span><h2 className="mono-title">{settlement.id}</h2></div><div><StatusBadge status={settlement.status} /><button className="icon-button" type="button" onClick={() => void load("settlement", settlement.id)} title="刷新"><RefreshCw size={17} /></button></div></section>
        <section className="detail-band"><DefinitionList items={[{ label: "商户", value: settlement.merchantId }, { label: "渠道", value: settlement.channelId }, { label: "币种", value: settlement.currency }, { label: "周期", value: `${settlement.periodStart ?? "—"} 至 ${settlement.periodEnd ?? "—"}` }, { label: "支付收入", value: formatMoney(settlement.paymentGrossAmount) }, { label: "退款扣减", value: formatMoney(settlement.refundGrossAmount) }, { label: "手续费", value: formatMoney(settlement.feeTotalAmount) }, { label: "调整", value: formatMoney(settlement.adjustmentTotalAmount) }, { label: "净结算", value: formatMoney(settlement.netAmount) }, { label: "阻断", value: settlement.blockerSummary ?? "—" }]} /><SourceDetails source={settlement.source} /></section>
        <section><SectionHeader title="结算明细" description={`${settlement.lines.length} 条`} /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>行标识</th><th>来源</th><th>业务对象</th><th>毛额</th><th>费用</th><th>净影响</th></tr></thead><tbody>{settlement.lines.map((line) => <tr key={line.id}><td><code>{line.id}</code></td><td>{line.sourceKind ?? "—"}</td><td><code>{line.paymentId ?? line.refundId ?? "—"}</code></td><td>{formatMoney(line.grossAmount)}</td><td>{formatMoney(line.feeAmount)}</td><td>{formatMoney(line.signedNetAmount)}</td></tr>)}</tbody></table></div></section>
      </> : null}

      {currentActions.length > 0 ? <section><SectionHeader title="当前可执行动作" /><div className="action-grid">{currentActions.map((item) => <div key={item.kind} className={`action-item ${item.executable ? "" : "action-item--disabled"}`}><div><strong>{item.label}</strong><span>{item.executable ? "当前可执行" : item.reason}</span></div>{item.executable ? <button type="button" className="button button--small" onClick={() => openAction(item.kind)}><Play size={15} />执行</button> : null}</div>)}</div></section> : null}

      {!loading && !reconciliation && !settlement ? <EmptyBlock title="尚未选择运营对象" detail="按 ID 查询，或使用当前适配器公开的直接运营动作。" /> : null}

      {actionKind ? <section className="panel action-form"><h3><FileJson2 size={18} /> {actionLabel(actionKind)}</h3><form className="form-grid" onSubmit={submitAction}><label className="span-2"><span>目标资源 ID</span><input value={actionResourceId} onChange={(e) => setActionResourceId(e.target.value)} placeholder="不需要路径资源的操作可留空" /></label><label className="span-2"><span>业务参数</span><textarea rows={12} value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} /></label><div className="form-actions span-2"><button className="button" type="button" onClick={() => setActionKind(undefined)}>取消</button><button className="button button--danger" type="submit"><Play size={16} />确认执行</button></div></form></section> : null}
    </div>
  );
}

function operationAction(kind: ActionKind): boolean {
  return !["START_PAYMENT_ATTEMPT", "SUBMIT_PAYMENT_RESULT", "EXPIRE_PAYMENT", "ADJUDICATE_PAYMENT", "CREATE_REFUND", "SUBMIT_REFUND_RESULT", "ADJUDICATE_REFUND", "GET_PAYMENT_TRACE"].includes(kind);
}

function actionLabel(kind: ActionKind): string {
  return ({ RERUN_RECONCILIATION: "重跑对账", DISPOSE_RECONCILIATION_DIFFERENCE: "处置对账差异", REGISTER_AUTHORITATIVE_STATEMENT: "登记权威账单", MARK_BILL_AVAILABLE: "通知账单可用", GENERATE_SETTLEMENT: "生成结算单", REPLACE_SETTLEMENT: "创建替代结算", ADJUDICATE_SETTLEMENT: "裁决结算复核", PREPARE_SETTLEMENT: "准备结算", CONFIRM_SETTLEMENT: "确认结算", START_SETTLEMENT_EXECUTION: "发起结算执行", SUBMIT_SETTLEMENT_RESULT: "提交结算结果", VOID_SETTLEMENT: "作废结算单" } as Partial<Record<ActionKind, string>>)[kind] ?? kind;
}

function defaultPayload(kind: ActionKind, reconciliation?: Reconciliation, settlement?: Settlement): Record<string, unknown> {
  const now = new Date(); const today = now.toISOString().slice(0, 10); const identity = crypto.randomUUID().slice(0, 8);
  switch (kind) {
    case "REGISTER_AUTHORITATIVE_STATEMENT": return { statementId: `statement-${identity}`, revision: 1, channelId: "fake", currency: "CNY", reconciliationDate: today, businessTimezone: "Asia/Shanghai", records: [] };
    case "MARK_BILL_AVAILABLE": return { statementId: reconciliation?.statementId ?? `statement-${identity}`, revision: Number(reconciliation?.revision ?? 1) };
    case "RERUN_RECONCILIATION": return { requestedBy: "operator-001", requestedAt: now.toISOString() };
    case "DISPOSE_RECONCILIATION_DIFFERENCE": return { batchId: reconciliation?.id ?? "", merchantId: null, channelId: reconciliation?.channelId ?? "C-001", operatorIdentity: "operator-001", operatorRole: "PLATFORM_OPERATOR", conclusion: "CONFIRMED_PLATFORM_FACT", settlementImpact: "ALLOW", evidence: "reference evidence", followUp: null, disposedAt: now.toISOString() };
    case "GENERATE_SETTLEMENT": return { merchantId: "reference-merchant", currency: "CNY", channelId: "fake", reconciliationDate: today, businessTimezone: "Asia/Shanghai", settlementId: `settlement-${identity}`, result: "SUCCEEDED" };
    case "REPLACE_SETTLEMENT": return { replacementSettlementId: `settlement-replacement-${identity}`, reason: "依据修正后的对账事实替代", result: "SUCCEEDED" };
    case "ADJUDICATE_SETTLEMENT": return { attemptId: null, decisionIdentity: `decision-${identity}`, decision: "CONFIRM_FAILURE", evidence: "reference evidence", externalSettlementIdentity: "" };
    case "PREPARE_SETTLEMENT": return { merchantId: "reference-merchant", channelId: "C-001", currency: "CNY", settlementDate: today, requestedBy: "operator-001", requestedAt: now.toISOString() };
    case "CONFIRM_SETTLEMENT": return { operatorIdentity: "finance-001", operatorRole: "PLATFORM_FINANCE", confirmedAt: now.toISOString() };
    case "START_SETTLEMENT_EXECUTION": return { operatorIdentity: "finance-001", operatorRole: "PLATFORM_FINANCE", requestedAt: now.toISOString() };
    case "SUBMIT_SETTLEMENT_RESULT": return { channelId: "C-001", notificationId: `settlement-notice-${identity}`, settlementId: settlement?.id ?? "", executionAttemptId: "", executionGroupIdentity: "", requestIdentity: "", externalSettlementIdentity: `external-settlement-${identity}`, amount: settlement?.netAmount ? minorToDecimal(settlement.netAmount.minorAmount, settlement.currency) : "0.00", currency: settlement?.currency ?? "CNY", result: "SUCCESS", resultCode: null, occurredAt: now.toISOString(), receivedAt: now.toISOString() };
    case "VOID_SETTLEMENT": return { operatorIdentity: "finance-001", operatorRole: "PLATFORM_FINANCE", reason: "reference controlled void", voidedAt: now.toISOString(), createReplacement: true };
    default: return {};
  }
}

function quickActionDescriptor(kind: ActionKind): ActionDescriptor {
  return { kind, label: actionLabel(kind), executable: true, confirmation: "danger", refresh: "read_once" };
}
