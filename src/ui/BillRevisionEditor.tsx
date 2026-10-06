import { type FormEvent, useEffect, useRef, useState } from "react";
import { Copy, FilePlus2, Plus, Trash2 } from "lucide-react";
import { BusinessError } from "../domain/errors";
import type { ApiErrorShape, AuthoritativeBill, BillRevision, ReferenceCommandResult, ReferenceEnvironment, RegisterBillInput } from "../domain/models";
import { AcceptedObservationError, observeReceipt, type ObserveResult, type PaymentWorkbenchService } from "../services/workbench-service";
import { token } from "./action-utils";
import { billDraftInput, billDraftWarnings, copyBillRow, draftFromRevision, newBillDraft, newBillRow, validateBillDraft, type BillDraft, type BillDraftRow } from "./bill-draft";
import { setBillReconciliationHint } from "./bill-navigation";
import { CommandFeedback, DefinitionList, ErrorBlock, InlineNotice, LoadingBlock, SectionHeader } from "./components";
import { formatTime } from "./format";
import { referenceBusinessDate } from "./reference-time";
import { requestConfirmation, useConfirmationScope } from "./confirmation";
import "./BillRevisionEditor.css";

interface Publication {
  input: RegisterBillInput;
  result?: ReferenceCommandResult;
  observation?: ObserveResult<AuthoritativeBill>;
  observationError?: ApiErrorShape;
  confirmedBill?: AuthoritativeBill;
  pending: boolean;
}

interface Props {
  service: PaymentWorkbenchService;
  environment?: ReferenceEnvironment;
  fixtureId?: string;
  onPublished?: (billId: string, revision: number) => void;
}

