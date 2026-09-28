import { CheckCircle2, CircleSlash2, Layers3, Route, ShieldAlert } from "lucide-react";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { SectionHeader } from "../components";

const transportDifferences = [
  ["权威列表", "统一 Page、filters 与 opaque cursor", "GET 列表 + query parameters", "POST .../search + request body"],
  ["Operation receipt", "统一 resource ref 与 readAfter", "平铺 resourceType/resourceId，按 POLL 收敛", "嵌套 resource，READ_ONCE/事务 Operation"],
  ["责任人上下文", "统一 actor alias / ID / role / reason / evidence", "公开命令 body 映射", "可信 X-Reference-Actor-Context 映射"],
  ["渠道回调证据", "前端不提交 verified，服务端派生可信结论", "fixture token", "callback-evidence registry"],
  ["Payment timeline", "统一稳定排序的 TimelineEntry", "trace route", "timeline route"],
  ["结算作废与替代", "统一 void 与 replacement 两个业务动作", "独立命令", "组合 createReplacement 传输"],
];

export function AlignmentPage({ service }: { service: PaymentWorkbenchService }) {
  return <div className="page-stack"><SectionHeader title="统一业务语义与实现对照" description="统一业务目标不缩减；完整传输、替代实验路径和当前不可用的独立传输会被如实标注。" />
    <section className="capability-strip" aria-label="统一能力摘要">{service.profile.capabilities.map((item) => { const Icon = item.level === "full" ? CheckCircle2 : item.level === "alternative" ? Route : CircleSlash2; return <div key={item.id} className={`capability-chip capability-chip--${item.level}`} title={item.alternative ?? item.description}><Icon size={15} /><span>{item.label} · {item.level === "full" ? "完整" : item.level === "alternative" ? "替代路径" : "不可用"}</span></div>; })}</section>
    <section><SectionHeader title="同一业务，两种实现" /><div className="alignment-table-wrap"><table className="alignment-table"><thead><tr><th>主题</th><th>统一业务语义</th><th>WOW 实现</th><th>CAP4K 实现</th></tr></thead><tbody>{transportDifferences.map((row) => <tr key={row[0]}><th>{row[0]}</th><td>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td></tr>)}</tbody></table></div></section>
    {service.profile.implementationDifferences.length > 0 ? <section><SectionHeader title="当前适配器实现说明" /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>主题</th><th>统一含义</th><th>当前实现</th></tr></thead><tbody>{service.profile.implementationDifferences.map((item) => <tr key={item.topic}><td>{item.topic}</td><td>{item.unifiedMeaning}</td><td>{item.implementation}</td></tr>)}</tbody></table></div></section> : null}
    <section className="two-column-layout"><article className="panel"><h3><Layers3 size={18} />本轮学习版完整语义</h3><p>支付/退款 attempt、可信收件、退款预算、账单 revision、对账阻断、结算冻结与防重付、人工责任、通知 identity、五类权威列表和完整 timeline 都属于核心业务。</p></article><article className="panel"><h3><ShieldAlert size={18} />后续生产强化边界</h3><p>认证授权、生产数据库与迁移、Outbox/Inbox、多实例锁、真实渠道/账单/资金移动、生产安全网关与长期审计，不在 reference 学习版范围内。</p></article></section>
  </div>;
}
