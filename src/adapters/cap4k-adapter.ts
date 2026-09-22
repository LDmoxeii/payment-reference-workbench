import { BusinessError, capabilityUnavailable } from "../domain/errors";
import { subtractMoney } from "../domain/money";
import type {
  ActionDescriptor,
  CreatePaymentInput,
  CreateRefundInput,
  ExecuteActionInput,
  HealthStatus,
  OperationReceipt,
  PageRequest,
  PageResult,
  Payment,
  PaymentAttempt,
  PaymentTrace,
  Reconciliation,
  ReconciliationItem,
  Refund,
  RefundAttempt,
  Settlement,
  SettlementLine,
  SubmitPaymentResultInput,
  SubmitRefundResultInput,
} from "../domain/models";
import { HttpClient, arrayValue, booleanValue, isRecord, numberValue, stringValue, type JsonRecord } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import type { AdapterRuntimeOptions } from "./factory";
import {
  action,
  capabilities,
  channelReceipts,
  decimalMoney,
  mapAttemptStatus,
  mapChannelResult,
  mapPaymentStatus,
  mapRefundStatus,
  records,
  source,
  toDecimalMoney,
  unavailable,
} from "./shared";

const CAP4K_CAPABILITIES = capabilities([
  ["payment.read", "full"],
  ["payment.list", "unavailable", "CAP4K 当前没有权威支付列表或分页接口。"],
  ["payment.create", "full"],
  ["payment.attempt.start", "full", undefined, ["START_PAYMENT_ATTEMPT"]],
  ["payment.channel-result", "full", undefined, ["SUBMIT_PAYMENT_RESULT"]],
  ["payment.expire", "unavailable", "支付到期由后端调度器驱动，没有人工 HTTP 入口。"],
  ["payment.trace", "partial", "支付查询包含尝试、通知和复核，但没有统一跨退款、对账、结算的 trace endpoint。", ["GET_PAYMENT_TRACE"]],
  ["refund.read", "full"],
  ["refund.list", "unavailable", "CAP4K 当前没有权威退款列表或分页接口。"],
  ["refund.create", "partial", "创建字段缺少统一业务契约中的独立幂等键与退款原因。", ["CREATE_REFUND"]],
  ["refund.channel-result", "full", undefined, ["SUBMIT_REFUND_RESULT"]],
  ["refund.adjudication", "unavailable", "退款复核由调度流程推进，没有公开人工裁决端点。"],
  ["reconciliation.read", "full"],
  ["reconciliation.create", "unavailable", "批次由日终调度或账单集成事件形成。"],
  ["reconciliation.rerun", "full", undefined, ["RERUN_RECONCILIATION"]],
  ["reconciliation.disposition", "full", undefined, ["DISPOSE_RECONCILIATION_DIFFERENCE"]],
  ["settlement.read", "full"],
  ["settlement.prepare", "full", undefined, ["PREPARE_SETTLEMENT"]],
  ["settlement.confirm", "full", undefined, ["CONFIRM_SETTLEMENT"]],
  ["settlement.execute", "full", undefined, ["START_SETTLEMENT_EXECUTION", "SUBMIT_SETTLEMENT_RESULT"]],
  ["settlement.void", "full", undefined, ["VOID_SETTLEMENT"]],
  ["browser.cors", "unavailable", "Reference 后端未配置浏览器 CORS；开发时请使用同源代理。"],
]);

export class Cap4kPaymentAdapter implements PaymentBackendAdapter {
  readonly profile = {
    id: "cap4k" as const,
    label: "CAP4K Reference Payment",
    apiBaseUrl: "",
    referenceOnly: true as const,
    capabilities: CAP4K_CAPABILITIES,
  };

  private readonly client: HttpClient;

  constructor(private readonly options: AdapterRuntimeOptions) {
    this.client = new HttpClient({ baseUrl: options.apiBaseUrl, fetchImpl: options.fetchImpl });
    this.profile.apiBaseUrl = options.apiBaseUrl;
  }

