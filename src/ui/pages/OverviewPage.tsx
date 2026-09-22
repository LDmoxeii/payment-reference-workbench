import { useEffect, useState } from "react";
import { Activity, ArrowRight, BookOpenCheck, CreditCard, Landmark, RefreshCcw, Server, Trash2 } from "lucide-react";
import type { HealthStatus, RecentRecord } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { EmptyBlock, ErrorBlock, LoadingBlock, RecentLink, SectionHeader, StatusBadge } from "../components";

interface Props {
  service: PaymentWorkbenchService;
  recent: RecentRecord[];
  onNavigate: (page: "payments" | "refunds" | "operations" | "alignment", resource?: RecentRecord) => void;
  onRemoveRecent: (record: RecentRecord) => void;
  onClearRecent: () => void;
}

export function OverviewPage({ service, recent, onNavigate, onRemoveRecent, onClearRecent }: Props) {
  const [health, setHealth] = useState<HealthStatus>();
  const [error, setError] = useState<unknown>();

  const checkHealth = () => {
    setError(undefined);
    setHealth(undefined);
    void service.health().then(setHealth).catch(setError);
  };

  useEffect(checkHealth, [service]);
  const fullCapabilities = service.profile.capabilities.filter((item) => item.level === "full").length;
  const gaps = service.profile.capabilities.filter((item) => item.level === "unavailable").length;

  return (
    <div className="page-stack">
      <section className="overview-band">
        <div>
          <p className="eyebrow">统一业务工作台</p>
          <h1>支付到结算的业务事实</h1>
          <p>当前连接 <strong>{service.profile.label}</strong>。业务页面保持一致，源实现差异由能力和动作声明呈现。</p>
        </div>
        <div className="connection-summary">
          <Server size={22} />
          <div><span>连接状态</span>{health ? <StatusBadge status={health.status === "connected" ? "SUCCEEDED" : "FAILED"} /> : <span>检查中</span>}</div>
          <code>{service.profile.apiBaseUrl}</code>
        </div>
      </section>

      {error ? <ErrorBlock error={error} onRetry={checkHealth} /> : !health ? <LoadingBlock label="正在检查后端连接" /> : health.status !== "connected" ? <ErrorBlock error={new Error(health.message ?? "后端不可达")} onRetry={checkHealth} /> : null}

      <section>
        <SectionHeader title="业务入口" />
        <div className="workflow-grid">
          <button type="button" className="workflow-card" onClick={() => onNavigate("payments")}><CreditCard /><span><strong>支付受理</strong><small>创建、尝试与渠道结果</small></span><ArrowRight size={18} /></button>
          <button type="button" className="workflow-card" onClick={() => onNavigate("refunds")}><RefreshCcw /><span><strong>退款处理</strong><small>申请、结果与预算占用</small></span><ArrowRight size={18} /></button>
          <button type="button" className="workflow-card" onClick={() => onNavigate("operations")}><Landmark /><span><strong>平台运营</strong><small>对账、结算与人工动作</small></span><ArrowRight size={18} /></button>
          <button type="button" className="workflow-card" onClick={() => onNavigate("alignment")}><BookOpenCheck /><span><strong>能力对照</strong><small>目标、现状与后端迭代</small></span><ArrowRight size={18} /></button>
        </div>
      </section>

      <section className="metric-band">
        <div><Activity size={20} /><span>完整能力</span><strong>{fullCapabilities}</strong></div>
        <div><RefreshCcw size={20} /><span>部分能力</span><strong>{service.profile.capabilities.filter((item) => item.level === "partial").length}</strong></div>
        <div><BookOpenCheck size={20} /><span>待对齐</span><strong>{gaps}</strong></div>
      </section>

      <section>
        <SectionHeader title="本地最近记录" description="仅保存本浏览器访问过的标识，不代表后端全量数据。" action={recent.length > 0 ? <button className="button button--small" type="button" onClick={onClearRecent}><Trash2 size={15} />清空当前后端记录</button> : undefined} />
        <div className="recent-list">
          {recent.length === 0 ? <EmptyBlock title="暂无最近记录" detail="创建或按 ID 查询后会出现在这里。" /> : recent.slice(0, 8).map((record) => (
            <RecentLink key={`${record.resourceType}:${record.id}`} label={record.label} id={record.id} status={record.status} onOpen={() => onNavigate(record.resourceType === "payment" ? "payments" : record.resourceType === "refund" ? "refunds" : "operations", record)} onRemove={() => onRemoveRecent(record)} />
          ))}
        </div>
      </section>
    </div>
  );
}