/** The editor owns drafts; every published result is read again from the service. */
export function BillRevisionEditor({ service, environment, fixtureId, onPublished }: Props) {
  const [draft, setDraft] = useState<BillDraft>(() => newBillDraft(environment));
  const dirty = useRef(false);
  const hydrated = useRef(Boolean(environment));
  const frozen = useRef<RegisterBillInput | undefined>(undefined);
  const busyGuard = useRef(false);
  const lookupVersion = useRef(0);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [bill, setBill] = useState<AuthoritativeBill>();
  const [selectedRevision, setSelectedRevision] = useState("");
  const [error, setError] = useState<unknown>();
  const [lookupError, setLookupError] = useState<unknown>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [publication, setPublication] = useState<Publication>();
  const [editedAfterSend, setEditedAfterSend] = useState(false);
  const revision = bill?.revisions?.find((item) => String(item.revision) === selectedRevision);
  const confirmationScope = useConfirmationScope(draft, service, (bill?.billId ?? "") + ":" + selectedRevision);

  useEffect(() => {
    if (environment && !hydrated.current) {
      hydrated.current = true;
      if (!dirty.current) setDraft((old) => ({ ...newBillDraft(environment), billId: old.billId, idempotencyKey: old.idempotencyKey }));
    }
  }, [environment]);
  useEffect(() => () => { lookupVersion.current += 1; }, []);

  function edit(update: (old: BillDraft) => BillDraft) {
    dirty.current = true;
    const newIdentity = frozen.current ? token("bill-register") : undefined;
    if (newIdentity) { frozen.current = undefined; setEditedAfterSend(true); }
    setDraft((old) => ({ ...update(old), ...(newIdentity ? { idempotencyKey: newIdentity } : {}) }));
    setFieldErrors({});
    setError(undefined);
  }

  function editRow(key: string, field: keyof BillDraftRow, value: string) {
    edit((old) => ({ ...old, rows: old.rows.map((row) => row.key === key ? { ...row, [field]: value } : row) }));
  }

  function acceptBill(value: AuthoritativeBill, revisionNumber?: number) {
    setBill(value);
    setSelectedRevision(String(revisionNumber ?? value.currentRevision ?? value.revisions?.at(-1)?.revision ?? ""));
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    const id = lookupId.trim();
    if (!id) return;
    const request = ++lookupVersion.current;
    setLookupBusy(true);
    setLookupError(undefined);
    setBill(undefined);
    setSelectedRevision("");
    try {
      const value = await service.getBill(id);
      if (request === lookupVersion.current) acceptBill(value);
    } catch (cause) { if (request === lookupVersion.current) setLookupError(cause); }
    finally { if (request === lookupVersion.current) setLookupBusy(false); }
  }

  async function replaceDraft(next: BillDraft, description: string) {
    if (busyGuard.current) return;
    if (dirty.current && !await requestConfirmation(`${description}\n\n将替换当前已编辑的完整草稿；尚未发布的输入会被替换。是否继续？`, confirmationScope)) return;
    if (!confirmationScope.active || busyGuard.current) return;
    setDraft(next);
    dirty.current = true;
    frozen.current = undefined;
    setEditedAfterSend(false);
    setError(undefined);
    setFieldErrors({});
  }

  async function copyRevision() {
    if (!bill || !revision) return;
    try { await replaceDraft(draftFromRevision(bill, revision), `复制 ${bill.billId} revision ${revision.revision} 为完整新版本`); }
    catch (cause) { setError(cause); }
  }

  async function readPublished(input: RegisterBillInput): Promise<AuthoritativeBill> {
    const value = await service.getBill(input.billId);
    const published = value.revisions?.find((item) => String(item.revision) === String(input.revision));
    if (value.billId !== input.billId || !published) {
      throw new BusinessError({ code: "RESOURCE_NOT_READY", message: "发布已返回，但权威账单中暂未读到本次 revision，请继续回读", retryable: true, fields: [], details: { billId: input.billId, revision: input.revision } });
    }
    // Resource UUIDs and new-version evidence are not editable business fields.
    const recordSnapshot = (records: RegisterBillInput["records"]) => records.map((record) => ({
      identity: record.recordIdentity ?? record.recordId, kind: record.transactionKind,
      externalId: record.externalTransactionId, money: record.money,
      status: record.rawStatus ?? record.status, occurredAt: Date.parse(record.occurredAt ?? ""),
    })).sort((left, right) => left.identity.localeCompare(right.identity));
    if (published.channelId !== input.channelId || published.currency !== input.currency
      || published.businessDate !== input.businessDate || (published.businessTimezone ?? value.businessTimezone) !== input.businessTimezone
      || (published.merchantId || value.merchantId || input.merchantId) !== input.merchantId
      || JSON.stringify(recordSnapshot(published.records)) !== JSON.stringify(recordSnapshot(input.records))) {
      throw new BusinessError({ code: "BILL_PUBLICATION_MISMATCH", message: "权威 revision 内容与本次发布草稿不一致；保留回执与草稿，请核对冲突，不能据此继续对账", retryable: false, fields: [], details: { billId: input.billId, revision: input.revision } });
    }
    return value;
  }

  async function observePublication(current: Publication) {
    let next = { ...current, pending: true };
    setPublication(next);
    if (current.result?.receipt) {
      try {
        const observed = await observeReceipt<AuthoritativeBill>(service, current.result.receipt, { read: () => readPublished(current.input) });
        next = { ...next, observation: observed, observationError: observed.observationError };
        if (observed.operation.status === "FAILED" || observed.operation.status === "REVIEW_REQUIRED") {
          setPublication({ ...next, pending: false });
          setError(new BusinessError(observed.operation.error ?? { code: "BILL_PUBLICATION_FAILED", message: "账单发布 Operation 未成功，请查看回执与源诊断", retryable: false, fields: [] }));
          return;
        }
        if (observed.timedOut || !observed.resource) { setPublication(next); return; }
        next.confirmedBill = observed.resource;
      } catch (cause) {
        if (cause instanceof AcceptedObservationError) {
          next.observationError = cause.observationError;
        }
        setPublication(next);
        throw cause;
      }
    } else if (current.result?.effect === "applied") {
      next.confirmedBill = await readPublished(current.input);
    } else { setPublication({ ...next, pending: false }); return; }
    next.pending = false;
    setPublication(next);
    if (next.confirmedBill) {
      lookupVersion.current += 1;
      setLookupBusy(false);
      setLookupError(undefined);
      setLookupId(current.input.billId);
      acceptBill(next.confirmedBill, current.input.revision);
      onPublished?.(current.input.billId, current.input.revision);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (busyGuard.current) return;
    setError(undefined);
    const errors = validateBillDraft(draft);
    setFieldErrors(errors);
    let input: RegisterBillInput;
    try {
      if (!frozen.current && !environment?.currentTime) throw new BusinessError({
        code: "REFERENCE_CLOCK_UNAVAILABLE", message: "尚未读到真实逻辑时钟，请刷新 Reference 环境再发布；不会用电脑时间代替", retryable: true, fields: [],
      });
      input = frozen.current ?? billDraftInput(draft, environment!.currentTime!, fixtureId);
    }
    catch (cause) { setError(cause); return; }
    busyGuard.current = true;
    setBusy(true);
    try {
      if (!await requestConfirmation(`发布 ${input.billId} / revision ${input.revision}，共 ${input.records.length} 条记录？\n\n每版是完整快照，不会与历史版本累加。已发布版本不可覆盖。${billDraftWarnings(draft).join("\n")}\n该入口仅用于 reference 学习环境。`, confirmationScope) || !confirmationScope.active) return;
      frozen.current = input;
      setEditedAfterSend(false);
      const current: Publication = { input, pending: true };
      setPublication(current);
      current.result = await service.executeReference({ type: "REGISTER_BILL", input });
      setPublication({ ...current });
      await observePublication(current);
    } catch (cause) { setError(cause); }
    finally { busyGuard.current = false; setBusy(false); }
  }

  async function continueObservation() {
    if (!publication?.result || busyGuard.current) return;
    busyGuard.current = true;
    setBusy(true);
    setError(undefined);
    try { await observePublication(publication); }
    catch (cause) { setError(cause); }
    finally { busyGuard.current = false; setBusy(false); }
  }

  async function syncClock() {
    if (!environment?.currentTime || busyGuard.current) return;
    const instant = environment.currentTime;
    if (!await requestConfirmation("将按当前草稿时区重算业务日期，并替换全部草稿行的发生时间。历史账单不变。是否继续？", confirmationScope) || !confirmationScope.active || busyGuard.current) return;
    edit((old) => ({ ...old, businessDate: referenceBusinessDate(instant, old.businessTimezone), rows: old.rows.map((row) => ({ ...row, occurredAt: instant })) }));
  }

  function goToReconciliation() {
    if (!publication?.confirmedBill) return;
    const value = publication.confirmedBill;
    const published = value.revisions?.find((item) => String(item.revision) === String(publication.input.revision));
    if (!published) return;
    setBillReconciliationHint({
      billId: value.billId, revision: publication.input.revision,
      merchantId: published.merchantId || value.merchantId || publication.input.merchantId,
      merchantSource: published.merchantId || value.merchantId ? "bill" : "user-confirmed",
      channelId: published.channelId, currency: published.currency, businessDate: published.businessDate ?? "",
      businessTimezone: published.businessTimezone ?? "", publishedAt: published.publishedAt ?? undefined,
    });
    window.location.hash = "reconciliation";
  }

  function inputField(field: keyof Omit<BillDraft, "rows" | "merchantConfirmationRequired" | "merchantConfirmed">, label: string, type = "text") {
    return <label><span>{label}</span><input type={type} value={draft[field]} aria-invalid={Boolean(fieldErrors[field])} onChange={(e) => edit((old) => ({ ...old, [field]: e.target.value, ...(field === "merchantId" ? { merchantConfirmed: false } : {}) }))} />{fieldErrors[field] ? <small className="bill-field-error">{fieldErrors[field]}</small> : null}</label>;
  }
  function rowError(index: number, field: string) { return fieldErrors[`rows.${index}.${field}`]; }
  function rowField(row: BillDraftRow, index: number, field: keyof BillDraftRow, label: string) {
    return <label><span>{label}</span><input value={row[field]} aria-invalid={Boolean(rowError(index, field))} onChange={(e) => editRow(row.key, field, e.target.value)} />{rowError(index, field) ? <small className="bill-field-error">{rowError(index, field)}</small> : null}</label>;
  }

  return <section className="panel bill-editor">
    <SectionHeader title="多记录账单 revision" description="Reference 模拟渠道输入：支付与退款分别录入，每版都是完整快照，不与历史版本自动累加。" />
    <div className="bill-editor__lookup">
      <h3>查询已发布账单</h3>
      <form className="lookup-bar" onSubmit={lookup}>
        <label><span>查询 Bill ID</span><input value={lookupId} onChange={(e) => { setLookupId(e.target.value); lookupVersion.current += 1; setLookupBusy(false); setBill(undefined); setSelectedRevision(""); setLookupError(undefined); }} placeholder="已发布的 Bill ID" /></label>
        <button className="button" type="submit" disabled={busy || !lookupId.trim()}>查询账单与版本</button>
      </form>
      {lookupBusy ? <LoadingBlock label="正在查询权威账单与完整 revision 链" /> : null}
      {lookupError ? <ErrorBlock error={lookupError} /> : null}
      {bill ? <div className="bill-editor__history">
        <DefinitionList items={[{ label: "权威 Bill ID", value: <code>{bill.billId}</code> }, { label: "当前最新 revision", value: String(bill.currentRevision ?? "未返回") }, { label: "账单商户", value: bill.merchantId || revision?.merchantId || "未返回；不能从环境推断" }]} />
        <div className="bill-editor__toolbar"><label><span>已发布 revision</span><select value={selectedRevision} disabled={busy} onChange={(e) => setSelectedRevision(e.target.value)}>{bill.revisions?.map((item) => <option key={String(item.revision)} value={String(item.revision)}>{item.revision} · {item.records.length} 条记录</option>)}</select></label>
          <button className="button" type="button" disabled={busy || !revision} onClick={copyRevision}><Copy size={15} />复制完整版本为新草稿</button></div>
        {revision ? <PublishedRevision revision={revision} /> : <InlineNotice tone="warning">权威查询尚未返回所选 revision，不能复制本地猜测内容。</InlineNotice>}
      </div> : null}
    </div>

    <div className="bill-editor__toolbar"><h3><FilePlus2 size={18} />完整账单草稿</h3><button className="button button--small" type="button" disabled={busy} onClick={() => replaceDraft(newBillDraft(environment), "新建独立账单")}>新建独立账单</button></div>
    <InlineNotice>新增行使用当前逻辑时钟；环境刷新不覆盖已有草稿时间。复制历史版本保留原时区、发生时间、金额与渠道原状态。</InlineNotice>
    {editedAfterSend ? <InlineNotice tone="warning">已编辑发布内容，已生成新的命令幂等键。相同 revision 不能覆盖已有内容；纠正已发布账单请复制为新 revision。</InlineNotice> : null}
    {error ? <ErrorBlock error={error} /> : null}
    <form onSubmit={publish} noValidate>
      <fieldset disabled={busy} className="bill-editor__fieldset">
        <div className="form-grid">
          {inputField("billId", "Bill ID")}{inputField("revision", "Revision")}
          {inputField("merchantId", "商户")}{inputField("channelId", "渠道")}
          {inputField("currency", "币种")}{inputField("businessDate", "业务日期", "date")}
          {inputField("businessTimezone", "业务时区")}
          <label><span>本次发布幂等键（自动管理）</span><input readOnly value={draft.idempotencyKey} /></label>
        </div>
        {draft.merchantConfirmationRequired ? <InlineNotice tone="warning"><span>所选账单没有返回商户。请填写本次运行商户；该输入是你的选择，不是账单权威归属。<label className="bill-editor__check"><input type="checkbox" checked={draft.merchantConfirmed} onChange={(e) => edit((old) => ({ ...old, merchantConfirmed: e.target.checked }))} /><span>我已核实并确认本次运行商户</span></label></span></InlineNotice> : null}
        <div className="bill-editor__toolbar"><strong>本版记录 · {draft.rows.length} 条</strong><div className="quick-actions">
          <button className="button button--small" type="button" onClick={() => edit((old) => ({ ...old, rows: [...old.rows, newBillRow(environment?.currentTime)] }))}><Plus size={15} />添加记录</button>
          <button className="button button--small" type="button" disabled={!environment?.currentTime} onClick={syncClock}>同步业务日期与全部行时间</button>
        </div></div>
        {!draft.rows.length ? <InlineNotice tone="warning">本版为空账单。可以发布此实验；不会自动填充历史记录或生成假记录。</InlineNotice> : null}
        <div className="bill-editor__rows">{draft.rows.map((row, index) => <fieldset className="bill-editor__row" key={row.key}>
          <legend>第 {index + 1} 行 · {row.transactionKind === "REFUND" ? "退款" : row.transactionKind === "PAYMENT" ? "支付" : row.transactionKind}</legend>
          <div className="bill-editor__row-actions"><button type="button" className="button button--small" onClick={() => edit((old) => ({ ...old, rows: [...old.rows.slice(0, index + 1), copyBillRow(row), ...old.rows.slice(index + 1)] }))}><Copy size={14} />复制此行</button><button type="button" className="button button--small" onClick={() => edit((old) => ({ ...old, rows: old.rows.filter((item) => item.key !== row.key) }))}><Trash2 size={14} />删除此行</button></div>
          <div className="form-grid">
            {rowField(row, index, "recordId", "业务记录 ID")}
            <label><span>交易类型</span><select value={row.transactionKind} onChange={(e) => editRow(row.key, "transactionKind", e.target.value)}>{!["PAYMENT", "REFUND"].includes(row.transactionKind) ? <option value={row.transactionKind}>{row.transactionKind}（原类型）</option> : null}<option value="PAYMENT">PAYMENT · 支付</option><option value="REFUND">REFUND · 退款</option></select>{rowError(index, "transactionKind") ? <small className="bill-field-error">{rowError(index, "transactionKind")}</small> : null}</label>
            {rowField(row, index, "externalTransactionId", "外部交易号")}{rowField(row, index, "amount", `金额（${draft.currency} 元）`)}
            {rowField(row, index, "status", "渠道原状态")}{rowField(row, index, "occurredAt", "记录发生时间（ISO）")}
          </div>
        </fieldset>)}</div>
        <p className="bill-editor__help">外部交易号取自成功支付/退款的权威详情与渠道收件。学习闭环使用成功原状态 SUCCEEDED；其他原状态也会原样保留，由后端判定是否状态匹配。复制一行生成新业务记录 ID，外部交易号仍需按实际交易核对。</p>
        {billDraftWarnings(draft).map((warning) => <InlineNotice key={warning} tone="warning">{warning}</InlineNotice>)}
        <button className="button button--danger bill-editor__publish" type="submit">{frozen.current ? "安全重试同一发布" : "发布完整 immutable revision"}</button>
      </fieldset>
    </form>
    {busy ? <LoadingBlock label="正在发布或回读账单，请勿重复提交" /> : null}
    {publication ? <div className="bill-editor__publication">
      <h3>本次发布：<code>{publication.input.billId}</code> / revision {publication.input.revision}</h3>
      <p>首次发布时间 {formatTime(publication.input.publishedAt)} · {publication.input.records.length} 条记录 · <code>{publication.input.idempotencyKey}</code></p>
      {publication.result ? <InlineNotice tone={publication.confirmedBill ? "success" : "warning"}>{publication.confirmedBill ? "权威回读已确认本版账单，可前往运行对账。" : publication.result.receipt ? "命令已受理；权威账单尚待观察或回读。" : publication.result.effect === "applied" ? "后端已应用发布；权威账单尚待回读。" : publication.result.summary}</InlineNotice> : <InlineNotice tone="warning">尚未收到发布结果；草稿与首次发布内容已保留。未编辑时可安全重试同一发布。</InlineNotice>}
      <CommandFeedback receipt={publication.result?.receipt} operation={publication.observation?.operation} timedOut={publication.pending} observationError={publication.observationError} onContinue={() => void continueObservation()} busy={busy} />
      {publication.pending && publication.result && !publication.result.receipt ? <button className="button" type="button" disabled={busy} onClick={() => void continueObservation()}>继续回读已发布账单</button> : null}
      {publication.confirmedBill ? <><DefinitionList items={[{ label: "商户", value: publication.confirmedBill.merchantId || publication.input.merchantId }, { label: "渠道 / 币种", value: `${publication.input.channelId} / ${publication.input.currency}` }, { label: "业务日期 / 时区", value: `${publication.input.businessDate} / ${publication.input.businessTimezone}` }]} />{!publication.confirmedBill.merchantId ? <p>商户使用你确认的发布输入；账单查询未返回归属，前往对账后仍须核实运行商户。</p> : null}<button className="button" type="button" onClick={goToReconciliation}>前往对账（核对上下文后手动运行）</button></> : null}
    </div> : null}
  </section>;
}

function PublishedRevision({ revision }: { revision: BillRevision }) {
  return <details className="source-details"><summary>已发布版本只读证据 · {revision.records.length} 条记录</summary>
    <DefinitionList items={[{ label: "发布时间", value: formatTime(revision.publishedAt) }, { label: "完整性", value: revision.completeness ?? String(revision.complete ?? "未知") }, { label: "业务日期 / 时区", value: `${revision.businessDate ?? "未返回"} / ${revision.businessTimezone ?? "未返回"}` }, { label: "Fingerprint", value: <code>{revision.payloadFingerprint ?? "未返回"}</code> }]} />
    <p>发布时间、fingerprint 和 rawEvidence 只属于已发布版本；复制草稿会保留业务字段，新发布生成新证据。</p>
    <pre>{JSON.stringify(revision, null, 2)}</pre>
  </details>;
}