  async health(): Promise<HealthStatus> {
    const checkedAt = this.now().toISOString();
    try {
      await this.client.get<JsonRecord>("/payments/__payment_workbench_probe__");
      return health("connected", checkedAt, "已连接 CAP4K reference API。");
    } catch (error) {
      if (error instanceof BusinessError && error.httpStatus !== undefined) {
        return health("connected", checkedAt, "CAP4K API 可访问（探针资源不存在属预期）。", String(error.httpStatus));
      }
      return health("unreachable", checkedAt, "无法连接 CAP4K reference API。", "NETWORK_ERROR");
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<OperationReceipt> {
    const expiresAt = input.expiresAt ?? new Date(this.now().getTime() + 30 * 60_000).toISOString();
    const response = await this.client.post<JsonRecord>("/payments", {
      merchantId: input.merchantId,
      merchantOrderNumber: input.merchantOrderNo,
      idempotencyKey: input.idempotencyKey,
      amount: toDecimalMoney(input.amount.minorAmount, input.amount.currency),
      currency: input.amount.currency,
      paymentMethod: input.paymentMethod,
      expiresAt,
    });
    return receipt("payment", response, requiredId(response, "paymentId"), "read_once");
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return mapCap4kPayment(await this.client.get<JsonRecord>(`/payments/${pathId(paymentId)}`));
  }

  async listPayments(_request: PageRequest): Promise<PageResult<Payment>> {
    throw capabilityUnavailable("CAP4K 当前没有权威支付列表或分页接口；请使用本地最近记录或按 ID 查询。");
  }

  async startPaymentAttempt(paymentId: string): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(`/payments/${pathId(paymentId)}/attempts`);
    return receipt("payment", response, paymentId, "read_once");
  }

  async submitPaymentResult(input: SubmitPaymentResultInput): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>("/channel/payment-results", {
      channelId: input.channel,
      notificationId: input.notificationId,
      paymentId: input.paymentId,
      paymentAttemptId: input.attemptId,
      channelTransactionId: input.channelTransactionId,
      amount: toDecimalMoney(input.amount.minorAmount, input.amount.currency),
      currency: input.amount.currency,
      result: cap4kResult(input.result),
      occurredAt: input.occurredAt ?? this.now().toISOString(),
      verificationMaterial: input.verificationMaterial ?? this.options.verificationMaterial ?? "test-secret",
    });
    return receipt("payment", response, input.paymentId, "read_once");
  }

  async expirePayment(_paymentId: string): Promise<OperationReceipt> {
    throw capabilityUnavailable("CAP4K 支付到期由后端调度器驱动，当前没有人工 HTTP 入口。");
  }

