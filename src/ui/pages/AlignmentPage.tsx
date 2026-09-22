import { CheckCircle2, CircleDot, TriangleAlert } from "lucide-react";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { alignmentItems } from "../../data/alignment";
import { SectionHeader } from "../components";

export function AlignmentPage({ service }: { service: PaymentWorkbenchService }) {
  return (
    <div className="page-stack">
      <SectionHeader title="业务能力对照" description="统一业务诉求是目标，后端现状决定当前动作是否可执行。" />
      <section className="capability-strip" aria-label="当前适配器能力摘要">
        {service.profile.capabilities.map((capability) => (
          <div key={capability.id} className={`capability-chip capability-chip--${capability.level}`} title={capability.reason}>
            {capability.level === "full" ? <CheckCircle2 size={15} /> : capability.level === "partial" ? <CircleDot size={15} /> : <TriangleAlert size={15} />}
            <span>{capability.id}</span>
          </div>
        ))}
      </section>

      <section className="alignment-table-wrap">
        <table className="alignment-table">
          <thead><tr><th>业务主题</th><th>目标业务语义</th><th>WOW 当前</th><th>CAP4K 当前</th><th>工作台处理</th><th>后端后续迭代</th></tr></thead>
          <tbody>{alignmentItems.map((item) => (
            <tr key={item.topic}>
              <th><span className={`priority priority--${item.priority.toLowerCase()}`}>{item.priority}</span>{item.topic}</th>
              <td>{item.target}</td><td>{item.wow}</td><td>{item.cap4k}</td><td>{item.workbench}</td><td>{item.followUp}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
