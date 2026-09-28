import { BusinessError } from "../domain/errors";
import type {
  AuthoritativeBill,
  BackendProfile,
  BusinessCommand,
  ChannelResultInput,
  HealthStatus,
  ManualReviewItem,
  MerchantNotification,
  Operation,
  OperationReceipt,
  PageRequest,
  PageResult,
  Payment,
  PaymentTimeline,
  ReconciliationRun,
  ReferenceCommand,
  ReferenceCommandResult,
  ReferenceEnvironment,
  Refund,
  Settlement,
} from "../domain/models";
import { HttpClient, type JsonRecord } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import type { AdapterRuntimeOptions } from "./factory";
import {
  action,
  alternativeAction,
  compact,
  mapManualReview,
  mapNotification,
  mapOperation,
  mapPage,
  mapPayment,
  mapReceipt,
  mapReconciliationRun,
  mapRefund,
  mapSettlement,
  mapTimeline,
  money,
  object,
  pathId,
  records,
  requiredOne,
  source,
  text,
  toWireMoney,
} from "./shared";

const capabilities: BackendProfile["capabilities"] = [
  { id: "payment", label: "payment", description: "支付意图、attempt、提交、可信结果与到期", level: "full" },
  { id: "refund", label: "refund", description: "退款申请、attempt、结果与预算", level: "full" },
  { id: "authoritative-lists", label: "authoritative-lists", description: "五类权威 keyset cursor 列表", level: "full" },
  { id: "reconciliation", label: "reconciliation", description: "账单 revision、Run、差异处置与事实确认", level: "full" },
  { id: "settlement", label: "settlement", description: "准备、冻结、caller-supplied executionId 执行、作废与替代", level: "full" },
  { id: "manual-review", label: "manual-review", description: "权威人工核对与责任处置", level: "full" },
  { id: "notification", label: "notification", description: "稳定通知身份、投递历史与重试", level: "full" },
  { id: "timeline", label: "timeline", description: "paymentId 全链路 timeline", level: "full" },
  { id: "reference-lab", label: "reference-lab", description: "policy、逻辑时钟、执行脚本与 callback evidence", level: "full" },
  { id: "bill-detail", label: "bill-detail", description: "权威账单当前 revision 与完整不可变历史", level: "full" },
  { id: "channel-script", label: "channel-script", description: "配置和重置 reference 渠道提交脚本；暂无独立 read 路由", level: "full" },
  { id: "bill-read-script", label: "bill-read-script", description: "随账单 revision 注册配置暂不可读次数；暂无独立读写控制路由", level: "full" },
  { id: "notification-sender-script", label: "notification-sender-script", description: "按 notification 或来源事实配置和重置投递脚本；暂无独立 read 路由", level: "full" },
  { id: "settlement-executor-script", label: "settlement-executor-script", description: "按 executionId 配置、读取和重置结算 executor 脚本", level: "full" },
  { id: "settlement-execution-identity", label: "settlement-execution-identity", description: "执行命令使用调用者提供的 executionId", level: "full" },
  { id: "payment-close-expired", label: "payment-close-expired", description: "按单支付关闭到期意图，返回 READ_ONCE Operation", level: "full" },
  {
    id: "reconciliation-complete",
    label: "reconciliation-complete",
    description: "没有额外 complete 命令，Run 在 signal/rerun 与差异解除后自动收敛",
    level: "alternative",
    alternative: "重新读取 Run 观察服务端自动完成状态。",
  },
];

export class Cap4kPaymentAdapter implements PaymentBackendAdapter {
  readonly profile: BackendProfile;
  private readonly client: HttpClient;
  private readonly fixtureId: string;
  private readonly actorAlias: string;

  constructor(private readonly options: AdapterRuntimeOptions) {
    this.client = new HttpClient({ baseUrl: options.apiBaseUrl, fetchImpl: options.fetchImpl });
    this.fixtureId = options.fixtureId ?? "reference-default";
    this.actorAlias = options.actorAlias ?? "fixture-reconciliation-operator";
    this.profile = {
      id: "cap4k",
      label: "CAP4K Reference Payment",
      apiBaseUrl: options.apiBaseUrl,
      referenceOnly: true,
      capabilities,
      implementationDifferences: [
        { topic: "命令收敛", unifiedMeaning: "OperationReceipt + readAfter", implementation: "同一事务形成 READ_ONCE Operation" },
        { topic: "权威列表", unifiedMeaning: "opaque keyset cursor", implementation: "POST /search + JSON filters" },
        { topic: "责任字段", unifiedMeaning: "actor/reason/evidence", implementation: "actor 由 X-Reference-Actor-Context alias 在服务端解析" },
        { topic: "可信回调", unifiedMeaning: "服务端验证 canonical callback", implementation: "先登记 callback-evidence，再提交完全一致的 rawPayload" },
        { topic: "全链路", unifiedMeaning: "payment timeline", implementation: "GET /payments/{id}/timeline" },
      ],
    };
  }