  async createRefund(input: CreateRefundInput): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>("/refunds", {
      merchantId: input.merchantId,
      merchantRefundNumber: input.merchantRefundNo,
      paymentId: input.paymentId,
      amount: toDecimalMoney(input.amount.minorAmount, input.amount.currency),
      currency: input.amount.currency,
      requestedAt: input.requestedAt ?? this.now().toISOString(),
    });
    return receipt("refund", response, requiredId(response, "refundId"), "read_once");
  }

  async getRefund(refundId: string): Promise<Refund> {
    return mapCap4kRefund(await this.client.get<JsonRecord>(`/refunds/${pathId(refundId)}`));
  }

  async listRefunds(_request: PageRequest): Promise<PageResult<Refund>> {
    throw capabilityUnavailable("CAP4K 当前没有权威退款列表或分页接口；请按退款 ID 查询。");
  }

  async submitRefundResult(input: SubmitRefundResultInput): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>("/channel/refund-results", {
      channelId: input.channel,
      notificationId: input.notificationId,
      refundId: input.refundId,
      refundAttemptId: input.attemptId,
      channelRefundId: input.channelRefundId,
      amount: toDecimalMoney(input.amount.minorAmount, input.amount.currency),
      currency: input.amount.currency,
      result: cap4kResult(input.result),
      occurredAt: input.occurredAt ?? this.now().toISOString(),
      verificationMaterial: input.verificationMaterial ?? this.options.verificationMaterial ?? "test-secret",
    });
    return receipt("refund", response, input.refundId, "read_once");
  }

  async adjudicateRefund(_refundId: string, _payload: Record<string, unknown>): Promise<OperationReceipt> {
    throw capabilityUnavailable("CAP4K 当前没有公开退款人工裁决端点。");
  }

  async getPaymentTrace(paymentId: string): Promise<PaymentTrace> {
    const payment = await this.getPayment(paymentId);
    return {
      payment,
      refunds: [],
      reconciliations: [],
      settlements: [],
      notifications: [],
      partial: true,
      source: { adapter: "cap4k", sourceId: paymentId, diagnostic: "CAP4K 当前只提供支付详情中的尝试、通知与复核，没有统一跨域轨迹端点。" },
    };
  }

  async getReconciliation(batchId: string): Promise<Reconciliation> {
    return mapCap4kReconciliation(await this.client.get<JsonRecord>(`/reconciliation-batches/${pathId(batchId)}`));
  }

  async getSettlement(settlementId: string): Promise<Settlement> {
    return mapCap4kSettlement(await this.client.get<JsonRecord>(`/merchant-settlements/${pathId(settlementId)}`));
  }

  async executeAction(input: ExecuteActionInput): Promise<OperationReceipt> {
    const payload = input.payload ?? {};
    switch (input.kind) {
      case "START_PAYMENT_ATTEMPT":
        return this.startPaymentAttempt(requiredResourceId(input));
      case "ADJUDICATE_PAYMENT": {
        const paymentId = requiredResourceId(input);
        const reviewId = requiredPayloadText(payload, "reviewId");
        return this.post("payment", `/payments/${pathId(paymentId)}/reviews/${pathId(reviewId)}/decisions`, payload, paymentId, "read_once");
      }
      case "RERUN_RECONCILIATION": {
        const batchId = requiredResourceId(input);
        return this.post("reconciliation", `/reconciliation-batches/${pathId(batchId)}/reruns`, payload, batchId, "read_once");
      }
      case "DISPOSE_RECONCILIATION_DIFFERENCE": {
        const itemId = requiredResourceId(input);
        return this.post("reconciliation", `/reconciliation-items/${pathId(itemId)}/dispositions`, payload, stringValue(payload.batchId) ?? itemId, "read_once");
      }
      case "PREPARE_SETTLEMENT":
        return this.post("settlement", "/merchant-settlements", payload, stringValue(payload.settlementId), "read_once");
      case "CONFIRM_SETTLEMENT": {
        const id = requiredResourceId(input);
        return this.post("settlement", `/merchant-settlements/${pathId(id)}/confirmations`, payload, id, "read_once");
      }
      case "START_SETTLEMENT_EXECUTION": {
        const id = requiredResourceId(input);
        return this.post("settlement", `/merchant-settlements/${pathId(id)}/executions`, payload, id, "read_once");
      }
      case "SUBMIT_SETTLEMENT_RESULT":
        return this.post("settlement", "/channel/settlement-results", withVerification(payload, this.options.verificationMaterial), stringValue(payload.settlementId), "read_once");
      case "VOID_SETTLEMENT": {
        const id = requiredResourceId(input);
        return this.post("settlement", `/merchant-settlements/${pathId(id)}/voids`, payload, id, "read_once");
      }
      case "SUBMIT_PAYMENT_RESULT":
      case "SUBMIT_REFUND_RESULT":
      case "CREATE_REFUND":
      case "GET_PAYMENT_TRACE":
        throw capabilityUnavailable(`请使用 ${input.kind} 对应的统一专用服务。`);
      case "EXPIRE_PAYMENT":
      case "ADJUDICATE_REFUND":
      case "REGISTER_AUTHORITATIVE_STATEMENT":
      case "MARK_BILL_AVAILABLE":
      case "GENERATE_SETTLEMENT":
      case "REPLACE_SETTLEMENT":
      case "ADJUDICATE_SETTLEMENT":
        throw capabilityUnavailable(`CAP4K 当前不支持操作 ${input.kind}，请查看能力对齐说明。`);
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async post(
    resourceType: OperationReceipt["resourceType"],
    path: string,
    payload: Record<string, unknown>,
    fallbackId: string | undefined,
    refresh: OperationReceipt["refresh"],
  ): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(path, payload);
    return receipt(resourceType, response, fallbackId ?? operationId(response), refresh);
  }
}

