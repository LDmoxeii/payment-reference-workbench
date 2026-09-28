import { useEffect, useState } from "react";
import { Activity, ArrowRight, Beaker, BookOpenCheck, CreditCard, FileSearch, Landmark, RefreshCcw, Server, ShieldCheck } from "lucide-react";
import type { HealthStatus, ReferenceEnvironment } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { DefinitionList, ErrorBlock, LoadingBlock, SectionHeader, StatusBadge } from "../components";
import { formatTime } from "../format";

export type WorkbenchPage = "overview" | "payments" | "refunds" | "reconciliation" | "settlements" | "reviews" | "reference" | "alignment";

export function OverviewPage({ service, onNavigate }: { service: PaymentWorkbenchService; onNavigate: (page: WorkbenchPage) => void }) {
  const [health, setHealth] = useState<HealthStatus>();
  const [environment, setEnvironment] = useState<ReferenceEnvironment>();
  const [error, setError] = useState<unknown>();

  function refresh() {
    setError(undefined); setHealth(undefined);
    void Promise.all([service.health(), service.getReferenceEnvironment()]).then(([nextHealth, nextEnvironment]) => { setHealth(nextHealth); setEnvironment(nextEnvironment); }).catch(setError);
  }
  useEffect(refresh, [service]);

  const entries: Array<{ page: WorkbenchPage; title: string; detail: string; icon: typeof CreditCard }> = [
    { page: "payments", title: "支付", detail: "意图、attempt、渠道结果与 timeline", icon: CreditCard },
    { page: "refunds", title: "退款", detail: "预算预占、attempt 与结果收敛", icon: RefreshCcw },
    { page: "reconciliation", title: "对账", detail: "账单 revision、差异与事实确认", icon: FileSearch },
    { page: "settlements", title: "结算", detail: "准备、冻结、执行、作废与替代", icon: Landmark },
    { page: "reviews", title: "人工核对", detail: "责任处置、证据与通知投递", icon: ShieldCheck },
    { page: "reference", title: "Reference Lab", detail: "fixture、policy、时钟与异常场景", icon: Beaker },
    { page: "alignment", title: "实现对照", detail: "统一语义与两种框架实现方式", icon: BookOpenCheck },
  ];

  return <div className="page-stack">
    <section className="overview-band"><div><p className="eyebrow">统一业务工作台</p><h1>从支付意图到结算事实</h1><p>页面只使用统一业务契约。当前实现的传输与框架差异由适配层封装，不改变业务流程。</p></div><div className="connection-summary"><Server size={22} /><div><span>连接状态</span>{health ? <StatusBadge status={health.status === "connected" ? "SUCCEEDED" : health.status === "degraded" ? "REVIEW_REQUIRED" : "FAILED"} /> : <span>检查中</span>}</div><code>{service.profile.label} · {service.profile.apiBaseUrl}</code></div></section>
    {error ? <ErrorBlock error={error} onRetry={refresh} /> : !health ? <LoadingBlock label="正在检查业务服务与 reference 环境" /> : null}
    {health ? <section className="detail-band"><DefinitionList items={[
      { label: "服务", value: service.profile.label }, { label: "健康检查", value: health.message }, { label: "检查时间", value: formatTime(health.checkedAt) },
      { label: "Fixture", value: <code>{environment?.fixtureId ?? "—"}</code> }, { label: "逻辑时钟", value: formatTime(environment?.currentTime) },
      { label: "默认商户", value: <code>{environment?.merchantId ?? "—"}</code> }, { label: "默认渠道", value: <code>{environment?.channelId ?? "—"}</code> },
      { label: "Actor alias", value: <code>{environment?.actorAlias ?? "—"}</code> },
    ]} /></section> : null}
    <section><SectionHeader title="业务地图" description="按商户操作、渠道/fixture 实验与平台运营组织；列表均来自后端权威查询。" /><div className="workflow-grid">{entries.map((entry) => { const Icon = entry.icon; return <button type="button" className="workflow-card" key={entry.page} onClick={() => onNavigate(entry.page)}><Icon /><span><strong>{entry.title}</strong><small>{entry.detail}</small></span><ArrowRight size={18} /></button>; })}</div></section>
    <section className="metric-band"><div><Activity size={20} /><span>统一业务能力</span><strong>{service.profile.capabilities.length}</strong></div><div><Server size={20} /><span>适配器隔离</span><strong>100%</strong></div><div><BookOpenCheck size={20} /><span>学习环境</span><strong>REFERENCE</strong></div></section>
  </div>;
}