  async health(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    try {
      await this.client.get("/reference-fixtures/policy");
      return this.healthResult("connected", checkedAt, "CAP4K reference API 与 policy 可访问。");
    } catch (error) {
      if (error instanceof BusinessError && error.httpStatus !== undefined) {
        return this.healthResult("degraded", checkedAt, `CAP4K API 已响应，但 reference policy 探针失败：${error.code}`);
      }
      return this.healthResult("unreachable", checkedAt, "无法连接 CAP4K reference API。");
    }
  }

  async getReferenceEnvironment(): Promise<ReferenceEnvironment> {
    const [policyResponse, clockResponse] = await Promise.all([
      this.client.get<JsonRecord>("/reference-fixtures/policy"),
      this.client.get<JsonRecord>("/reference-fixtures/clock"),
    ]);
    return {
      fixtureId: this.fixtureId,
      actorAlias: this.actorAlias,
      actorAliases: {
        paymentReviewer: "fixture-payment-reviewer",
        refundReviewer: "fixture-refund-reviewer",
        reconciliationOperator: this.actorAlias,
        settlementOperator: "fixture-settlement-operator",
        settlementReviewer: "fixture-settlement-reviewer",
      },
      currentTime: text(clockResponse.instant) ?? null,
      policy: (object(policyResponse.policy) ?? policyResponse) as ReferenceEnvironment["policy"],
      channelId: "C-001",
      merchantId: "reference-merchant",
      paymentMethod: "CARD",
    };
  }