export function mapCap4kPayment(value: JsonRecord): Payment {
  const currency = requiredText(value, "currency");
  const paymentId = requiredId(value, "paymentId");
  const status = mapPaymentStatus(value.status);
  const attempts = records(value.attempts).map((attempt): PaymentAttempt => ({
    id: requiredId(attempt, "paymentAttemptId"),
    channel: requiredText(attempt, "channelId"),
    requestIdentity: stringValue(attempt.requestIdentity) ?? null,
    status: mapAttemptStatus(attempt.status),
    initiatedAt: stringValue(attempt.initiatedAt) ?? null,
    channelTransactionId: stringValue(attempt.channelTransactionId) ?? null,
    finalResult: mapChannelResult(attempt.finalResult) ?? null,
    receiptCount: numberValue(attempt.notificationReceiveCount) ?? records(attempt.notificationReceipts).length,
    receipts: channelReceipts("cap4k", attempt.notificationReceipts),
    source: source("cap4k", attempt, requiredId(attempt, "paymentAttemptId")),
  }));
  const amount = decimalMoney(value.amount, currency);
  const successful = optionalDecimal(value.successfulRefundAmount, currency);
  const reserved = optionalDecimal(value.reservedRefundAmount, currency);
  const refundable = optionalDecimal(value.refundableAmount, currency) ?? subtractMoney(amount, successful, reserved);
  const reviewIds = records(value.reviews).map((review) => requiredId(review, "reviewId"));
  return {
    id: paymentId,
    merchantId: requiredText(value, "merchantId"),
    merchantOrderNo: requiredText(value, "merchantOrderNumber"),
    amount,
    paymentMethod: requiredText(value, "paymentMethod"),
    status,
    createdAt: stringValue(value.createdAt) ?? null,
    expiresAt: stringValue(value.expiresAt) ?? null,
    succeededAt: stringValue(value.succeededAt) ?? null,
    closedAt: stringValue(value.closedAt) ?? null,
    channelTransactionId: stringValue(value.channelTransactionId) ?? null,
    attempts,
    refundSummary: { successful, reserved, refundable },
    reviewIds,
    settlementEligible: booleanValue(value.settlementEligible) ?? null,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? null,
    actions: cap4kPaymentActions(status, attempts.length > 0, reviewIds.length > 0),
    source: source("cap4k", value, paymentId),
  };
}

export function mapCap4kRefund(value: JsonRecord): Refund {
  const currency = requiredText(value, "currency");
  const refundId = requiredId(value, "refundId");
  const status = mapRefundStatus(value.status);
  const attempts = records(value.attempts).map((attempt): RefundAttempt => ({
    id: requiredId(attempt, "refundAttemptId"),
    channel: requiredText(attempt, "channelId"),
    requestIdentity: stringValue(attempt.requestIdentity) ?? null,
    status: mapAttemptStatus(attempt.status),
    initiatedAt: stringValue(attempt.initiatedAt) ?? null,
    channelRefundId: stringValue(attempt.channelRefundId) ?? null,
    finalResult: mapChannelResult(attempt.finalResult) ?? null,
    receiptCount: numberValue(attempt.notificationReceiveCount) ?? records(attempt.notificationReceipts).length,
    receipts: channelReceipts("cap4k", attempt.notificationReceipts),
    source: source("cap4k", attempt, requiredId(attempt, "refundAttemptId")),
  }));
  return {
    id: refundId,
    paymentId: requiredText(value, "paymentId"),
    merchantId: requiredText(value, "merchantId"),
    merchantRefundNo: requiredText(value, "merchantRefundNumber"),
    amount: decimalMoney(value.amount, currency),
    paymentMethod: stringValue(value.paymentMethod) ?? null,
    status,
    requestedAt: stringValue(value.requestedAt) ?? null,
    finalizedAt: stringValue(value.finalizedAt) ?? null,
    channelRefundId: stringValue(value.channelRefundId) ?? null,
    reservationActive: booleanValue(value.reservationActive) ?? null,
    attempts,
    reviewIds: [],
    actions: status === "PROCESSING" || status === "PENDING_CONFIRMATION"
      ? [action("SUBMIT_REFUND_RESULT", "提交 sandbox 退款结果", {
          confirmation: "danger",
          refresh: "read_once",
          requiredFields: ["attemptId", "result", "channel", "notificationId", "channelRefundId"],
          defaultValues: { channel: "C-001" },
        })]
      : [],
    source: source("cap4k", value, refundId),
  };
}

