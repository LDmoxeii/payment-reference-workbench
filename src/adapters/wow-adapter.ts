import { BusinessError } from "../domain/errors";
import type {
  AuthoritativeBill,
  BackendProfile,
  BusinessCommand,
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
import { arrayValue, HttpClient, type JsonRecord } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import type { AdapterRuntimeOptions } from "./factory";
import {
  compact,
  mapBill,
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
  object,
  pathId,
  queryString,
  records,
  text,
  toWireMoney,
} from "./shared";

const capabilities: BackendProfile["capabilities"] = [
  { id: "payment", label: "payment", description: "支付意图、attempt、提交、可信结果与到期", level: "full" },
  { id: "refund", label: "refund", description: "退款申请、attempt、结果与预算", level: "full" },
  { id: "authoritative-lists", label: "authoritative-lists", description: "五类权威 keyset cursor 列表", level: "full" },
  { id: "reconciliation", label: "reconciliation", description: "账单 revision、Run、差异处置与事实确认", level: "full" },
  { id: "settlement", label: "settlement", description: "准备、冻结、执行三结果、作废与替代", level: "full" },
  { id: "manual-review", label: "manual-review", description: "权威人工核对与责任处置", level: "full" },
  { id: "notification", label: "notification", description: "稳定通知身份、投递历史与重试", level: "full" },
  { id: "timeline", label: "timeline", description: "paymentId 全链路 trace", level: "full" },
  { id: "reference-lab", label: "reference-lab", description: "fixture、policy、逻辑时钟、四类执行脚本及签名可信结果", level: "full" },
  { id: "bill-detail", label: "bill-detail", description: "独立读取权威账单及 revisions", level: "full" },
  { id: "channel-script", label: "channel-script", description: "按 fixture 和 channel 配置、读取与重置支付提交脚本", level: "full" },
  { id: "payment-close-expired", label: "payment-close-expired", description: "按单个 payment 执行到期关闭", level: "full" },
  { id: "reconciliation-complete", label: "reconciliation-complete", description: "显式完成已解除阻断的 Run", level: "full" },
  { id: "bill-read-script", label: "bill-read-script", description: "按账单 revision 配置、读取与重置暂不可读次数", level: "full" },
  { id: "notification-sender-script", label: "notification-sender-script", description: "按通知或来源事实配置、读取与重置投递结果脚本", level: "full" },
  { id: "settlement-executor-script", label: "settlement-executor-script", description: "按 fixture 和 channel 配置、读取与重置结算执行脚本", level: "full" },
  { id: "settlement-execution-identity", label: "settlement-execution-identity", description: "执行命令接受 caller-supplied executionId", level: "full" },
];

export class WowPaymentAdapter implements PaymentBackendAdapter {
  readonly profile: BackendProfile;
  private readonly client: HttpClient;
  private readonly fixtureId: string;

  constructor(private readonly options: AdapterRuntimeOptions) {
    this.client = new HttpClient({ baseUrl: options.apiBaseUrl, fetchImpl: options.fetchImpl });
    this.fixtureId = options.fixtureId ?? "reference-default";
    this.profile = {
      id: "wow",
      label: "WOW Reference Payment",
      apiBaseUrl: options.apiBaseUrl,
      referenceOnly: true,
      capabilities,
      implementationDifferences: [
        { topic: "命令收敛", unifiedMeaning: "OperationReceipt + readAfter", implementation: "事件提交后通过 POLL 观察 Projection" },
        { topic: "权威列表", unifiedMeaning: "opaque keyset cursor", implementation: "GET collection + query parameters" },
        { topic: "责任字段", unifiedMeaning: "actor/reason/evidence", implementation: "actorId/actorRole 放在命令 body" },
        { topic: "可信回调", unifiedMeaning: "服务端验证 canonical callback", implementation: "先签发 fixture verificationToken，再提交结果" },
        { topic: "全链路", unifiedMeaning: "payment timeline", implementation: "GET /payments/{id}/trace" },
      ],
    };
  }

  async health(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    try {
      await this.client.get(`/reference/fixtures/${pathId(this.fixtureId)}/policy`);
      return this.healthResult("connected", checkedAt, "WOW reference API 与 fixture 可访问。");
    } catch (error) {
      if (error instanceof BusinessError && error.httpStatus !== undefined) {
        return this.healthResult("connected", checkedAt, "WOW API 可访问；当前 fixture 尚未登记，可在 Reference Lab 初始化。");
      }
      return this.healthResult("unreachable", checkedAt, "无法连接 WOW reference API。");
    }
  }

  async getReferenceEnvironment(fixtureId = this.fixtureId): Promise<ReferenceEnvironment> {
    const fixture = await this.client.get<JsonRecord>(`/reference/fixtures/${pathId(fixtureId)}`);
    const currentTime = await this.readFixtureClock(fixtureId);
    const channelId = arrayValue(fixture.allowedChannelIds).find((value): value is string => typeof value === "string") ?? "fake";
    return {
      fixtureId,
      actorAlias: "finance-operator",
      actorAliases: {
        paymentReviewer: "finance-operator",
        refundReviewer: "finance-operator",
        reconciliationOperator: "finance-operator",
        settlementOperator: "finance-operator",
        settlementReviewer: "finance-operator",
      },
      currentTime,
      policy: object(fixture.policy) as ReferenceEnvironment["policy"],
      channelId,
      merchantId: "reference-merchant",
      paymentMethod: "DEFAULT",
    };
  }

  async executeReference(command: ReferenceCommand): Promise<ReferenceCommandResult> {
    switch (command.type) {
      case "REGISTER_ENVIRONMENT": {
        const input = command.input;
        const fixture = await this.client.post<JsonRecord>("/reference/fixtures", {
          fixtureId: input.fixtureId,
          policy: input.policy,
          initialTime: input.currentTime,
          allowedChannelIds: [input.channelId],
        });
        const configuration = await this.client.post<JsonRecord>("/configurations", {
          configurationId: `${input.fixtureId}-${input.merchantId}-${input.channelId}`,
          merchantId: input.merchantId,
          channelId: input.channelId,
          currency: "CNY",
          paymentMethod: input.paymentMethod ?? "DEFAULT",
          idempotencyKey: `reference-environment:${input.fixtureId}:${input.merchantId}:${input.channelId}`,
        });
        return {
          effect: "applied",
          summary: `已登记 WOW fixture ${input.fixtureId} 与商户渠道配置。`,
          receipt: mapReceipt("wow", configuration, { type: "ChannelConfiguration" }),
          data: { fixture, configuration },
        };
      }
      case "SET_CLOCK": {
        const data = await this.client.post<JsonRecord>(`/reference/fixtures/${pathId(command.input.fixtureId)}/clock`, { instant: command.input.instant });
        return { effect: "applied", summary: "逻辑时钟已设置。", data };
      }
      case "ADVANCE_CLOCK": {
        const data = await this.client.post<JsonRecord>(`/reference/fixtures/${pathId(command.input.fixtureId)}/clock`, { advanceBy: command.input.duration });
        return { effect: "applied", summary: "逻辑时钟已推进。", data };
      }
      case "CONFIGURE_CHANNEL": {
        const input = command.input;
        const data = await this.client.post(`/reference/payment-channel-scripts/${pathId(input.channelId)}`, {
          fixtureId: input.fixtureId,
          script: wowPaymentScript(input.outcome),
        });
        return { effect: "applied", summary: "WOW payment channel script 已配置。", data };
      }
      case "READ_CHANNEL_SCRIPT": {
        const input = command.input;
        const data = await this.client.get(`/reference/payment-channel-scripts/${pathId(input.channelId)}${queryString({ fixtureId: input.fixtureId })}`);
        return { effect: "applied", summary: "已读取 WOW payment channel script。", data };
      }
      case "RESET_CHANNEL_SCRIPT": {
        const input = command.input;
        const data = await this.client.post(`/reference/payment-channel-scripts/${pathId(input.channelId)}/reset`, { fixtureId: input.fixtureId });
        return { effect: "applied", summary: "WOW payment channel script 已重置。", data };
      }
      case "CONFIGURE_BILL_PROVIDER": {
        const input = command.input;
        const data = await this.client.post(this.billScriptPath(input.billId, input.revision), {
          fixtureId: input.fixtureId,
          unavailableReadCount: input.unavailableReadCount,
        });
        return { effect: "applied", summary: "WOW bill provider script 已配置。", data };
      }
      case "READ_BILL_PROVIDER_SCRIPT": {
        const input = command.input;
        const data = await this.client.get(`${this.billScriptPath(input.billId, input.revision)}${queryString({ fixtureId: input.fixtureId })}`);
        return { effect: "applied", summary: "已读取 WOW bill provider script。", data };
      }
      case "RESET_BILL_PROVIDER_SCRIPT": {
        const input = command.input;
        const data = await this.client.post(`${this.billScriptPath(input.billId, input.revision)}/reset`, { fixtureId: input.fixtureId });
        return { effect: "applied", summary: "WOW bill provider script 已重置。", data };
      }
      case "CONFIGURE_NOTIFICATION_SENDER": {
        const input = command.input;
        const data = await this.client.post("/reference/notification-sender-scripts", {
          fixtureId: input.fixtureId,
          selector: this.notificationSelector(input),
          script: input.outcome,
        });
        return { effect: "applied", summary: "WOW notification sender script 已配置。", data };
      }
      case "READ_NOTIFICATION_SENDER_SCRIPT": {
        const input = command.input;
        const selector = this.notificationSelector(input);
        const data = await this.client.get(`/reference/notification-sender-scripts${queryString({ fixtureId: input.fixtureId, ...selector })}`);
        return { effect: "applied", summary: "已读取 WOW notification sender script。", data };
      }
      case "RESET_NOTIFICATION_SENDER_SCRIPT": {
        const input = command.input;
        const data = await this.client.post("/reference/notification-sender-scripts/reset", {
          fixtureId: input.fixtureId,
          selector: this.notificationSelector(input),
        });
        return { effect: "applied", summary: "WOW notification sender script 已重置。", data };
      }
      case "CONFIGURE_SETTLEMENT_EXECUTOR": {
        const input = command.input;
        const data = await this.client.post(`/reference/settlement-executor-scripts/${pathId(input.channelId)}`, {
          fixtureId: input.fixtureId,
          script: input.outcome,
        });
        return { effect: "applied", summary: "WOW settlement executor script 已配置；执行时以 caller executionId 消费。", data };
      }
      case "READ_SETTLEMENT_EXECUTOR_SCRIPT": {
        const input = command.input;
        const data = await this.client.get(`/reference/settlement-executor-scripts/${pathId(input.channelId)}${queryString({ fixtureId: input.fixtureId })}`);
        return { effect: "applied", summary: "已读取 WOW settlement executor script。", data };
      }
      case "RESET_SETTLEMENT_EXECUTOR_SCRIPT": {
        const input = command.input;
        const data = await this.client.post(`/reference/settlement-executor-scripts/${pathId(input.channelId)}/reset`, { fixtureId: input.fixtureId });
        return { effect: "applied", summary: "WOW settlement executor script 已重置。", data };
      }
      case "REGISTER_BILL": {
        const input = command.input;
        const response = await this.client.post<JsonRecord>("/reference/statements", {
          statementId: input.billId,
          revision: input.revision,
          channelId: input.channelId,
          currency: input.currency,
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
          reconciliationDate: input.businessDate,
          businessTimezone: input.businessTimezone,
          records: input.records.map((item) => ({
            recordId: item.recordId,
            transactionKind: item.transactionKind,
            externalTransactionId: item.externalTransactionId,
            amount: toWireMoney(item.money),
            status: item.status,
            occurredAt: item.occurredAt,
          })),
          fixtureId: input.fixtureId ?? this.fixtureId,
        });
        const receipt = mapReceipt("wow", response, { type: "AuthoritativeBillRevision", id: `${input.billId}:${input.revision}` });
        const script = input.unavailableReadCount === undefined ? undefined : await this.client.post(
          this.billScriptPath(input.billId, input.revision),
          { fixtureId: input.fixtureId ?? this.fixtureId, unavailableReadCount: input.unavailableReadCount },
        );
        return { effect: "applied", summary: "权威账单 revision 已登记，读取脚本已按需配置。", receipt, data: { bill: response, script } };
      }
      case "RUN_MAINTENANCE":
        return { effect: "alternative", summary: "WOW 的到期、UNKNOWN 与对账推进通过显式业务命令和逻辑时钟观察完成。", data: command.input };
    }
  }

  async execute(command: BusinessCommand): Promise<OperationReceipt> {
    switch (command.type) {
      case "CREATE_PAYMENT": {
        const input = command.input;
        return this.postReceipt("/payments", compact({
          merchantId: input.merchantId,
          merchantOrderNo: input.merchantOrderId,
          idempotencyKey: input.idempotencyKey,
          amount: toWireMoney(input.money),
          paymentMethod: input.paymentMethod,
          expiresAt: input.expiresAt,
          fixtureId: input.fixtureId ?? this.fixtureId,
        }), { type: "Payment" });
      }
      case "CREATE_PAYMENT_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/payments/${pathId(input.resourceId)}/attempts`, compact({
          idempotencyKey: input.idempotencyKey,
          attemptId: input.attemptId,
          paymentMethod: input.paymentMethod,
          riskReason: input.riskReason,
        }), { type: "Payment", id: input.resourceId });
      }
      case "SUBMIT_PAYMENT_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/payments/${pathId(input.resourceId)}/attempts/${pathId(input.attemptId)}/submissions`, {
          idempotencyKey: input.idempotencyKey,
          submissionId: input.submissionId ?? input.idempotencyKey,
          fixtureId: this.fixtureId,
        }, { type: "Payment", id: input.resourceId });
      }
      case "RECEIVE_PAYMENT_RESULT":
        return this.receiveSignedResult(command.input, `/payments/${pathId(command.input.resourceId)}/results`, "Payment");
      case "CLOSE_EXPIRED_PAYMENT":
        return this.postReceipt(`/payments/${pathId(command.input.paymentId)}/expire`, undefined, { type: "Payment", id: command.input.paymentId });
      case "REQUEST_REFUND": {
        const input = command.input;
        return this.postReceipt(`/payments/${pathId(input.paymentId)}/refunds`, compact({
          merchantId: input.merchantId,
          merchantRefundNo: input.merchantRefundId,
          idempotencyKey: input.idempotencyKey,
          amount: toWireMoney(input.money),
          reason: input.reason,
          requestedAt: input.requestedAt,
          fixtureId: input.fixtureId ?? this.fixtureId,
        }), { type: "Refund" });
      }
      case "CREATE_REFUND_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/refunds/${pathId(input.resourceId)}/attempts`, compact({
          idempotencyKey: input.idempotencyKey,
          attemptId: input.attemptId,
          fixtureId: input.fixtureId ?? this.fixtureId,
        }), { type: "Refund", id: input.resourceId });
      }
      case "SUBMIT_REFUND_ATTEMPT": {
        const input = command.input;
        return this.postReceipt(`/refunds/${pathId(input.resourceId)}/attempts/${pathId(input.attemptId)}/submissions`, {
          idempotencyKey: input.idempotencyKey,
          submissionId: input.submissionId ?? input.idempotencyKey,
        }, { type: "Refund", id: input.resourceId });
      }
      case "RECEIVE_REFUND_RESULT":
        return this.receiveSignedResult(command.input, `/refunds/${pathId(command.input.resourceId)}/results`, "Refund");
      case "SIGNAL_BILL_AVAILABLE": {
        const input = command.input;
        return this.postReceipt("/reconciliation/bill-available", {
          statementId: input.billId,
          revision: input.revision,
          merchantId: input.merchantId,
          signalIdentity: input.signalIdentity,
          idempotencyKey: input.idempotencyKey,
          readAttemptIdentity: input.idempotencyKey,
          fixtureId: this.fixtureId,
        }, { type: "AuthoritativeBill", id: input.billId });
      }
      case "RUN_RECONCILIATION": {
        const input = command.input;
        return this.postReceipt("/reconciliation-runs", {
          merchantId: input.merchantId,
          statementId: input.billId,
          revision: input.revision,
          idempotencyKey: input.idempotencyKey,
          runId: input.runId,
        }, { type: "ReconciliationRun", id: input.runId });
      }
      case "RERUN_RECONCILIATION": {
        const input = command.input;
        return this.postReceipt("/reconciliation-runs/reruns", {
          merchantId: input.merchantId,
          statementId: input.billId,
          revision: input.revision,
          idempotencyKey: input.idempotencyKey,
          runId: input.runId,
        }, { type: "ReconciliationRun", id: input.runId });
      }
      case "DISPOSE_RECONCILIATION_DIFFERENCE": {
        const input = command.input;
        const responsibility = this.responsibilityBody(input, "RECONCILIATION_REVIEWER", true);
        return this.postReceipt(`/reconciliation-runs/${pathId(input.runId)}/differences/dispositions`, {
          ...responsibility,
          revision: input.revision,
          differenceIdentity: input.differenceId,
          conclusion: wowReconciliationConclusion(input.conclusion),
          settlementImpact: wowSettlementImpact(input.settlementImpact),
        }, { type: "ReconciliationRun", id: input.runId });
      }
      case "CONFIRM_RECONCILIATION_FACT": {
        const input = command.input;
        const responsibility = this.responsibilityBody(input, "RECONCILIATION_REVIEWER", true);
        return this.postReceipt(`/reconciliation-runs/${pathId(input.runId)}/differences/confirmations`, {
          ...responsibility,
          revision: input.revision,
          differenceIdentity: input.differenceId,
          confirmation: input.confirmation ?? {},
        }, { type: "ReconciliationRun", id: input.runId });
      }
      case "COMPLETE_RECONCILIATION": {
        const input = command.input;
        this.responsibilityBody(input, "RECONCILIATION_REVIEWER");
        return this.postReceipt(`/reconciliation-runs/${pathId(input.runId)}/complete`, {
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
        }, { type: "ReconciliationRun", id: input.runId });
      }
      case "PREPARE_SETTLEMENT": {
        const input = command.input;
        return this.postReceipt("/settlements/prepare", {
          merchantId: input.merchantId,
          currency: input.currency,
          channelId: input.channelId ?? "fake",
          reconciliationDate: businessDateBefore(input.periodEnd, input.businessTimezone),
          businessTimezone: input.businessTimezone,
          settlementId: input.settlementId,
          idempotencyKey: input.idempotencyKey,
          fixtureId: input.fixtureId ?? this.fixtureId,
        }, { type: "Settlement", id: input.settlementId });
      }
      case "CONFIRM_SETTLEMENT": {
        const input = command.input;
        return this.postReceipt(`/settlements/${pathId(input.settlementId)}/confirm`, this.responsibilityBody(input), { type: "Settlement", id: input.settlementId });
      }
      case "EXECUTE_SETTLEMENT": {
        const input = command.input;
        return this.postReceipt(`/settlements/${pathId(input.settlementId)}/executions`, {
          merchantId: input.merchantId,
          executionId: input.executionId,
          idempotencyKey: input.idempotencyKey,
          reviewAfterMinutes: input.reviewAfterMinutes ?? 30,
          fixtureId: this.fixtureId,
        }, { type: "Settlement", id: input.settlementId });
      }
      case "RECEIVE_SETTLEMENT_RESULT":
        return this.receiveSignedResult(command.input, `/settlements/${pathId(command.input.resourceId)}/results`, "Settlement");
      case "VOID_SETTLEMENT": {
        const input = command.input;
        return this.postReceipt(`/settlements/${pathId(input.settlementId)}/void`, this.responsibilityBody(input), { type: "Settlement", id: input.settlementId });
      }
      case "CREATE_SETTLEMENT_REPLACEMENT": {
        const input = command.input;
        return this.postReceipt(`/settlements/${pathId(input.settlementId)}/replace`, {
          ...this.responsibilityBody(input),
          replacementSettlementId: input.replacementSettlementId,
        }, { type: "Settlement", id: input.replacementSettlementId });
      }
      case "RESOLVE_MANUAL_REVIEW": {
        const input = command.input;
        return this.postReceipt(`/manual-reviews/${pathId(input.reviewId)}/resolve`, {
          ...this.responsibilityBody(input),
          outcome: wowManualReviewOutcome(input.outcome),
        }, { type: "ManualReviewItem", id: input.reviewId });
      }
      case "RETRY_NOTIFICATION": {
        const input = command.input;
        return this.postReceipt(`/notifications/${pathId(input.notificationId)}/retries`, {
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
          fixtureId: input.fixtureId ?? this.fixtureId,
        }, { type: "MerchantNotification", id: input.notificationId });
      }
    }
  }

  getOperation(operationId: string): Promise<Operation> {
    return this.client.get(`/operations/${pathId(operationId)}`).then((value) => mapOperation("wow", value));
  }

  getPayment(paymentId: string): Promise<Payment> {
    return this.client.get<JsonRecord>(`/payments/${pathId(paymentId)}`).then((value) => mapPayment("wow", value));
  }

  listPayments(request: PageRequest): Promise<PageResult<Payment>> {
    return this.client.get(`/payments${this.listQuery(request, "paymentId")}`).then((value) => mapPage(value, (item) => mapPayment("wow", item)));
  }

  getRefund(refundId: string): Promise<Refund> {
    return this.client.get<JsonRecord>(`/refunds/${pathId(refundId)}`).then((value) => mapRefund("wow", value));
  }

  listRefunds(request: PageRequest): Promise<PageResult<Refund>> {
    const filters = { ...request.filters, status: request.filters?.status === "REQUESTED" ? "CREATED" : request.filters?.status };
    return this.client.get(`/refunds${this.listQuery({ ...request, filters }, "refundId")}`).then((value) => mapPage(value, (item) => mapRefund("wow", item)));
  }

  async getBill(billId: string): Promise<AuthoritativeBill> {
    const [bill, revisions] = await Promise.all([
      this.client.get<JsonRecord>(`/reference/statements/${pathId(billId)}`),
      this.client.get<unknown[]>(`/reference/statements/${pathId(billId)}/revisions`),
    ]);
    return mapBill("wow", { ...bill, revisions });
  }

  getReconciliationRun(runId: string): Promise<ReconciliationRun> {
    return this.client.get<JsonRecord>(`/reconciliation-runs/${pathId(runId)}`).then((value) => mapReconciliationRun("wow", value));
  }

  listReconciliationRuns(request: PageRequest): Promise<PageResult<ReconciliationRun>> {
    return this.client.get(`/reconciliation-runs${this.listQuery(request, "runId")}`).then((value) => mapPage(value, (item) => mapReconciliationRun("wow", item)));
  }

  getSettlement(settlementId: string): Promise<Settlement> {
    return this.client.get<JsonRecord>(`/settlements/${pathId(settlementId)}`).then((value) => mapSettlement("wow", value));
  }

  listSettlements(request: PageRequest): Promise<PageResult<Settlement>> {
    const reverse: Record<string, string> = { READY_FOR_CONFIRMATION: "DRAFT", EXECUTING: "PROCESSING", SETTLED: "SUCCEEDED", EXECUTION_FAILED: "FAILED", CONFIRMED: "REVIEW_REQUIRED" };
    const filters = { ...request.filters, status: request.filters?.status ? reverse[request.filters.status] ?? request.filters.status : undefined };
    return this.client.get(`/settlements${this.listQuery({ ...request, filters }, "settlementId")}`).then((value) => mapPage(value, (item) => mapSettlement("wow", item)));
  }

  getManualReview(reviewId: string): Promise<ManualReviewItem> {
    return this.client.get<JsonRecord>(`/manual-reviews/${pathId(reviewId)}`).then((value) => mapManualReview("wow", value));
  }

  listManualReviews(request: PageRequest): Promise<PageResult<ManualReviewItem>> {
    return this.client.get(`/manual-reviews${this.listQuery(request, "reviewId")}`).then((value) => mapPage(value, (item) => mapManualReview("wow", item)));
  }

  getNotification(notificationId: string): Promise<MerchantNotification> {
    return this.client.get<JsonRecord>(`/notifications/${pathId(notificationId)}`).then((value) => mapNotification("wow", value));
  }

  async listNotifications(request: PageRequest): Promise<PageResult<MerchantNotification>> {
    const response = await this.client.get(`/notifications${queryString({ ...(request.filters ?? {}) } as Record<string, unknown>)}`);
    const items = records(response).map((item) => mapNotification("wow", item));
    return { items, pageSize: items.length, nextCursor: null };
  }

  getPaymentTimeline(paymentId: string): Promise<PaymentTimeline> {
    return this.client.get(`/payments/${pathId(paymentId)}/trace`).then((value) => mapTimeline("wow", paymentId, value));
  }

  private listQuery(request: PageRequest, idField: string): string {
    const filters = { ...(request.filters ?? {}) } as Record<string, unknown>;
    if (filters.resourceId) {
      filters[idField] = filters.resourceId;
      delete filters.resourceId;
    }
    return queryString({ ...filters, cursor: request.cursor, pageSize: request.pageSize, fixtureId: this.fixtureId });
  }

  private async readFixtureClock(fixtureId: string): Promise<string | null> {
    // WOW has no read-only clock route; advancing by zero is an adapter-level compatibility read.
    const response = await this.client.post<JsonRecord>(`/reference/fixtures/${pathId(fixtureId)}/clock`, { advanceBy: "PT0S" });
    return text(response.instant) ?? null;
  }

  private billScriptPath(billId: string, revision: number): string {
    return `/reference/bill-provider-scripts/${pathId(billId)}/revisions/${revision}`;
  }

  private notificationSelector(input: { notificationId?: string; sourceKind?: string; sourceFactId?: string }): JsonRecord {
    return compact({
      notificationId: input.notificationId,
      sourceKind: input.sourceKind,
      sourceFactIdentity: input.sourceFactId,
    });
  }

  private async postReceipt(path: string, body: unknown, fallback: { type: string; id?: string }): Promise<OperationReceipt> {
    const response = await this.client.post(path, body);
    return mapReceipt("wow", response, fallback);
  }

  private async receiveSignedResult(input: Extract<BusinessCommand, { type: "RECEIVE_PAYMENT_RESULT" | "RECEIVE_REFUND_RESULT" | "RECEIVE_SETTLEMENT_RESULT" }>["input"], path: string, type: string): Promise<OperationReceipt> {
    const outcome = input.outcome === "SUCCESS" ? "SUCCEEDED" : input.outcome === "FAILURE" ? "FAILED" : "UNKNOWN";
    const unsigned = compact({
      resultType: input.resourceType,
      channelId: input.channelId,
      resultIdentity: input.resultIdentity,
      attemptRef: input.attemptId,
      outcome,
      amount: toWireMoney(input.money),
      occurredAt: input.occurredAt,
      externalTransactionId: input.externalTransactionId,
      failureDisposition: input.failureDisposition,
    });
    const fixtureId = input.fixtureId ?? this.fixtureId;
    const tokenResponse = await this.client.post<JsonRecord>(`/reference/fixtures/${pathId(fixtureId)}/tokens`, unsigned);
    const response = await this.client.post(path, { ...unsigned, fixtureId, verificationToken: text(tokenResponse.verificationToken) });
    return mapReceipt("wow", response, { type, id: input.resourceId });
  }

  private responsibilityBody(
    input: { merchantId: string; idempotencyKey: string; actorId?: string; actorAlias?: string; actorRole?: string; reason: string; evidenceRefs: string[] },
    defaultRole = "FINANCE_OPERATOR",
    includeActorRole = false,
  ) {
    const actorId = input.actorId?.trim() || input.actorAlias?.trim();
    if (!actorId) {
      throw new BusinessError({
        code: "RESPONSIBILITY_ACTOR_REQUIRED",
        message: "人工责任动作必须提供可信 actorId 或可映射的 actorAlias。",
        fields: [{ field: "actorAlias", message: "请选择可信责任人。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw new BusinessError({
        code: "RESPONSIBILITY_REASON_REQUIRED",
        message: "人工责任动作必须提供 reason。",
        fields: [{ field: "reason", message: "请输入处置原因。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    const evidenceRefs = input.evidenceRefs.map((item) => item.trim()).filter(Boolean);
    if (evidenceRefs.length === 0) {
      throw new BusinessError({
        code: "RESPONSIBILITY_EVIDENCE_REQUIRED",
        message: "人工责任动作必须提供至少一条 evidence。",
        fields: [{ field: "evidenceRefs", message: "请输入证据引用。", code: "REQUIRED" }],
        retryable: false,
      });
    }
    return {
      merchantId: input.merchantId,
      actorId,
      ...(includeActorRole ? { actorRole: input.actorRole?.trim() || defaultRole } : {}),
      reason,
      evidenceRefs,
      idempotencyKey: input.idempotencyKey,
    };
  }

  private healthResult(status: HealthStatus["status"], checkedAt: string, message: string): HealthStatus {
    return { status, checkedAt, message, source: { adapter: "wow", sourceStatus: status } };
  }
}

function wowPaymentScript(outcome: Extract<ReferenceCommand, { type: "CONFIGURE_CHANNEL" }>["input"]["outcome"]): string {
  switch (outcome) {
    case "SUCCESS": return "ACCEPT_THEN_SUCCESS";
    case "FAILURE": return "ACCEPT_THEN_FAILURE";
    case "UNKNOWN": return "ACCEPT_THEN_UNKNOWN";
    default: return outcome;
  }
}

function businessDateBefore(periodEnd: string, timeZone: string): string {
  const end = new Date(periodEnd);
  if (Number.isNaN(end.valueOf())) return periodEnd.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(end.valueOf() - 1));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function wowReconciliationConclusion(value: "ACCEPT_DIFFERENCE" | "ESCALATE" | "CONFIRM_PLATFORM_FACT"): string {
  return value;
}

function wowSettlementImpact(value: "ALLOW" | "BLOCK" | "CONFIRM"): string {
  if (value === "ALLOW") return "NONE";
  if (value === "BLOCK") return "BLOCKS_SETTLEMENT";
  return "CONFIRMS_SETTLEMENT_FACT";
}

function wowManualReviewOutcome(value: string): string {
  switch (value.trim().toUpperCase()) {
    case "CONFIRM_SUCCESS": return "ACCEPT_SUCCESS";
    case "KEEP_ACCEPTED_SUCCESS":
    case "KEEP_CURRENT_TERMINAL": return "DISMISS";
    default: return value.trim().toUpperCase();
  }
}