  async executeReference(command: ReferenceCommand): Promise<ReferenceCommandResult> {
    switch (command.type) {
      case "REGISTER_ENVIRONMENT": {
        const input = command.input;
        const resetPolicy = await this.client.post("/reference-fixtures/policy/reset", {});
        const configuredPolicy = await this.client.post("/reference-fixtures/policy", input.policy ?? {});
        const results = await Promise.all([
          this.client.post("/reference-fixtures/clock/set", { instant: input.currentTime ?? "2026-09-14T00:00:00Z" }),
          this.client.post("/reference-fixtures/payment-channel-script/reset", { channelId: input.channelId }),
          this.client.post("/reference-fixtures/merchant-notification-sender-script/clear", {}),
        ]);
        const route = await this.client.post("/reference-fixtures/merchant-channels", {
          merchantId: input.merchantId,
          channelId: input.channelId,
          currency: "CNY",
          paymentMethod: input.paymentMethod ?? "CARD",
          status: "ACTIVE",
          minimumAmount: "0.01",
          maximumAmount: "1000000",
          routingPriority: 10,
          refundWindowDays: 30,
          refundResultReviewAfterMinutes: 5,
          settlementFeeBasisPoints: 60,
          settlementFixedFeeAmount: "0",
          settlementFeeRoundingMode: "HALF_UP",
          settlementResultReviewAfterMinutes: 5,
        });
        return { effect: "applied", summary: "CAP4K reference policy、clock、channel 与 merchant route 已初始化。", data: { resetPolicy, configuredPolicy, results, route } };
      }
      case "SET_CLOCK": {
        const data = await this.client.post("/reference-fixtures/clock/set", { instant: command.input.instant });
        return { effect: "applied", summary: "逻辑时钟已设置。", data };
      }
      case "ADVANCE_CLOCK": {
        const data = await this.client.post("/reference-fixtures/clock/advance", { duration: command.input.duration });
        return { effect: "applied", summary: "逻辑时钟已推进。", data };
      }
      case "CONFIGURE_CHANNEL": {
        const data = await this.client.post("/reference-fixtures/payment-channel-script", {
          channelId: command.input.channelId,
          script: cap4kChannelScript(command.input.outcome),
          ...command.input.payload,
        });
        return { effect: "applied", summary: "CAP4K reference channel script 已更新。", data };
      }
      case "READ_CHANNEL_SCRIPT":
        return this.transportUnavailable("CAP4K 未公开渠道脚本独立 read 路由；重置和提交消费仍可用。", "channel-script");
      case "RESET_CHANNEL_SCRIPT": {
        const data = await this.client.post("/reference-fixtures/payment-channel-script/reset", { channelId: command.input.channelId });
        return { effect: "applied", summary: "CAP4K reference channel script 已重置。", data };
      }
      case "CONFIGURE_BILL_PROVIDER":
      case "READ_BILL_PROVIDER_SCRIPT":
      case "RESET_BILL_PROVIDER_SCRIPT":
        return this.transportUnavailable("CAP4K 的暂不可读次数在注册账单 revision 时配置，未公开独立 bill provider 控制路由。", "bill-read-script");
      case "CONFIGURE_NOTIFICATION_SENDER": {
        const input = command.input;
        const data = await this.client.post("/reference-fixtures/merchant-notification-sender-script", compact({
          notificationIdentity: input.notificationId,
          sourceKind: input.sourceKind,
          sourceFactIdentity: input.sourceFactId,
          script: input.outcome,
        }));
        return { effect: "applied", summary: "CAP4K reference notification sender script 已更新。", data };
      }
      case "READ_NOTIFICATION_SENDER_SCRIPT":
        return this.transportUnavailable("CAP4K 未公开通知 sender 脚本独立 read 路由；配置和重置仍可用。", "notification-sender-script");
      case "RESET_NOTIFICATION_SENDER_SCRIPT": {
        const input = command.input;
        const data = await this.client.post("/reference-fixtures/merchant-notification-sender-script/reset", compact({
          notificationIdentity: input.notificationId,
          sourceKind: input.sourceKind,
          sourceFactIdentity: input.sourceFactId,
        }));
        return { effect: "applied", summary: "CAP4K reference notification sender script 已重置。", data };
      }
      case "CONFIGURE_SETTLEMENT_EXECUTOR": {
        const data = await this.client.post("/reference-fixtures/settlement-executor-script", {
          executionId: command.input.executionId,
          script: command.input.outcome,
        });
        return { effect: "applied", summary: "CAP4K settlement executor script 已更新。", data };
      }
      case "READ_SETTLEMENT_EXECUTOR_SCRIPT": {
        const data = await this.client.get(`/reference-fixtures/settlement-executor-script/${pathId(command.input.executionId)}`);
        return { effect: "applied", summary: "CAP4K settlement executor script 已读取。", data };
      }
      case "RESET_SETTLEMENT_EXECUTOR_SCRIPT": {
        const data = await this.client.post("/reference-fixtures/settlement-executor-script/reset", { executionId: command.input.executionId });
        return { effect: "applied", summary: "CAP4K settlement executor script 已重置。", data };
      }
      case "REGISTER_BILL": {
        const input = command.input;
        const publishedAt = this.now().toISOString();
        const response = await this.client.post<JsonRecord>("/reference-fixtures/bills", {
          channelId: input.channelId,
          billIdentity: input.billId,
          businessDate: input.businessDate,
          currency: input.currency,
          businessTimezone: input.businessTimezone,
          revision: String(input.revision),
          completeness: "COMPLETE",
          rawEvidence: `reference://workbench/bills/${input.billId}/revisions/${input.revision}`,
          payloadFingerprint: `${input.billId}:${input.revision}`,
          publishedAt,
          unavailableReadCount: input.unavailableReadCount,
          records: input.records.map((item) => ({
            recordIdentity: item.recordId,
            channelTransactionIdentity: item.externalTransactionId,
            transactionKind: item.transactionKind,
            money: toWireMoney(item.money),
            rawStatus: item.status,
            occurredAt: item.occurredAt ?? publishedAt,
            receivedAt: item.occurredAt ?? publishedAt,
            rawEvidence: `reference://workbench/bills/${input.billId}/records/${item.recordId}`,
          })),
        });
        return { effect: "applied", summary: "CAP4K 权威账单 revision 已登记。", data: response };
      }
      case "RUN_MAINTENANCE": {
        const data = await this.client.post("/reference-fixtures/maintenance", { action: "PAYMENT_EXPIRY" });
        return { effect: "applied", summary: "CAP4K reference maintenance 已执行。", data };
      }
    }
  }