export function mapCap4kReconciliation(value: JsonRecord): Reconciliation {
  const batchId = requiredId(value, "batchId");
  const currency = requiredText(value, "currency");
  const runs = records(value.runs);
  const currentRunId = stringValue(value.currentEffectiveRunId);
  const currentRun = runs.find((run) => stringValue(run.runId) === currentRunId) ?? runs[0];
  const items = records(currentRun?.items).map((item): ReconciliationItem => ({
    id: requiredId(item, "itemId"),
    differenceType: requiredText(item, "differenceType"),
    transactionKind: stringValue(item.transactionKind) ?? null,
    paymentId: stringValue(item.paymentId) ?? null,
    refundId: stringValue(item.refundId) ?? null,
    amount: optionalDecimal(item.platformAmount ?? item.channelAmount, stringValue(item.platformCurrency) ?? stringValue(item.channelCurrency) ?? currency),
    resolved: booleanValue(item.resolved) ?? null,
    settlementBlocked: booleanValue(item.settlementBlocked) ?? null,
    evidence: stringValue(item.matchingBasis) ?? null,
    source: source("cap4k", item, requiredId(item, "itemId")),
  }));
  return {
    id: batchId,
    statementId: currentRun ? stringValue(currentRun.statementIdentity) ?? null : null,
    channelId: requiredText(value, "channelId"),
    currency,
    reconciliationDate: stringValue(value.reconciliationDate) ?? null,
    businessTimezone: stringValue(value.businessTimezone) ?? null,
    status: requiredText(value, "status"),
    revision: currentRun ? stringValue(currentRun.statementRevision) ?? null : null,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? null,
    blockingReason: stringValue(value.blockingReason) ?? null,
    items,
    actions: [
      action("RERUN_RECONCILIATION", "重跑对账", { confirmation: "confirm", refresh: "read_once" }),
      action("DISPOSE_RECONCILIATION_DIFFERENCE", "处置差异", { confirmation: "danger", refresh: "read_once" }),
      unavailable("REGISTER_AUTHORITATIVE_STATEMENT", "登记 reference 权威账单", "CAP4K 没有普通前端 fixture 登记入口。"),
    ],
    source: source("cap4k", value, batchId),
  };
}

export function mapCap4kSettlement(value: JsonRecord): Settlement {
  const settlementId = requiredId(value, "settlementId");
  const currency = requiredText(value, "currency");
  const lines = records(value.lines).map((line): SettlementLine => ({
    id: requiredId(line, "lineId"),
    sourceKind: stringValue(line.sourceKind) ?? null,
    paymentId: stringValue(line.paymentId) ?? null,
    refundId: stringValue(line.refundId) ?? null,
    reconciliationId: stringValue(line.reconciliationBatchId) ?? null,
    grossAmount: optionalDecimal(line.grossAmount, stringValue(line.currency) ?? currency),
    feeAmount: optionalDecimal(line.feeAmount, stringValue(line.currency) ?? currency),
    signedNetAmount: optionalDecimal(line.signedNetAmount, stringValue(line.currency) ?? currency),
    source: source("cap4k", line, requiredId(line, "lineId")),
  }));
  return {
    id: settlementId,
    merchantId: requiredText(value, "merchantId"),
    channelId: requiredText(value, "channelId"),
    currency,
    status: requiredText(value, "status"),
    netAmount: optionalDecimal(value.netAmount, currency),
    paymentGrossAmount: optionalDecimal(value.paymentGrossAmount, currency),
    refundGrossAmount: optionalDecimal(value.refundGrossAmount, currency),
    feeTotalAmount: optionalDecimal(value.feeTotalAmount, currency),
    adjustmentTotalAmount: optionalDecimal(value.adjustmentTotalAmount, currency),
    periodStart: stringValue(value.periodStart) ?? null,
    periodEnd: stringValue(value.periodEnd) ?? null,
    blockerSummary: stringValue(value.blockerSummary) ?? null,
    predecessorSettlementId: stringValue(value.predecessorSettlementId) ?? null,
    replacementSettlementId: stringValue(value.replacementSettlementId) ?? null,
    lines,
    actions: cap4kSettlementActions(String(value.status)),
    source: source("cap4k", value, settlementId),
  };
}

function cap4kPaymentActions(status: Payment["status"], hasAttempt: boolean, hasReview: boolean): ActionDescriptor[] {
  const result: ActionDescriptor[] = [
    unavailable("GET_PAYMENT_TRACE", "查看完整业务轨迹", "CAP4K 当前没有跨退款、对账和结算的统一 trace endpoint。"),
  ];
  if (status === "PENDING" || status === "PROCESSING") {
    result.push(action("START_PAYMENT_ATTEMPT", "发起支付尝试", { confirmation: "confirm", refresh: "read_once" }));
  }
  if (hasAttempt && (status === "PROCESSING" || status === "PENDING_CONFIRMATION")) {
    result.push(action("SUBMIT_PAYMENT_RESULT", "提交 sandbox 渠道结果", {
      confirmation: "danger",
      refresh: "read_once",
      requiredFields: ["attemptId", "result", "channel", "notificationId", "channelTransactionId"],
      defaultValues: { channel: "C-001" },
    }));
  }
  if (hasReview) result.push(action("ADJUDICATE_PAYMENT", "裁决支付复核", { confirmation: "danger", refresh: "read_once" }));
  if (status === "SUCCEEDED") result.push(action("CREATE_REFUND", "创建退款", {
    confirmation: "danger",
    refresh: "read_once",
    requiredFields: ["merchantRefundNo", "amount"],
  }));
  return result;
}

