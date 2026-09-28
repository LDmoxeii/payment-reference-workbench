import { useEffect, useState } from "react";
import { Beaker, BookOpenCheck, CreditCard, FileSearch, Landmark, LayoutDashboard, Menu, RefreshCcw, Server, ShieldCheck, X } from "lucide-react";
import type { PaymentWorkbenchService } from "../services/workbench-service";
import { AlignmentPage } from "./pages/AlignmentPage";
import { OverviewPage, type WorkbenchPage } from "./pages/OverviewPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ReconciliationPage } from "./pages/ReconciliationPage";
import { ReferenceLabPage } from "./pages/ReferenceLabPage";
import { RefundsPage } from "./pages/RefundsPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { SettlementsPage } from "./pages/SettlementsPage";

interface Props {
  service: PaymentWorkbenchService;
  recentStore?: unknown;
  config: { apiBaseUrl: string };
}

const nav = [
  { id: "overview" as const, label: "首页", icon: LayoutDashboard },
  { id: "payments" as const, label: "支付", icon: CreditCard },
  { id: "refunds" as const, label: "退款", icon: RefreshCcw },
  { id: "reconciliation" as const, label: "对账", icon: FileSearch },
  { id: "settlements" as const, label: "结算", icon: Landmark },
  { id: "reviews" as const, label: "人工核对", icon: ShieldCheck },
  { id: "reference" as const, label: "Reference Lab", icon: Beaker },
  { id: "alignment" as const, label: "实现对照", icon: BookOpenCheck },
];

function initialPage(): WorkbenchPage {
  const page = window.location.hash.replace("#", "") as WorkbenchPage;
  return nav.some((item) => item.id === page) ? page : "overview";
}

export function WorkbenchApp({ service, config }: Props) {
  const [page, setPage] = useState<WorkbenchPage>(initialPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paymentId] = useState<string>();
  const [refundId] = useState<string>();
  function navigate(next: WorkbenchPage) { setPage(next); window.location.hash = next; setMobileOpen(false); }
  useEffect(() => { const onHash = () => setPage(initialPage()); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);

  return <div className="app-shell"><aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}><div className="brand"><div className="brand__mark"><CreditCard size={21} /></div><div><strong>支付参考工作台</strong><span>Unified Payment Reference</span></div><button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} title="关闭导航"><X size={20} /></button></div>
    <nav>{nav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
    <div className="sidebar__connection"><Server size={17} /><div><strong>{service.profile.label}</strong><span>{config.apiBaseUrl}</span></div></div></aside>
    {mobileOpen ? <button className="sidebar-backdrop" type="button" aria-label="关闭导航" onClick={() => setMobileOpen(false)} /> : null}
    <main className="main-area"><header className="topbar"><button type="button" className="menu-button" onClick={() => setMobileOpen(true)} title="打开导航"><Menu size={20} /></button><div><span className="topbar__context">{nav.find((item) => item.id === page)?.label}</span><strong>统一业务契约 · {service.profile.label}</strong></div><span className="environment-badge">REFERENCE</span></header><div className="page-container">
      {page === "overview" ? <OverviewPage service={service} onNavigate={navigate} /> : null}
      {page === "payments" ? <PaymentsPage service={service} initialId={paymentId} /> : null}
      {page === "refunds" ? <RefundsPage service={service} initialId={refundId} /> : null}
      {page === "reconciliation" ? <ReconciliationPage service={service} /> : null}
      {page === "settlements" ? <SettlementsPage service={service} /> : null}
      {page === "reviews" ? <ReviewsPage service={service} /> : null}
      {page === "reference" ? <ReferenceLabPage service={service} /> : null}
      {page === "alignment" ? <AlignmentPage service={service} /> : null}
    </div></main>
  </div>;
}
