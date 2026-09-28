import { type FormEvent, useEffect, useRef, useState } from "react";
import { Beaker, Clock3, FilePlus2, RefreshCw, Settings2 } from "lucide-react";
import { createMoney, decimalToMinor } from "../../domain/money";
import type { CapabilityDeclaration, ReferenceCommand, ReferenceCommandResult, ReferenceEnvironment } from "../../domain/models";
import type { PaymentWorkbenchService } from "../../services/workbench-service";
import { token } from "../action-utils";
import { DefinitionList, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader } from "../components";
import { formatTime } from "../format";
import { referenceBusinessDate, referenceInstant } from "../reference-time";

type ScriptKind = "channel-script" | "bill-read-script" | "notification-sender-script" | "settlement-executor-script";

function CapabilityNote({ capability }: { capability?: CapabilityDeclaration }) {
  if (!capability) return null;
  return <InlineNotice tone={capability.level === "full" ? "info" : "warning"}>
    <span><strong>{capability.level === "full" ? "完整控制面" : capability.level === "alternative" ? "替代实验" : "不可用"}</strong> · {capability.description}{capability.alternative ? `；${capability.alternative}` : ""}</span>
  </InlineNotice>;
}

function ScriptButtons({ busy, capability, onRead, onReset }: {
  busy: boolean;
  capability?: CapabilityDeclaration;
  onRead: () => void;
  onReset: () => void;
}) {
  const disabled = busy || capability?.level === "unavailable";
  return <div className="quick-actions">
    <button className="button" type="button" disabled={disabled} onClick={onRead}>回读脚本与消费诊断</button>
    <button className="button button--danger" type="button" disabled={disabled} onClick={onReset}>重置脚本</button>
  </div>;
}

