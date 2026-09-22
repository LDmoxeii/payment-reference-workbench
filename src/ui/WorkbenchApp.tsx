import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CreditCard, LayoutDashboard, Landmark, Menu, RefreshCcw, Server, X } from "lucide-react";
import type { BackendId, RecentRecord } from "../domain/models";
import type { RecentStore } from "../services/recent-store";
import type { PaymentWorkbenchService } from "../services/workbench-service";
import { OverviewPage } from "./pages/OverviewPage";
import { AlignmentPage } from "./pages/AlignmentPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { RefundsPage } from "./pages/RefundsPage";
import { OperationsPage } from "./pages/OperationsPage";

type PageId = "overview" | "payments" | "refunds" | "operations" | "alignment";

interface Props {
  service: PaymentWorkbenchService;
  recentStore: RecentStore;
  config: { backend: BackendId; apiBaseUrl: string };
}

const nav = [
  { id: "overview" as const, label: "工作台", icon: LayoutDashboard },
  { id: "payments" as const, label: "支付", icon: CreditCard },
  { id: "refunds" as const, label: "退款", icon: RefreshCcw },
  { id: "operations" as const, label: "运营", icon: Landmark },
  { id: "alignment" as const, label: "能力对照", icon: BookOpenCheck },
];

function initialPage(): PageId {
  const page = window.location.hash.replace("#", "") as PageId;
  return nav.some((item) => item.id === page) ? page : "overview";
}

export function WorkbenchApp({ service, recentStore, config }: Props) {
  const [page, setPage] = useState<PageId>(initialPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [paymentId, setPaymentId] = useState<string>();
  const [refundId, setRefundId] = useState<string>();
  const [operationRecord, setOperationRecord] = useState<RecentRecord>();
  const recent = useMemo(() => recentStore.list(config.backend), [recentStore, config.backend, revision]);

  const navigate = (next: PageId, resource?: RecentRecord) => {
    if (resource?.resourceType === "payment") setPaymentId(resource.id);
    if (resource?.resourceType === "refund") setRefundId(resource.id);
    if (resource && (resource.resourceType === "reconciliation" || resource.resourceType === "settlement")) setOperationRecord(resource);
    setPage(next);
    window.location.hash = next;
    setMobileOpen(false);
  };

  useEffect(() => {
    const onHash = () => setPage(initialPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const remember = (record: Omit<RecentRecord, "accessedAt" | "backendId">) => {
    recentStore.remember({ ...record, backendId: config.backend });
    setRevision((value) => value + 1);
  };

  const removeRecent = (record: RecentRecord) => {
    recentStore.remove(config.backend, record.resourceType, record.id);
    setRevision((value) => value + 1);
  };

  const clearRecent = () => {
    if (!window.confirm(`清空 ${service.profile.label} 的本地最近记录？\n\n这不会删除后端业务数据。`)) return;
    recentStore.clear(config.backend);
    setRevision((value) => value + 1);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <div className="brand"><div className="brand__mark"><CreditCard size={21} /></div><div><strong>支付参考工作台</strong><span>Payment Reference</span></div><button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} title="关闭导航"><X size={20} /></button></div>
        <nav>{nav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
        <div className="sidebar__connection"><Server size={17} /><div><strong>{service.profile.label}</strong><span>{config.apiBaseUrl}</span></div></div>
      </aside>
      {mobileOpen ? <button className="sidebar-backdrop" type="button" aria-label="关闭导航" onClick={() => setMobileOpen(false)} /> : null}
      <main className="main-area">
        <header className="topbar"><button type="button" className="menu-button" onClick={() => setMobileOpen(true)} title="打开导航"><Menu size={20} /></button><div><span className="topbar__context">{nav.find((item) => item.id === page)?.label}</span><strong>{service.profile.label}</strong></div><span className="environment-badge">REFERENCE</span></header>
        <div className="page-container">
          {page === "overview" ? <OverviewPage service={service} recent={recent} onNavigate={(next, resource) => navigate(next, resource)} onRemoveRecent={removeRecent} onClearRecent={clearRecent} /> : null}
          {page === "payments" ? <PaymentsPage service={service} recent={recent.filter((item) => item.resourceType === "payment")} initialId={paymentId} onRemember={remember} onOpenRefund={(id) => { setRefundId(id); navigate("refunds"); }} /> : null}
          {page === "refunds" ? <RefundsPage service={service} recent={recent.filter((item) => item.resourceType === "refund")} initialId={refundId} onRemember={remember} /> : null}
          {page === "operations" ? <OperationsPage service={service} recent={recent.filter((item) => item.resourceType === "reconciliation" || item.resourceType === "settlement")} initialRecord={operationRecord} onRemember={remember} /> : null}
          {page === "alignment" ? <AlignmentPage service={service} /> : null}
        </div>
      </main>
    </div>
  );
}
