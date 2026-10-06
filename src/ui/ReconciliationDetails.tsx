import type { ReconciliationRun } from "../domain/models";
import { DefinitionList, EmptyBlock, InlineNotice, SectionHeader } from "./components";
import { formatMoney } from "./format";
import { countDescription, filterReconciliationDetails, isMatched, summarizeReconciliation, triState, type DetailFilter } from "./reconciliation-summary";

export function ReconciliationDetails({ run, filter, onFilter, onSelect }: {
  run: ReconciliationRun;
  filter: DetailFilter;
  onFilter: (value: DetailFilter) => void;
  onSelect: (id: string) => void;
}) {
  const summary = summarizeReconciliation(run);
  const items = filterReconciliationDetails(run.differences, filter);
  return <section>
    <SectionHeader title="对账明细" description="匹配分类、处置状态与结算阻断相互独立；筛选不会改变权威对账结果。" />
    <DefinitionList items={[
      { label: "总明细", value: countDescription(summary.total) },
      { label: "匹配", value: countDescription(summary.matched) },
      { label: "真实差异", value: countDescription(summary.differences) },
      { label: "未解决", value: countDescription(summary.unresolved) },
      { label: "阻断明细", value: countDescription(summary.blocking) },
    ]} />
    <div className="quick-actions" role="group" aria-label="对账明细筛选">
      {([["ALL", "全部"], ["DIFFERENCES", "仅差异"], ["MATCHED", "仅匹配"]] as const).map(([value, label]) =>
        <button className="button button--small" type="button" key={value} aria-pressed={filter === value} onClick={() => onFilter(value)}>{label}</button>)}
    </div>
    {run.detailsComplete !== true ? <InlineNotice tone="warning">当前明细完整性未知或不完整；不能将未返回的匹配、差异或阻断数量当作零。</InlineNotice> : null}
    {run.settlementBlocked !== false ? <InlineNotice tone="warning">结算阻断：{triState(run.settlementBlocked, "阻断", "未阻断")}。是否可完成或结算以权威资格与动作裁决为准，不由差异数量推算。</InlineNotice> : null}
    {items.length ? <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>明细 / 证据</th><th>匹配分类</th><th>关联</th><th>平台金额</th><th>渠道金额</th><th>Matching basis</th><th>解决状态</th><th>结算阻断</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.differenceId}>
        <td><button className="button button--small" type="button" onClick={() => onSelect(item.differenceId)}>{item.differenceId}</button></td>
        <td>{isMatched(item) ? "匹配" : item.sourceDifferenceType ?? item.differenceType}</td>
        <td><code>{item.paymentId ?? item.refundId ?? item.externalTransactionId ?? "—"}</code></td>
        <td>{formatMoney(item.platformMoney)}</td><td>{formatMoney(item.channelMoney)}</td>
        <td>{item.matchingBasis ?? "—"}</td>
        <td>{triState(item.resolved, "已解决", "未解决")}</td>
        <td>{triState(item.settlementBlocked, "阻断", "未阻断")}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyBlock title="本筛选下无已返回明细" detail="这不代表该 Run 已通过对账或具备结算资格，请查看上方权威汇总和阻断。" />}
  </section>;
}