export function ReferenceLabPage({ service }: { service: PaymentWorkbenchService }) {
  const [environment, setEnvironment] = useState<ReferenceEnvironment>();
  const lastReferenceTime = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ReferenceCommandResult>();
  const [environmentForm, setEnvironmentForm] = useState({
    fixtureId: "reference-default", merchantId: "reference-merchant", channelId: "", actorAlias: "",
    paymentExpiry: "PT30M", unknownResultReviewAfter: "PT30M", feeRate: "0.01",
  });
  const [clock, setClock] = useState({ instant: referenceInstant(), duration: "PT10M" });
  const [channel, setChannel] = useState({ channelId: "", outcome: "ACCEPT_THEN_SUCCESS" });
  const [bill, setBill] = useState({
    billId: token("bill"), revision: "1", merchantId: "reference-merchant", channelId: "",
    currency: "CNY", businessDate: referenceBusinessDate(referenceInstant(), "Asia/Shanghai"), businessTimezone: "Asia/Shanghai",
    idempotencyKey: token("bill-register"), recordId: token("bill-record"), transactionKind: "PAYMENT",
    externalTransactionId: "", amount: "100.00", status: "SUCCESS", occurredAt: referenceInstant(),
  });
  const [billScript, setBillScript] = useState({ billId: "", revision: "1", unavailableReadCount: "1" });
  const [notificationSender, setNotificationSender] = useState({
    notificationId: "", sourceKind: "", sourceFactId: "",
    outcome: "FAILURE" as "SUCCESS" | "FAILURE" | "RESULT_UNKNOWN",
  });
  const [settlementExecutor, setSettlementExecutor] = useState({
    channelId: "", executionId: "", outcome: "SUCCESS" as "SUCCESS" | "FAILURE" | "UNKNOWN" | "NO_RESULT",
  });

  const capability = (id: ScriptKind) => service.profile.capabilities.find((item) => item.id === id);
  const channelCapability = capability("channel-script");
  const billCapability = capability("bill-read-script");
  const notificationCapability = capability("notification-sender-script");
  const settlementCapability = capability("settlement-executor-script");
  const fixtureId = environmentForm.fixtureId;

  function syncBusinessClock(value: ReferenceEnvironment) {
    const instant = referenceInstant(value.currentTime);
    const businessTimezone = value.policy?.businessTimezone ?? "Asia/Shanghai";
    setClock((old) => ({ ...old, instant }));
    setBill((old) => ({ ...old, occurredAt: instant, businessTimezone, businessDate: referenceBusinessDate(instant, businessTimezone) }));
  }

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      const value = await service.getReferenceEnvironment();
      setEnvironment(value);
      if (lastReferenceTime.current !== value.currentTime) syncBusinessClock(value);
      lastReferenceTime.current = value.currentTime ?? undefined;
      setEnvironmentForm((old) => ({
        ...old, fixtureId: value.fixtureId, merchantId: value.merchantId, channelId: value.channelId,
        actorAlias: value.actorAlias, paymentExpiry: value.policy?.paymentExpiry ?? old.paymentExpiry,
        unknownResultReviewAfter: value.policy?.unknownResultReviewAfter ?? old.unknownResultReviewAfter,
        feeRate: value.policy?.feeRate ?? old.feeRate,
      }));
      setChannel((old) => ({ ...old, channelId: value.channelId }));
      setBill((old) => ({ ...old, merchantId: value.merchantId, channelId: value.channelId }));
      setSettlementExecutor((old) => ({ ...old, channelId: value.channelId }));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, [service]);

  async function execute(command: ReferenceCommand, confirmation?: string) {
    if (confirmation && !window.confirm(`${confirmation}\n\n该入口只用于 reference 学习环境。`)) return;
    setLoading(true);
    setError(undefined);
    try {
      const value = await service.executeReference(command);
      setResult(value);
      if (confirmation) await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }

  function registerEnvironment(event: FormEvent) {
    event.preventDefault();
    void execute({
      type: "REGISTER_ENVIRONMENT",
      input: {
        fixtureId, merchantId: environmentForm.merchantId, channelId: environmentForm.channelId,
        actorAlias: environmentForm.actorAlias, currentTime: environment?.currentTime,
        policy: { ...environment?.policy, paymentExpiry: environmentForm.paymentExpiry, unknownResultReviewAfter: environmentForm.unknownResultReviewAfter, feeRate: environmentForm.feeRate },
      },
    }, "更新 fixture 与 policy");
  }

  function registerBill(event: FormEvent) {
    event.preventDefault();
    void execute({
      type: "REGISTER_BILL",
      input: {
        billId: bill.billId, revision: Number(bill.revision), merchantId: bill.merchantId,
        channelId: bill.channelId, currency: bill.currency, businessDate: bill.businessDate,
        businessTimezone: bill.businessTimezone, idempotencyKey: bill.idempotencyKey,
        records: [{
          recordId: bill.recordId, transactionKind: bill.transactionKind,
          externalTransactionId: bill.externalTransactionId,
          money: createMoney(bill.currency, decimalToMinor(bill.amount, bill.currency)),
          status: bill.status, occurredAt: bill.occurredAt,
        }],
      },
    }, "发布权威账单 revision");
    setBillScript((old) => ({ ...old, billId: bill.billId, revision: bill.revision }));
  }

  const channelSelector = { fixtureId, channelId: channel.channelId };
  const billSelector = { fixtureId, billId: billScript.billId, revision: Number(billScript.revision) };
  const notificationSelector = {
    fixtureId, notificationId: notificationSender.notificationId || undefined,
    sourceKind: notificationSender.sourceKind || undefined,
    sourceFactId: notificationSender.sourceFactId || undefined,
  };
  const settlementSelector = { fixtureId, channelId: settlementExecutor.channelId, executionId: settlementExecutor.executionId };

  return <div className="page-stack">
    <SectionHeader title="Reference Lab" description="准备脚本、回读消费诊断并复现 success、failure、unknown、duplicate、late、conflict 场景。" action={<button className="button button--small" type="button" onClick={() => void refresh()}><RefreshCw size={15} />刷新环境</button>} />
    <InlineNotice tone="warning">仅用于 reference 学习环境。业务裁决由后端完成；客户端不能自报 verified=true。</InlineNotice>
    {error ? <ErrorBlock error={error} onRetry={() => void refresh()} /> : null}
    {loading ? <LoadingBlock label="正在执行 reference 控制命令" /> : null}
    {environment ? <section className="detail-band"><DefinitionList items={[
      { label: "Fixture", value: <code>{environment.fixtureId}</code> },
      { label: "商户", value: <code>{environment.merchantId}</code> },
      { label: "渠道", value: <code>{environment.channelId}</code> },
      { label: "Actor alias", value: <code>{environment.actorAlias}</code> },
      { label: "逻辑时钟", value: formatTime(environment.currentTime) },
      { label: "支付到期", value: environment.policy?.paymentExpiry ?? "—" },
      { label: "UNKNOWN 复核", value: environment.policy?.unknownResultReviewAfter ?? "—" },
      { label: "分页", value: `${environment.policy?.defaultPageSize ?? "—"} / max ${environment.policy?.maxPageSize ?? "—"}` },
    ]} /></section> : null}
    {result ? <section className="panel"><SectionHeader title="Reference 命令结果" />
      <InlineNotice tone={result.effect === "applied" ? "success" : "warning"}>
        <span><strong>{result.effect === "applied" ? "已应用" : result.effect === "alternative" ? "替代实验路径" : "当前传输不可用"}</strong> · {result.summary}</span>
      </InlineNotice>
      {result.receipt ? <DefinitionList items={[
        { label: "Operation", value: <code>{result.receipt.operationId}</code> },
        { label: "命令", value: result.receipt.commandType },
        { label: "受理", value: result.receipt.acceptanceStatus },
        { label: "资源", value: result.receipt.resource ? `${result.receipt.resource.resourceType}:${result.receipt.resource.resourceId}` : "—" },
      ]} /> : null}
      {result.data !== undefined ? <details className="source-details" open><summary>脚本状态与消费诊断</summary><pre>{JSON.stringify(result.data, null, 2)}</pre></details> : null}
    </section> : null}

    <div className="two-column-layout">
      <section className="panel"><h3><Settings2 size={18} />Fixture 与 Policy</h3>
        <form className="form-grid" onSubmit={registerEnvironment}>
          <label><span>Fixture ID</span><input required value={fixtureId} onChange={(e) => setEnvironmentForm({ ...environmentForm, fixtureId: e.target.value })} /></label>
          <label><span>商户</span><input required value={environmentForm.merchantId} onChange={(e) => setEnvironmentForm({ ...environmentForm, merchantId: e.target.value })} /></label>
          <label><span>渠道</span><input required value={environmentForm.channelId} onChange={(e) => setEnvironmentForm({ ...environmentForm, channelId: e.target.value })} /></label>
          <label><span>Actor alias</span><input required value={environmentForm.actorAlias} onChange={(e) => setEnvironmentForm({ ...environmentForm, actorAlias: e.target.value })} /></label>
          <label><span>支付到期时长</span><input required value={environmentForm.paymentExpiry} onChange={(e) => setEnvironmentForm({ ...environmentForm, paymentExpiry: e.target.value })} /></label>
          <label><span>UNKNOWN 复核时长</span><input required value={environmentForm.unknownResultReviewAfter} onChange={(e) => setEnvironmentForm({ ...environmentForm, unknownResultReviewAfter: e.target.value })} /></label>
          <label className="span-2"><span>Reference 费率</span><input required value={environmentForm.feeRate} onChange={(e) => setEnvironmentForm({ ...environmentForm, feeRate: e.target.value })} /></label>
          <button className="button button--danger span-2" disabled={loading} type="submit">登记环境与策略</button>
        </form>
      </section>
      <section className="panel"><h3><Clock3 size={18} />逻辑时钟</h3>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void execute({ type: "SET_CLOCK", input: { fixtureId, instant: clock.instant } }, "设置逻辑时钟"); }}>
          <label className="span-2"><span>绝对时间（ISO）</span><input required value={clock.instant} onChange={(e) => setClock({ ...clock, instant: e.target.value })} /></label>
          <button className="button button--danger span-2" disabled={loading} type="submit">设置时钟</button>
        </form>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void execute({ type: "ADVANCE_CLOCK", input: { fixtureId, duration: clock.duration } }, "推进逻辑时钟"); }}>
          <label className="span-2"><span>推进时长（ISO-8601 duration）</span><input required value={clock.duration} onChange={(e) => setClock({ ...clock, duration: e.target.value })} /></label>
          <button className="button button--danger span-2" disabled={loading} type="submit">推进时钟</button>
        </form>
      </section>
    </div>

    <div className="two-column-layout">
      <section className="panel"><h3><Beaker size={18} />渠道提交脚本</h3><CapabilityNote capability={channelCapability} />
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          void execute({ type: "CONFIGURE_CHANNEL", input: { ...channelSelector, outcome: channel.outcome as Extract<ReferenceCommand, { type: "CONFIGURE_CHANNEL" }>["input"]["outcome"] } }, "准备渠道结果实验");
        }}>
          <label><span>渠道</span><input required value={channel.channelId} onChange={(e) => setChannel({ ...channel, channelId: e.target.value })} /></label>
          <label><span>提交脚本</span><select value={channel.outcome} onChange={(e) => setChannel({ ...channel, outcome: e.target.value })}>
            <option value="ACCEPT_THEN_SUCCESS">受理并返回成功观察</option><option value="ACCEPT_THEN_FAILURE">受理并返回失败观察</option>
            <option value="ACCEPT_THEN_UNKNOWN">受理并返回 UNKNOWN</option><option value="REJECT_ON_SUBMIT">提交时拒绝</option>
            <option value="NO_RESULT">受理但不返回结果</option>
          </select></label>
          <button className="button button--danger span-2" disabled={loading || channelCapability?.level === "unavailable"} type="submit">{channelCapability?.level === "full" ? "应用下一次提交脚本" : "获取替代实验路径"}</button>
        </form>
        <ScriptButtons busy={loading} capability={channelCapability}
          onRead={() => void execute({ type: "READ_CHANNEL_SCRIPT", input: channelSelector })}
          onReset={() => void execute({ type: "RESET_CHANNEL_SCRIPT", input: channelSelector }, "重置渠道脚本")} />
        <InlineNotice>同一提交 identity 的重放返回首次观察；结果回调与脚本消费仍经服务端可信边界。</InlineNotice>
        <button className="button button--danger" type="button" disabled={loading} onClick={() => void execute({ type: "RUN_MAINTENANCE", input: { fixtureId } }, "运行 reference maintenance")}>运行到期与维护任务</button>
      </section>
      <section className="panel"><h3><Beaker size={18} />账单 provider 脚本</h3><CapabilityNote capability={billCapability} />
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          void execute({ type: "CONFIGURE_BILL_PROVIDER", input: { ...billSelector, unavailableReadCount: Number(billScript.unavailableReadCount) } }, "配置账单暂不可读次数");
        }}>
          <label><span>Bill ID</span><input required value={billScript.billId} onChange={(e) => setBillScript({ ...billScript, billId: e.target.value })} /></label>
          <label><span>Revision</span><input required type="number" min="1" value={billScript.revision} onChange={(e) => setBillScript({ ...billScript, revision: e.target.value })} /></label>
          <label className="span-2"><span>暂不可读次数</span><input required type="number" min="0" value={billScript.unavailableReadCount} onChange={(e) => setBillScript({ ...billScript, unavailableReadCount: e.target.value })} /></label>
          <button className="button button--danger span-2" disabled={loading || billCapability?.level === "unavailable"} type="submit">配置 provider 读取脚本</button>
        </form>
        <ScriptButtons busy={loading} capability={billCapability}
          onRead={() => void execute({ type: "READ_BILL_PROVIDER_SCRIPT", input: billSelector })}
          onReset={() => void execute({ type: "RESET_BILL_PROVIDER_SCRIPT", input: billSelector }, "重置账单 provider 脚本")} />
      </section>
    </div>

    <section className="panel"><h3><FilePlus2 size={18} />发布单条记录账单 revision</h3>
      <InlineNotice>业务日期和记录发生时间默认采用 Reference Lab 逻辑时钟；修改时钟后将同步，手动编辑后可随时重新同步。</InlineNotice>
      <button className="button button--small" type="button" disabled={!environment} onClick={() => { if (environment) syncBusinessClock(environment); }}>从逻辑时钟同步账单时间</button>
      <form className="form-grid" onSubmit={registerBill}>
        <label><span>Bill ID</span><input required value={bill.billId} onChange={(e) => setBill({ ...bill, billId: e.target.value })} /></label>
        <label><span>Revision</span><input required type="number" min="1" value={bill.revision} onChange={(e) => setBill({ ...bill, revision: e.target.value })} /></label>
        <label><span>商户</span><input required value={bill.merchantId} onChange={(e) => setBill({ ...bill, merchantId: e.target.value })} /></label>
        <label><span>渠道</span><input required value={bill.channelId} onChange={(e) => setBill({ ...bill, channelId: e.target.value })} /></label>
        <label><span>业务日期</span><input required type="date" value={bill.businessDate} onChange={(e) => setBill({ ...bill, businessDate: e.target.value })} /></label>
        <label><span>时区</span><input required value={bill.businessTimezone} onChange={(e) => setBill({ ...bill, businessTimezone: e.target.value })} /></label>
        <label><span>记录 ID</span><input required value={bill.recordId} onChange={(e) => setBill({ ...bill, recordId: e.target.value })} /></label>
        <label><span>交易类型</span><select value={bill.transactionKind} onChange={(e) => setBill({ ...bill, transactionKind: e.target.value })}><option>PAYMENT</option><option>REFUND</option></select></label>
        <label className="span-2"><span>外部交易号</span><input required value={bill.externalTransactionId} onChange={(e) => setBill({ ...bill, externalTransactionId: e.target.value })} /></label>
        <label><span>金额</span><input required value={bill.amount} onChange={(e) => setBill({ ...bill, amount: e.target.value })} /></label>
        <label><span>状态</span><select value={bill.status} onChange={(e) => setBill({ ...bill, status: e.target.value })}><option>SUCCESS</option><option>FAILURE</option></select></label>
        <label className="span-2"><span>记录发生时间（ISO）</span><input required value={bill.occurredAt} onChange={(e) => setBill({ ...bill, occurredAt: e.target.value })} /></label>
        <label className="span-2"><span>幂等键</span><input required value={bill.idempotencyKey} onChange={(e) => setBill({ ...bill, idempotencyKey: e.target.value })} /></label>
        <button className="button button--danger span-2" disabled={loading} type="submit">发布 immutable revision</button>
      </form>
    </section>

    <div className="two-column-layout">
      <section className="panel"><h3><Beaker size={18} />通知 sender 脚本</h3><CapabilityNote capability={notificationCapability} />
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          void execute({ type: "CONFIGURE_NOTIFICATION_SENDER", input: { ...notificationSelector, outcome: notificationSender.outcome } }, "配置通知投递结果");
        }}>
          <label><span>Notification ID</span><input value={notificationSender.notificationId} onChange={(e) => setNotificationSender({ ...notificationSender, notificationId: e.target.value })} /></label>
          <label><span>来源类型</span><input value={notificationSender.sourceKind} onChange={(e) => setNotificationSender({ ...notificationSender, sourceKind: e.target.value })} /></label>
          <label><span>来源事实 ID</span><input value={notificationSender.sourceFactId} onChange={(e) => setNotificationSender({ ...notificationSender, sourceFactId: e.target.value })} /></label>
          <label><span>下一次投递结果</span><select value={notificationSender.outcome} onChange={(e) => setNotificationSender({ ...notificationSender, outcome: e.target.value as typeof notificationSender.outcome })}>
            <option value="SUCCESS">SUCCESS</option><option value="FAILURE">FAILURE</option><option value="RESULT_UNKNOWN">RESULT_UNKNOWN</option>
          </select></label>
          <button className="button button--danger span-2" disabled={loading || notificationCapability?.level === "unavailable"} type="submit">应用通知脚本</button>
        </form>
        <ScriptButtons busy={loading} capability={notificationCapability}
          onRead={() => void execute({ type: "READ_NOTIFICATION_SENDER_SCRIPT", input: notificationSelector })}
          onReset={() => void execute({ type: "RESET_NOTIFICATION_SENDER_SCRIPT", input: notificationSelector }, "重置通知 sender 脚本")} />
      </section>
      <section className="panel"><h3><Beaker size={18} />结算 executor 脚本</h3><CapabilityNote capability={settlementCapability} />
        <p>分别记录渠道和 execution identity；适配器选择后端所需的脚本绑定。执行命令继续在结算页面提交。</p>
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          void execute({ type: "CONFIGURE_SETTLEMENT_EXECUTOR", input: { ...settlementSelector, outcome: settlementExecutor.outcome } }, "配置结算执行结果");
        }}>
          <label><span>渠道</span><input required value={settlementExecutor.channelId} onChange={(e) => setSettlementExecutor({ ...settlementExecutor, channelId: e.target.value })} /></label>
          <label><span>Execution ID</span><input required value={settlementExecutor.executionId} onChange={(e) => setSettlementExecutor({ ...settlementExecutor, executionId: e.target.value })} /></label>
          <label className="span-2"><span>执行结果</span><select value={settlementExecutor.outcome} onChange={(e) => setSettlementExecutor({ ...settlementExecutor, outcome: e.target.value as typeof settlementExecutor.outcome })}>
            <option value="SUCCESS">SUCCESS</option><option value="FAILURE">FAILURE</option><option value="UNKNOWN">UNKNOWN</option><option value="NO_RESULT">NO_RESULT</option>
          </select></label>
          <button className="button button--danger span-2" disabled={loading || settlementCapability?.level === "unavailable"} type="submit">应用结算脚本</button>
        </form>
        <ScriptButtons busy={loading} capability={settlementCapability}
          onRead={() => void execute({ type: "READ_SETTLEMENT_EXECUTOR_SCRIPT", input: settlementSelector })}
          onReset={() => void execute({ type: "RESET_SETTLEMENT_EXECUTOR_SCRIPT", input: settlementSelector }, "重置结算 executor 脚本")} />
      </section>
    </div>
  </div>;
}