function cap4kSettlementActions(status: string): ActionDescriptor[] {
  const result: ActionDescriptor[] = [];
  if (["PREPARING", "REVIEW_REQUIRED", "PREPARED"].includes(status)) result.push(action("CONFIRM_SETTLEMENT", "确认结算", { confirmation: "danger", refresh: "read_once" }));
  if (status === "CONFIRMED") result.push(action("START_SETTLEMENT_EXECUTION", "发起结算执行", { confirmation: "danger", refresh: "read_once" }));
  if (["PROCESSING", "RESULT_UNKNOWN"].includes(status)) result.push(action("SUBMIT_SETTLEMENT_RESULT", "提交 sandbox 结算结果", { confirmation: "danger", refresh: "read_once" }));
  if (!["SUCCEEDED"].includes(status)) result.push(action("VOID_SETTLEMENT", "作废结算单", { confirmation: "danger", refresh: "read_once" }));
  return result;
}

function receipt(resourceType: OperationReceipt["resourceType"], value: JsonRecord, resourceId: string, refresh: OperationReceipt["refresh"]): OperationReceipt {
  const status = stringValue(value.status) ?? stringValue(value.paymentStatus) ?? stringValue(value.refundStatus);
  return {
    resourceType,
    resourceId,
    accepted: value.accepted !== false && !["REJECTED"].includes(status ?? ""),
    reused: value.idempotentReplay === true,
    sourceStatus: status ?? null,
    refresh,
    diagnostic: stringValue(value.diagnosticSummary) ?? stringValue(value.rejectionSummary) ?? stringValue(value.conflictSummary) ?? null,
    source: source("cap4k", value, resourceId),
  };
}

function optionalDecimal(value: unknown, currency: string) {
  return value === undefined || value === null ? undefined : decimalMoney(value, currency);
}

function cap4kResult(value: SubmitPaymentResultInput["result"]): string {
  return value === "SUCCEEDED" ? "SUCCESS" : value;
}

function requiredText(value: JsonRecord, field: string): string {
  const text = stringValue(value[field]);
  if (text !== undefined && text.length > 0) return text;
  throw invalidResponse(`CAP4K 响应缺少 ${field}。`, value);
}

function requiredId(value: JsonRecord, field: string): string {
  return requiredText(value, field);
}

function operationId(value: JsonRecord): string {
  for (const field of ["paymentId", "refundId", "batchId", "settlementId", "itemId", "attemptId"]) {
    const id = stringValue(value[field]);
    if (id) return id;
  }
  throw invalidResponse("CAP4K 操作回执缺少资源标识。", value);
}

function requiredResourceId(input: ExecuteActionInput): string {
  if (input.resourceId) return input.resourceId;
  throw new BusinessError({ code: "VALIDATION_ERROR", message: "该操作需要资源 ID。", fields: [{ field: "resourceId", message: "不能为空" }], retryable: false });
}

function requiredPayloadText(payload: Record<string, unknown>, field: string): string {
  const text = stringValue(payload[field]);
  if (text) return text;
  throw new BusinessError({ code: "VALIDATION_ERROR", message: `该操作需要 ${field}。`, fields: [{ field, message: "不能为空" }], retryable: false });
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

function health(status: HealthStatus["status"], checkedAt: string, message: string, sourceStatus?: string): HealthStatus {
  return { status, checkedAt, message, source: { adapter: "cap4k", sourceStatus: sourceStatus ?? null } };
}

function withVerification(payload: Record<string, unknown>, defaultMaterial?: string): Record<string, unknown> {
  return { ...payload, verificationMaterial: payload.verificationMaterial ?? defaultMaterial ?? "test-secret" };
}

function invalidResponse(message: string, diagnostic: unknown): BusinessError {
  return new BusinessError({ code: "ADAPTER_RESPONSE_INVALID", message, fields: [], retryable: false, diagnostic });
}