  async execute(command: BusinessCommand): Promise<OperationReceipt> {
    switch (command.type) {
      case "CREATE_PAYMENT": {
        const input = command.input;
        return this.postReceipt("/payments", {
          merchantId: input.merchantId,
          merchantOrderNumber: input.merchantOrderId,
          idempotencyKey: input.idempotencyKey,
          money: toWireMoney(input.money),
          paymentMethod: input.paymentMethod,
        }, { type: "Payment", id: undefined });
      }
      case "CREATE_PAYMENT_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/payments/${pathId(input.resourceId)}/attempts`, {
          idempotencyKey: input.idempotencyKey,
          riskReason: input.riskReason,
        }, { type: "Payment", id: input.resourceId });
      }
      case "SUBMIT_PAYMENT_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/payments/${pathId(input.resourceId)}/attempts/${pathId(input.attemptId)}/submissions`, {
          idempotencyKey: input.idempotencyKey,
        }, { type: "Payment", id: input.resourceId });
      }
      case "RECEIVE_PAYMENT_RESULT":
        return this.receiveVerifiedResult(command.input, "Payment");
      case "CLOSE_EXPIRED_PAYMENT": {
        const payment = await this.getPayment(command.input.paymentId);
        return this.postReceipt(`/payments/${pathId(payment.paymentId)}/close-expired`, {
          merchantId: payment.merchantId,
          idempotencyKey: `workbench:close-expired:${payment.paymentId}`,
        }, { type: "Payment", id: payment.paymentId });
      }
      case "REQUEST_REFUND": {
        const input = command.input;
        return this.postReceipt("/refunds", {
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
          merchantRefundNo: input.merchantRefundId,
          paymentId: input.paymentId,
          money: toWireMoney(input.money),
          reason: input.reason,
        }, { type: "Refund" });
      }
      case "CREATE_REFUND_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/refunds/${pathId(input.resourceId)}/attempts`, { idempotencyKey: input.idempotencyKey }, { type: "Refund", id: input.resourceId });
      }
      case "SUBMIT_REFUND_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/refunds/${pathId(input.resourceId)}/attempts/${pathId(input.attemptId)}/submissions`, { idempotencyKey: input.idempotencyKey }, { type: "Refund", id: input.resourceId });
      }
      case "RECEIVE_REFUND_RESULT":
        return this.receiveVerifiedResult(command.input, "Refund");
      case "SIGNAL_BILL_AVAILABLE": {
        return this.signalAndRerun(command.input);
      }
      case "RUN_RECONCILIATION": {
        return this.signalAndRerun({ ...command.input, signalIdentity: `signal:${command.input.billId}:${command.input.revision}:${command.input.idempotencyKey}` });
      }
      case "RERUN_RECONCILIATION":
        return this.postReceipt(`/reconciliation-runs/${pathId(command.input.runId)}/reruns`, { idempotencyKey: command.input.idempotencyKey }, { type: "ReconciliationRun", id: command.input.runId }, this.actorHeaders(this.actorAlias));
      case "DISPOSE_RECONCILIATION_DIFFERENCE": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/reconciliation-runs/${pathId(input.runId)}/differences/${pathId(input.differenceId)}/dispositions`, {
          merchantId: input.merchantId,
          conclusion: cap4kReconciliationConclusion(input.conclusion),
          settlementImpact: cap4kSettlementImpact(input.settlementImpact),
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
          idempotencyKey: input.idempotencyKey,
        }, { type: "ReconciliationRun", id: input.runId }, this.actorHeaders(actorAlias));
      }
      case "CONFIRM_RECONCILIATION_FACT": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/reconciliation-runs/${pathId(input.runId)}/differences/${pathId(input.differenceId)}/confirmations`, {
          merchantId: input.merchantId,
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
          idempotencyKey: input.idempotencyKey,
        }, { type: "ReconciliationRun", id: input.runId }, this.actorHeaders(actorAlias));
      }
      case "COMPLETE_RECONCILIATION":
        this.requireActorAlias(command.input);
        throw this.unsupported("CAP4K 的 Run 在 bill signal/rerun 中完成；没有额外 complete 路由。", "reconciliation-complete");
      case "PREPARE_SETTLEMENT": {
        const input = command.input;
        return this.postReceipt("/merchant-settlements", {
          merchantId: input.merchantId,
          currency: input.currency,
          settlementPeriod: { start: input.periodStart, end: input.periodEnd, timezone: input.businessTimezone },
          idempotencyKey: input.idempotencyKey,
        }, { type: "Settlement", id: input.settlementId });
      }
      case "CONFIRM_SETTLEMENT": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/merchant-settlements/${pathId(input.settlementId)}/confirmations`, {
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
        }, { type: "Settlement", id: input.settlementId }, this.actorHeaders(actorAlias));
      }
      case "EXECUTE_SETTLEMENT": {
        const input = command.input;
        if (!input.channelId.trim()) {
          throw new BusinessError({
            code: "SETTLEMENT_CHANNEL_REQUIRED",
            message: "结算执行必须明确选择执行渠道。",
            fields: [{ field: "channelId", message: "请选择 reference executor 的渠道身份。", code: "REQUIRED" }],
            retryable: false,
          });
        }
        return this.postReceipt(`/merchant-settlements/${pathId(input.settlementId)}/executions`, {
          merchantId: input.merchantId,
          executionId: input.executionId,
          executionChannelId: input.channelId,
          idempotencyKey: input.idempotencyKey,
        }, { type: "Settlement", id: input.settlementId });
      }
      case "RECEIVE_SETTLEMENT_RESULT":
        return this.receiveVerifiedResult(command.input, "Settlement");
      case "VOID_SETTLEMENT": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/merchant-settlements/${pathId(input.settlementId)}/voids`, {
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
          idempotencyKey: input.idempotencyKey,
          createReplacement: false,
        }, { type: "Settlement", id: input.settlementId }, this.actorHeaders(actorAlias));
      }
      case "CREATE_SETTLEMENT_REPLACEMENT": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/merchant-settlements/${pathId(input.settlementId)}/voids`, {
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
          idempotencyKey: input.idempotencyKey,
          createReplacement: true,
        }, { type: "Settlement", id: input.settlementId }, this.actorHeaders(actorAlias));
      }
      case "RESOLVE_MANUAL_REVIEW": {
        const input = command.input;
        const actorAlias = this.requireActorAlias(input);
        return this.postReceipt(`/manual-reviews/${pathId(input.reviewId)}/resolutions`, {
          idempotencyKey: input.idempotencyKey,
          merchantId: input.merchantId,
          outcome: cap4kManualReviewOutcome(input.outcome, input.reviewType),
          reason: input.reason,
          evidence: input.evidenceRefs.join("\n"),
          remediationReference: input.remediationReference ?? input.evidenceRefs[0],
          channelId: input.channelId,
        }, { type: "ManualReviewItem", id: input.reviewId }, this.actorHeaders(actorAlias));
      }
      case "RETRY_NOTIFICATION": {
        const input = command.input;
        return this.postReceipt(`/merchant-notifications/${pathId(input.notificationId)}/retries`, { idempotencyKey: input.idempotencyKey }, { type: "MerchantNotification", id: input.notificationId });
      }
    }
  }

  getOperation(operationId: string): Promise<Operation> {
    return this.client.get(`/operations/${pathId(operationId)}`).then((value) => mapOperation("cap4k", value));
  }

  getPayment(paymentId: string): Promise<Payment> {
    return this.client.get<JsonRecord>(`/payments/${pathId(paymentId)}`).then((value) => this.cap4kPayment(value));
  }

  listPayments(request: PageRequest): Promise<PageResult<Payment>> {
    return this.client.post("/payments/search", this.searchBody(request, "paymentId")).then((value) => mapPage(value, (item) => this.cap4kPayment(item)));
  }

  getRefund(refundId: string): Promise<Refund> {
    return this.client.get<JsonRecord>(`/refunds/${pathId(refundId)}`).then((value) => mapRefund("cap4k", value));
  }

  listRefunds(request: PageRequest): Promise<PageResult<Refund>> {
    return this.client.post("/refunds/search", this.searchBody(request, "refundId")).then((value) => mapPage(value, (item) => mapRefund("cap4k", item)));
  }

  async getBill(billId: string): Promise<AuthoritativeBill> {
    const value = await this.client.get<JsonRecord>(`/authoritative-bills/${pathId(billId)}`);
    const id = requiredOne(value, ["billId", "billIdentity"], "权威账单响应缺少 billId。");
    const currency = text(value.currency) ?? "CNY";
    const revisions = records(value.revisions).map((revision) => {
      const completeness = text(revision.completeness) ?? null;
      return {
        billId: id,
        revision: text(revision.revision) ?? "",
        revisionId: text(revision.revisionId) ?? null,
        channelId: text(value.channelId) ?? "",
        merchantId: text(value.merchantId) ?? "",
        currency,
        businessDate: text(value.businessDate) ?? null,
        complete: completeness === "COMPLETE",
        completeness,
        payloadFingerprint: text(revision.payloadFingerprint) ?? null,
        rawEvidence: text(revision.rawEvidence) ?? null,
        records: records(revision.records).map((record) => ({
          recordId: requiredOne(record, ["recordId", "recordIdentity"], "权威账单记录缺少 recordId。"),
          recordIdentity: text(record.recordIdentity) ?? null,
          transactionKind: text(record.transactionKind) ?? "UNKNOWN",
          externalTransactionId: text(record.externalTransactionIdentity) ?? "",
          money: money(record.money, currency),
          status: text(record.rawStatus) ?? "UNKNOWN",
          rawStatus: text(record.rawStatus) ?? null,
          occurredAt: text(record.occurredAt) ?? null,
          receivedAt: text(record.receivedAt) ?? null,
          rawEvidence: text(record.rawEvidence) ?? null,
        })),
        publishedAt: text(revision.publishedAt) ?? null,
      };
    });
    return {
      billId: id,
      channelId: text(value.channelId) ?? "",
      merchantId: text(value.merchantId) ?? null,
      currency,
      businessDate: text(value.businessDate) ?? null,
      currentRevision: text(value.currentRevision) ?? null,
      currentRevisionId: text(value.currentRevisionId) ?? null,
      businessTimezone: text(value.businessTimezone) ?? null,
      createdAt: text(value.createdAt) ?? null,
      revisions,
      source: source("cap4k", value, id),
    };
  }

  getReconciliationRun(runId: string): Promise<ReconciliationRun> {
    return this.client.get<JsonRecord>(`/reconciliation-runs/${pathId(runId)}`).then((value) => this.cap4kRun(value));
  }

  async listReconciliationRuns(request: PageRequest): Promise<PageResult<ReconciliationRun>> {
    const body = this.searchBody(request, "runId");
    if (!body.merchantId) body.merchantId = "";
    const page = mapPage(
      await this.client.post("/reconciliation-runs/search", body),
      (item) => this.cap4kRun(item),
    );
    // CAP4K search summaries expose the authoritative bill's internal UUID as
    // `billId`, while run detail exposes the stable business `billIdentity`.
    // Resolve each visible row through the authoritative detail so the unified
    // ReconciliationRun.billId never changes meaning between list and detail.
    return {
      ...page,
      items: await Promise.all(page.items.map((item) => this.getReconciliationRun(item.runId))),
    };
  }

  getSettlement(settlementId: string): Promise<Settlement> {
    return this.client.get<JsonRecord>(`/merchant-settlements/${pathId(settlementId)}`).then((value) => this.cap4kSettlement(value));
  }

  listSettlements(request: PageRequest): Promise<PageResult<Settlement>> {
    const body = this.searchBody(request, "settlementId");
    if (request.filters?.period) {
      const [periodStart, periodEnd] = request.filters.period.split("/");
      body.periodStart = periodStart;
      body.periodEnd = periodEnd;
      delete body.period;
    }
    return this.client.post("/merchant-settlements/search", body).then((value) => mapPage(value, (item) => this.cap4kSettlement(item)));
  }

  getManualReview(reviewId: string): Promise<ManualReviewItem> {
    return this.client.get<JsonRecord>(`/manual-reviews/${pathId(reviewId)}`).then((value) => mapManualReview("cap4k", value));
  }

  listManualReviews(request: PageRequest): Promise<PageResult<ManualReviewItem>> {
    const body = this.searchBody(request, "reviewId");
    if (body.relatedResourceId) {
      body.originIdentity = body.relatedResourceId;
      delete body.relatedResourceId;
    }
    return this.client.post("/manual-reviews/search", body).then((value) => mapPage(value, (item) => mapManualReview("cap4k", item)));
  }

  getNotification(notificationId: string): Promise<MerchantNotification> {
    return this.client.get<JsonRecord>(`/merchant-notifications/${pathId(notificationId)}`).then((value) => mapNotification("cap4k", value));
  }

  listNotifications(request: PageRequest): Promise<PageResult<MerchantNotification>> {
    return this.client.post("/merchant-notifications/search", this.searchBody(request, "notificationId")).then((value) => mapPage(value, (item) => mapNotification("cap4k", item)));
  }

  getPaymentTimeline(paymentId: string, request: PageRequest = {}): Promise<PaymentTimeline> {
    const query = new URLSearchParams();
    if (request.pageSize) query.set("pageSize", String(request.pageSize));
    if (request.cursor) query.set("cursor", request.cursor);
    const suffix = query.toString() ? `?${query}` : "";
    return this.client.get(`/payments/${pathId(paymentId)}/timeline${suffix}`).then((value) => mapTimeline("cap4k", paymentId, value));
  }

  private cap4kPayment(value: JsonRecord): Payment {
    return mapPayment("cap4k", value);
  }

  private cap4kSettlement(value: JsonRecord): Settlement {
    const settlement = mapSettlement("cap4k", value);
    // CAP4K creates the replacement atomically while voiding the still
    // unexecuted original. Calling /voids again after VOIDED is invalid.
    settlement.actions = settlement.actions.filter((item) => item.kind !== "CREATE_SETTLEMENT_REPLACEMENT");
    if (settlement.status === "READY_FOR_CONFIRMATION") {
      settlement.actions.push(action("CREATE_SETTLEMENT_REPLACEMENT", "作废并创建替代结算", "danger"));
    }
    return settlement;
  }

  private cap4kRun(value: JsonRecord): ReconciliationRun {
    const run = mapReconciliationRun("cap4k", value);
    run.actions = run.actions.map((item) => item.kind === "COMPLETE_RECONCILIATION"
      ? alternativeAction(
        "COMPLETE_RECONCILIATION",
        "观察 Run 自动完成",
        "CAP4K 没有额外 complete 命令。",
        "差异处置或事实确认解除阻断后，重新读取 Run 观察服务端自动收敛。",
        "danger",
      )
      : item);
    return run;
  }

  private searchBody(request: PageRequest, idField: string): Record<string, unknown> {
    const body = { ...(request.filters ?? {}), cursor: request.cursor, pageSize: request.pageSize } as Record<string, unknown>;
    if (body.resourceId) {
      body[idField] = body.resourceId;
      delete body.resourceId;
    }
    return compact(body);
  }

  private async postReceipt(path: string, body: unknown, fallback: { type: string; id?: string }, headers?: Record<string, string>): Promise<OperationReceipt> {
    const response = await this.client.post(path, body, headers);
    return mapReceipt("cap4k", response, fallback);
  }

  private async receiveVerifiedResult(input: ChannelResultInput, resourceType: string): Promise<OperationReceipt> {
    const rawPayload = input.rawPayload ?? JSON.stringify({
      kind: input.resourceType,
      resourceId: input.resourceId,
      attemptId: input.attemptId,
      resultIdentity: input.resultIdentity,
      outcome: input.outcome,
      occurredAt: input.occurredAt,
    });
    const associationIdentity = input.resourceType === "SETTLEMENT"
      ? [input.resourceId, input.attemptId, input.executionGroupIdentity ?? "", input.requestIdentity ?? "", input.externalTransactionId].join("|")
      : [input.resourceId, input.attemptId, input.externalTransactionId].join("|");
    await this.client.post("/reference-fixtures/callback-evidence", {
      idempotencyKey: `evidence:${input.resultIdentity}`,
      kind: input.resourceType,
      channelId: input.channelId,
      externalIdentity: input.resultIdentity,
      associationIdentity,
      money: toWireMoney(input.money),
      rawPayload,
    });

    const result = input.outcome === "SUCCESS" ? "SUCCESS" : input.outcome === "FAILURE" ? (input.failureDisposition === "RETRYABLE" ? "RETRYABLE_FAILURE" : "FAILED") : "UNKNOWN";
    let path: string;
    let body: Record<string, unknown>;
    if (input.resourceType === "PAYMENT") {
      path = "/channel/payment-results";
      body = { channelId: input.channelId, notificationId: input.resultIdentity, paymentId: input.resourceId, paymentAttemptId: input.attemptId, channelTransactionId: input.externalTransactionId, money: toWireMoney(input.money), result, occurredAt: input.occurredAt, rawPayload };
    } else if (input.resourceType === "REFUND") {
      path = "/channel/refund-results";
      body = { channelId: input.channelId, notificationId: input.resultIdentity, refundId: input.resourceId, refundAttemptId: input.attemptId, channelRefundId: input.externalTransactionId, money: toWireMoney(input.money), result, occurredAt: input.occurredAt, rawPayload };
    } else {
      path = "/channel/settlement-results";
      body = { channelId: input.channelId, notificationId: input.resultIdentity, settlementId: input.resourceId, executionId: input.attemptId, executionGroupIdentity: input.executionGroupIdentity, requestIdentity: input.requestIdentity, externalSettlementIdentity: input.externalTransactionId, money: toWireMoney(input.money), result, resultCode: null, occurredAt: input.occurredAt, receivedAt: input.occurredAt, rawPayload };
    }
    return this.postReceipt(path, compact(body), { type: resourceType, id: input.resourceId });
  }

  private async signalAndRerun(input: { billId: string; revision: number; idempotencyKey: string; signalIdentity: string; channelId: string; currency: string; businessDate: string; businessTimezone: string; publishedAt?: string }): Promise<OperationReceipt> {
    const publishedAt = input.publishedAt ?? this.now().toISOString();
    const signal = await this.client.post<JsonRecord>(`/reference-fixtures/bills/${pathId(input.billId)}/signals`, {
      channelId: input.channelId,
      businessDate: input.businessDate,
      currency: input.currency,
      businessTimezone: input.businessTimezone,
      signalIdentity: input.signalIdentity,
      announcedRevision: String(input.revision),
      publishedAt,
    });
    const runId = text(signal.runId);
    if (!runId) throw new BusinessError({ code: "REFERENCE_RUN_NOT_CREATED", message: text(signal.diagnostic) ?? "账单信号未产生 ReconciliationRun。", fields: [], retryable: true, diagnostic: signal });
    return this.postReceipt(`/reconciliation-runs/${pathId(runId)}/reruns`, { idempotencyKey: input.idempotencyKey }, { type: "ReconciliationRun", id: runId }, this.actorHeaders(this.actorAlias));
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private actorHeaders(alias: string): Record<string, string> {
    return { "X-Reference-Actor-Context": alias };
  }

  private requireActorAlias(input: { actorAlias?: string; reason: string; evidenceRefs: string[] }): string {
    const actorAlias = input.actorAlias?.trim();
    if (!actorAlias) {
      throw new BusinessError({
        code: "RESPONSIBILITY_ACTOR_REQUIRED",
        message: "CAP4K 人工责任动作必须提供可由服务端 registry 解析的 actorAlias。",
        fields: [{ field: "actorAlias", message: "请选择可信责任人 alias。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    if (!input.reason.trim()) {
      throw new BusinessError({
        code: "RESPONSIBILITY_REASON_REQUIRED",
        message: "人工责任动作必须提供 reason。",
        fields: [{ field: "reason", message: "请输入处置原因。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    if (!input.evidenceRefs.some((item) => item.trim().length > 0)) {
      throw new BusinessError({
        code: "RESPONSIBILITY_EVIDENCE_REQUIRED",
        message: "人工责任动作必须提供至少一条 evidence。",
        fields: [{ field: "evidenceRefs", message: "请输入证据引用。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    return actorAlias;
  }

  private unsupported(message: string, capabilityId?: string): BusinessError {
    return new BusinessError({
      code: "CAPABILITY_TRANSPORT_UNAVAILABLE",
      message,
      details: capabilityId ? { capabilityId, declaration: this.profile.capabilities.find((item) => item.id === capabilityId) } : undefined,
      fields: [],
      retryable: false,
    });
  }

  private transportUnavailable(message: string, capabilityId: string): ReferenceCommandResult {
    return {
      effect: "unavailable",
      summary: message,
      data: { capabilityId, transport: "NO_READ_OR_CONTROL_ROUTE" },
    };
  }

  private healthResult(status: HealthStatus["status"], checkedAt: string, message: string): HealthStatus {
    return { status, checkedAt, message, source: { adapter: "cap4k", sourceStatus: status } };
  }
}

function cap4kChannelScript(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized === "SUCCESS") return "ACCEPT_THEN_SUCCESS";
  if (normalized === "FAILURE") return "ACCEPT_THEN_FAILURE";
  if (normalized === "UNKNOWN") return "ACCEPT_THEN_UNKNOWN";
  return normalized;
}

function cap4kReconciliationConclusion(value: "ACCEPT_DIFFERENCE" | "ESCALATE" | "CONFIRM_PLATFORM_FACT"): string {
  return value === "ACCEPT_DIFFERENCE" ? "NO_SETTLEMENT_IMPACT" : value;
}

function cap4kSettlementImpact(value: "ALLOW" | "BLOCK" | "CONFIRM"): string {
  if (value === "ALLOW") return "DOES_NOT_BLOCK_SETTLEMENT";
  if (value === "BLOCK") return "BLOCKS_SETTLEMENT";
  return "CONFIRMS_SETTLEMENT_FACT";
}

function cap4kManualReviewOutcome(value: string, reviewType?: string): string {
  const outcome = value.trim().toUpperCase();
  const type = reviewType?.trim().toUpperCase() ?? "";
  if (type.includes("PAYMENT")) {
    if (outcome === "CONFIRM_SUCCESS") return "ACCEPT_LATE_SUCCESS";
    if (outcome === "KEEP_ACCEPTED_SUCCESS") return "KEEP_ACCEPTED_SUCCESS_WITH_REMEDIATION";
  }
  if (type.includes("RECONCILIATION") && outcome === "ACCEPT_DIFFERENCE") return "NO_SETTLEMENT_IMPACT";
  return outcome;
}
