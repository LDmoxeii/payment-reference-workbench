import { capabilityUnavailable, BusinessError } from "../domain/errors";
import { minorToSafeInteger } from "../domain/money";
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
import { HttpClient, arrayValue, isRecord, numberValue, stringValue, type JsonRecord } from "../http/client";
import type { PaymentBackendAdapter } from "./adapter";
import type { AdapterRuntimeOptions } from "./factory";
import {
  action,
  capabilities,
  channelReceipts,
  mapAttemptStatus,
  mapChannelResult,
  mapPaymentStatus,
  mapRefundStatus,
  records,
  source,
  unavailable,
  wowMoney,
} from "./shared";

const WOW_CAPABILITIES = capabilities([
  ["payment.read", "full"],
  ["payment.list", "unavailable", "WOW 当前没有权威支付列表或分页接口。"],
  ["payment.create", "full"],
  ["payment.attempt.start", "partial", "创建支付时由 WOW 自动选择配置并启动尝试；没有独立 start endpoint。", ["SUBMIT_PAYMENT_RESULT"]],
  ["payment.channel-result", "full", undefined, ["SUBMIT_PAYMENT_RESULT"]],
  ["payment.expire", "full", undefined, ["EXPIRE_PAYMENT"]],
  ["payment.trace", "full", undefined, ["GET_PAYMENT_TRACE"]],
  ["refund.read", "full"],
  ["refund.list", "unavailable", "WOW 当前没有权威退款列表或分页接口。"],
  ["refund.create", "partial", "Reference 退款在创建请求中选择 fake 渠道结果。", ["CREATE_REFUND"]],
  ["refund.channel-result", "partial", "没有独立退款渠道结果入口；创建时的 result 驱动 fake adapter。"],
  ["refund.adjudication", "full", undefined, ["ADJUDICATE_REFUND"]],
  ["reconciliation.read", "full"],
  ["reconciliation.reference-statement", "full", undefined, ["REGISTER_AUTHORITATIVE_STATEMENT", "MARK_BILL_AVAILABLE"]],
  ["reconciliation.rerun", "unavailable", "WOW 没有公开的对账重跑端点。"],
  ["settlement.read", "full"],
  ["settlement.generate", "full", undefined, ["GENERATE_SETTLEMENT"]],
  ["settlement.replace", "full", undefined, ["REPLACE_SETTLEMENT"]],
  ["settlement.adjudication", "full", undefined, ["ADJUDICATE_SETTLEMENT"]],
  ["browser.cors", "unavailable", "Reference 后端未配置浏览器 CORS；开发时请使用同源代理。"],
]);

/** Maps WOW's event-projection API to the workbench's backend-neutral contract. */
export class WowPaymentAdapter implements PaymentBackendAdapter {
  readonly profile = {
    id: "wow" as const,
    label: "WOW Reference Payment",
    apiBaseUrl: "",
    referenceOnly: true as const,
    capabilities: WOW_CAPABILITIES,
  };

  private readonly client: HttpClient;

  constructor(private readonly options: AdapterRuntimeOptions) {
    this.client = new HttpClient({ baseUrl: options.apiBaseUrl, fetchImpl: options.fetchImpl });
    this.profile.apiBaseUrl = options.apiBaseUrl;
  }

  async health(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    try {
      // WOW has no health endpoint. A 404 from this real read route still proves that its HTTP server is reachable.
      await this.client.get<JsonRecord>("/payments/__payment_workbench_probe__");
      return health("connected", checkedAt, "已连接 WOW reference API。");
    } catch (error) {
      if (error instanceof BusinessError && error.httpStatus !== undefined) {
        return health("connected", checkedAt, "WOW API 可访问（探针资源不存在属预期）。", String(error.httpStatus));
      }
      return health("unreachable", checkedAt, "无法连接 WOW reference API。", "NETWORK_ERROR");
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<OperationReceipt> {
    const body: JsonRecord = {
      merchantId: input.merchantId,
      merchantOrderNo: input.merchantOrderNo,
      idempotencyKey: input.idempotencyKey,
      amount: minorToSafeInteger(input.amount.minorAmount),
      currency: input.amount.currency,
      paymentMethod: input.paymentMethod,
    };
    if (input.expiresAt) body.expiresAt = input.expiresAt;
    const response = await this.client.post<JsonRecord>("/payments", body);
    return operationReceipt("payment", response, requiredId(response, "aggregateId"), "poll");
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return mapWowPayment(await this.client.get<JsonRecord>(`/payments/${pathId(paymentId)}`));
  }

  async listPayments(_request: PageRequest): Promise<PageResult<Payment>> {
    throw capabilityUnavailable("WOW 当前没有权威支付列表或分页接口；请使用本地最近记录或按 ID 查询。");
  }

  async startPaymentAttempt(_paymentId: string): Promise<OperationReceipt> {
    throw capabilityUnavailable("WOW 在创建支付时自动启动尝试，当前没有独立的支付尝试发起入口。");
  }

  async submitPaymentResult(input: SubmitPaymentResultInput): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(`/payments/${pathId(input.paymentId)}/results`, {
      attemptId: input.attemptId,
      notificationId: input.notificationId,
      channel: input.channel,
      channelTransactionId: input.channelTransactionId,
      amount: minorToSafeInteger(input.amount.minorAmount),
      currency: input.amount.currency,
      result: input.result,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      verified: input.verified ?? true,
      payloadDigest: input.verificationMaterial ?? "payment-reference-workbench",
      verificationSummary: "由支付业务工作台 reference 渠道模拟提交",
    });
    return operationReceipt("payment", response, input.paymentId, "poll");
  }

  async expirePayment(paymentId: string): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(`/payments/${pathId(paymentId)}/expire`);
    return operationReceipt("payment", response, paymentId, "poll");
  }

  async createRefund(input: CreateRefundInput): Promise<OperationReceipt> {
    const body: JsonRecord = {
      merchantRefundNo: input.merchantRefundNo,
      amount: minorToSafeInteger(input.amount.minorAmount),
      result: input.initialResult ?? "SUCCEEDED",
    };
    if (input.requestedAt) body.requestedAt = input.requestedAt;
    const response = await this.client.post<JsonRecord>(`/payments/${pathId(input.paymentId)}/refunds`, body);
    return operationReceipt("refund", response, requiredId(response, "aggregateId"), "poll");
  }

  async getRefund(refundId: string): Promise<Refund> {
    return mapWowRefund(await this.client.get<JsonRecord>(`/refunds/${pathId(refundId)}`));
  }

  async listRefunds(_request: PageRequest): Promise<PageResult<Refund>> {
    throw capabilityUnavailable("WOW 当前没有权威退款列表或分页接口；请按退款 ID 查询。");
  }

  async submitRefundResult(_input: SubmitRefundResultInput): Promise<OperationReceipt> {
    throw capabilityUnavailable("WOW 没有独立退款渠道结果入口；请在创建退款时指定 reference result，或对待复核退款执行裁决。");
  }

  async adjudicateRefund(refundId: string, payload: Record<string, unknown>): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(`/refunds/${pathId(refundId)}/adjudications`, payload);
    return operationReceipt("refund", response, refundId, "poll");
  }

  async getPaymentTrace(paymentId: string): Promise<PaymentTrace> {
    const response = await this.client.get<JsonRecord>(`/payments/${pathId(paymentId)}/trace`);
    const payment = recordAt(response, "payment");
    return {
      payment: mapWowPayment(payment),
      refunds: records(response.refunds).map(mapWowRefund),
      reconciliations: records(response.reconciliations).map(mapWowReconciliation),
      settlements: records(response.settlements).map(mapWowSettlement),
      notifications: records(response.notifications).map((notification) => ({
        id: requiredId(notification, "notificationId"),
        status: stringValue(notification.deliveryStatus),
        diagnostic: stringValue(notification.diagnostic) ?? null,
      })),
      partial: false,
      source: source("wow", response, paymentId),
    };
  }

  async getReconciliation(batchId: string): Promise<Reconciliation> {
    return mapWowReconciliation(await this.client.get<JsonRecord>(`/reconciliations/${pathId(batchId)}`));
  }

  async getSettlement(settlementId: string): Promise<Settlement> {
    return mapWowSettlement(await this.client.get<JsonRecord>(`/settlements/${pathId(settlementId)}`));
  }

  async executeAction(input: ExecuteActionInput): Promise<OperationReceipt> {
    const payload = input.payload ?? {};
    switch (input.kind) {
      case "EXPIRE_PAYMENT":
        return this.expirePayment(requiredResourceId(input));
      case "ADJUDICATE_REFUND":
        return this.adjudicateRefund(requiredResourceId(input), payload);
      case "REGISTER_AUTHORITATIVE_STATEMENT":
        return this.postOperation("reconciliation", "/reference/statements", payload, stringValue(payload.statementId), "read_once");
      case "MARK_BILL_AVAILABLE":
        return this.postOperation("reconciliation", "/reconciliation/bill-available", payload, stringValue(payload.statementId), "poll");
      case "GENERATE_SETTLEMENT":
        return this.postOperation("settlement", "/settlements/generate", payload, stringValue(payload.settlementId), "poll");
      case "REPLACE_SETTLEMENT":
        return this.postOperation("settlement", `/settlements/${pathId(requiredResourceId(input))}/replace`, payload, requiredResourceId(input), "poll");
      case "ADJUDICATE_SETTLEMENT":
        return this.postOperation("settlement", `/settlements/${pathId(requiredResourceId(input))}/adjudications`, payload, requiredResourceId(input), "poll");
      case "SUBMIT_PAYMENT_RESULT":
      case "SUBMIT_REFUND_RESULT":
      case "START_PAYMENT_ATTEMPT":
      case "ADJUDICATE_PAYMENT":
      case "CREATE_REFUND":
      case "GET_PAYMENT_TRACE":
      case "RERUN_RECONCILIATION":
      case "DISPOSE_RECONCILIATION_DIFFERENCE":
      case "PREPARE_SETTLEMENT":
      case "CONFIRM_SETTLEMENT":
      case "START_SETTLEMENT_EXECUTION":
      case "SUBMIT_SETTLEMENT_RESULT":
      case "VOID_SETTLEMENT":
        throw capabilityUnavailable(`WOW 当前不支持通过通用操作执行 ${input.kind}；请使用对应的统一专用服务或查看能力说明。`);
    }
  }

  private async postOperation(
    resourceType: OperationReceipt["resourceType"],
    path: string,
    payload: Record<string, unknown>,
    fallbackId: string | undefined,
    refresh: OperationReceipt["refresh"],
  ): Promise<OperationReceipt> {
    const response = await this.client.post<JsonRecord>(path, payload);
    return operationReceipt(resourceType, response, fallbackId ?? requiredOperationId(response), refresh);
  }
}

export function mapWowPayment(value: JsonRecord): Payment {
  const currency = requiredText(value, "currency");
  const attempts = records(value.attempts).map((attempt): PaymentAttempt => ({
    id: requiredId(attempt, "attemptId"),
    channel: requiredText(attempt, "channel"),
    status: mapAttemptStatus(attempt.status),
    channelTransactionId: stringValue(attempt.channelTransactionId) ?? null,
    receiptCount: numberValue(attempt.notificationReceiveCount) ?? arrayValue(attempt.receiptIds).length,
    receipts: arrayValue(attempt.receiptIds).map((receipt) => ({
      id: stringValue(receipt) ?? "unknown-receipt",
      source: source("wow", attempt, requiredId(attempt, "attemptId")),
    })),
    source: source("wow", attempt, requiredId(attempt, "attemptId")),
  }));
  const status = mapPaymentStatus(value.status);
  const paymentId = requiredId(value, "paymentId");
  return {
    id: paymentId,
    merchantId: requiredText(value, "merchantId"),
    merchantOrderNo: requiredText(value, "merchantOrderNo"),
    idempotencyKey: stringValue(value.idempotencyKey) ?? null,
    amount: wowMoney(value.amount, currency),
    paymentMethod: requiredText(value, "paymentMethod"),
    status,
    createdAt: stringValue(value.createdAt) ?? null,
    expiresAt: stringValue(value.expiresAt) ?? null,
    succeededAt: stringValue(value.succeededAt) ?? null,
    attempts,
    refundSummary: {
      successful: optionalWowMoney(value.successfulRefundAmount, currency),
      reserved: optionalWowMoney(value.reservedRefundAmount, currency),
    },
    reviewIds: arrayValue(value.reviewIds).map((id) => stringValue(id)).filter((id): id is string => id !== undefined),
    actions: wowPaymentActions(status, attempts.length > 0),
    source: source("wow", value, paymentId),
  };
}

export function mapWowRefund(value: JsonRecord): Refund {
  const currency = requiredText(value, "currency");
  const attemptIds = arrayValue(value.attemptIds).map((id) => stringValue(id)).filter((id): id is string => id !== undefined);
  const channels = arrayValue(value.channels).map((channel) => stringValue(channel) ?? "unknown-channel");
  const status = mapRefundStatus(value.status);
  const refundId = requiredId(value, "refundId");
  const receiptIds = arrayValue(value.receiptIds).map((id) => stringValue(id)).filter((id): id is string => id !== undefined);
  const attempts: RefundAttempt[] = attemptIds.map((id, index) => ({
    id,
    channel: channels[index] ?? channels[0] ?? "unknown-channel",
    status: mapAttemptStatus(value.status),
    channelRefundId: stringValue(value.channelTransactionId) ?? null,
    receiptCount: receiptIds.length,
    receipts: receiptIds.map((receiptId) => ({ id: receiptId, source: source("wow", value, refundId) })),
    source: source("wow", value, refundId),
  }));
  return {
    id: refundId,
    paymentId: requiredText(value, "paymentId"),
    merchantId: requiredText(value, "merchantId"),
    merchantRefundNo: requiredText(value, "merchantRefundNo"),
    amount: wowMoney(value.amount, currency),
    paymentMethod: stringValue(value.paymentMethod) ?? null,
    status,
    finalizedAt: stringValue(value.finalizedAt) ?? null,
    channelRefundId: stringValue(value.channelTransactionId) ?? null,
    reservationActive: typeof value.reservationActive === "boolean" ? value.reservationActive : null,
    attempts,
    reviewIds: arrayValue(value.reviewIds).map((id) => stringValue(id)).filter((id): id is string => id !== undefined),
    actions: wowRefundActions(status, arrayValue(value.reviewIds).length > 0),
    source: source("wow", value, refundId),
  };
}

export function mapWowReconciliation(value: JsonRecord): Reconciliation {
  const currency = requiredText(value, "currency");
  const batchId = requiredId(value, "batchId");
  const items = records(value.items).map((item): ReconciliationItem => ({
    id: requiredId(item, "differenceIdentity"),
    differenceType: requiredText(item, "differenceType"),
    transactionKind: stringValue(item.transactionKind) ?? null,
    paymentId: stringValue(item.paymentId) ?? null,
    refundId: stringValue(item.refundId) ?? null,
    amount: item.amount === undefined || item.amount === null ? undefined : wowMoney(item.amount, stringValue(item.currency) ?? currency),
    resolved: typeof item.resolved === "boolean" ? item.resolved : null,
    settlementBlocked: typeof item.settlementBlocked === "boolean" ? item.settlementBlocked : null,
    evidence: stringValue(item.sourceFactIdentity) ?? null,
    source: source("wow", item, requiredId(item, "differenceIdentity")),
  }));
  return {
    id: batchId,
    statementId: stringValue(value.statementId) ?? null,
    channelId: requiredText(value, "channelId"),
    currency,
    reconciliationDate: stringValue(value.reconciliationDate) ?? null,
    businessTimezone: stringValue(value.businessTimezone) ?? null,
    status: requiredText(value, "status"),
    revision: numberValue(value.effectiveRevision) ?? null,
    settlementBlocked: typeof value.settlementBlocked === "boolean" ? value.settlementBlocked : null,
    items,
    actions: [
      action("REGISTER_AUTHORITATIVE_STATEMENT", "登记 reference 权威账单", { confirmation: "danger", refresh: "read_once" }),
      action("MARK_BILL_AVAILABLE", "通知账单可用", { confirmation: "confirm", refresh: "poll" }),
      unavailable("RERUN_RECONCILIATION", "重跑对账", "WOW 没有公开的对账重跑端点。"),
      unavailable("DISPOSE_RECONCILIATION_DIFFERENCE", "处置差异", "WOW 没有公开的差异处置端点。"),
    ],
    source: source("wow", value, batchId),
  };
}

export function mapWowSettlement(value: JsonRecord): Settlement {
  const currency = requiredText(value, "currency");
  const settlementId = requiredId(value, "settlementId");
  const lines = records(value.lines).map((line): SettlementLine => ({
    id: requiredId(line, "lineId"),
    sourceKind: stringValue(line.sourceKind) ?? null,
    paymentId: stringValue(line.paymentId) ?? null,
    refundId: stringValue(line.refundId) ?? null,
    reconciliationId: stringValue(line.reconciliationBatchId) ?? null,
    grossAmount: line.grossAmount === undefined || line.grossAmount === null ? undefined : wowMoney(line.grossAmount, stringValue(line.currency) ?? currency),
    feeAmount: line.feeAmount === undefined || line.feeAmount === null ? undefined : wowMoney(line.feeAmount, stringValue(line.currency) ?? currency),
    signedNetAmount: line.signedNetAmount === undefined || line.signedNetAmount === null ? undefined : wowMoney(line.signedNetAmount, stringValue(line.currency) ?? currency),
    source: source("wow", line, requiredId(line, "lineId")),
  }));
  return {
    id: settlementId,
    merchantId: requiredText(value, "merchantId"),
    channelId: requiredText(value, "channelId"),
    currency,
    status: requiredText(value, "status"),
    netAmount: wowMoney(value.netAmount, currency),
    predecessorSettlementId: stringValue(value.predecessorSettlementId) ?? null,
    replacementSettlementId: stringValue(value.replacementSettlementId) ?? null,
    blockerSummary: arrayValue(value.reviewReasons).map((reason) => stringValue(reason)).filter((reason): reason is string => reason !== undefined).join("；") || null,
    lines,
    actions: [
      action("REPLACE_SETTLEMENT", "创建替代结算单", { confirmation: "danger", refresh: "poll" }),
      action("ADJUDICATE_SETTLEMENT", "裁决结算复核", { confirmation: "danger", refresh: "poll" }),
      unavailable("PREPARE_SETTLEMENT", "准备结算", "WOW 的 reference 流程从生成结算并自动推进开始。"),
      unavailable("CONFIRM_SETTLEMENT", "确认结算", "WOW 没有公开的独立确认端点。"),
    ],
    source: source("wow", value, settlementId),
  };
}

function wowPaymentActions(status: Payment["status"], hasAttempt: boolean): ActionDescriptor[] {
  const actions: ActionDescriptor[] = [
    unavailable("START_PAYMENT_ATTEMPT", "发起支付尝试", "WOW 在创建支付时自动启动尝试，当前没有独立入口。"),
    action("GET_PAYMENT_TRACE", "查看全链路轨迹", { confirmation: "none", refresh: "read_once" }),
  ];
  if (status === "PENDING" || status === "PROCESSING" || status === "PENDING_CONFIRMATION") {
    actions.push(hasAttempt
      ? action("SUBMIT_PAYMENT_RESULT", "提交 reference 渠道结果", {
          confirmation: "danger",
          refresh: "poll",
          requiredFields: ["attemptId", "result", "channel", "notificationId", "channelTransactionId"],
          defaultValues: { channel: "fake" },
        })
      : unavailable("SUBMIT_PAYMENT_RESULT", "提交 reference 渠道结果", "支付尝试投影尚未可见；请刷新后重试。"));
  }
  if (status === "PENDING") actions.push(action("EXPIRE_PAYMENT", "关闭已过期支付", { confirmation: "danger", refresh: "poll" }));
  if (status === "SUCCEEDED") actions.push(action("CREATE_REFUND", "创建退款", {
    confirmation: "danger",
    refresh: "poll",
    requiredFields: ["merchantRefundNo", "amount", "initialResult"],
    defaultValues: { initialResult: "SUCCEEDED" },
  }));
  return actions;
}

function wowRefundActions(status: Refund["status"], hasReview: boolean): ActionDescriptor[] {
  const actions: ActionDescriptor[] = [
    unavailable("SUBMIT_REFUND_RESULT", "提交退款渠道结果", "WOW 退款结果在 reference 创建请求中确定。"),
  ];
  if (status === "PENDING_CONFIRMATION" || hasReview) {
    actions.push(action("ADJUDICATE_REFUND", "裁决退款复核", { confirmation: "danger", refresh: "poll" }));
  }
  return actions;
}

function operationReceipt(
  resourceType: OperationReceipt["resourceType"],
  value: JsonRecord,
  resourceId: string,
  refresh: OperationReceipt["refresh"],
): OperationReceipt {
  const status = stringValue(value.status) ?? stringValue(value.paymentStatus) ?? stringValue(value.refundStatus);
  return {
    resourceType,
    resourceId,
    accepted: !["REJECTED", "FAILED"].includes(status ?? ""),
    reused: value.reused === true || value.idempotentReplay === true,
    sourceStatus: status ?? null,
    refresh,
    diagnostic: stringValue(value.diagnosticSummary) ?? stringValue(value.rejectionSummary) ?? null,
    source: source("wow", value, resourceId),
  };
}

function health(status: HealthStatus["status"], checkedAt: string, message: string, sourceStatus?: string): HealthStatus {
  return { status, checkedAt, message, source: { adapter: "wow", sourceStatus: sourceStatus ?? null } };
}

function optionalWowMoney(value: unknown, currency: string) {
  return value === undefined || value === null ? undefined : wowMoney(value, currency);
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

function requiredText(value: JsonRecord, field: string): string {
  const text = stringValue(value[field]);
  if (text !== undefined && text.length > 0) return text;
  throw invalidResponse(`WOW 响应缺少 ${field}。`, value);
}

function requiredId(value: JsonRecord, field: string): string {
  return requiredText(value, field);
}

function requiredOperationId(value: JsonRecord): string {
  for (const field of ["aggregateId", "paymentId", "refundId", "batchId", "settlementId"]) {
    const id = stringValue(value[field]);
    if (id) return id;
  }
  throw invalidResponse("WOW 操作回执缺少资源标识。", value);
}

function requiredResourceId(input: ExecuteActionInput): string {
  if (input.resourceId) return input.resourceId;
  throw new BusinessError({ code: "VALIDATION_ERROR", message: "该操作需要资源 ID。", fields: [{ field: "resourceId", message: "不能为空" }], retryable: false });
}

function recordAt(value: JsonRecord, field: string): JsonRecord {
  const candidate = value[field];
  if (isRecord(candidate)) return candidate;
  throw invalidResponse(`WOW 响应缺少对象字段 ${field}。`, value);
}

function invalidResponse(message: string, diagnostic: unknown): BusinessError {
  return new BusinessError({ code: "ADAPTER_RESPONSE_INVALID", message, fields: [], retryable: false, diagnostic });
}
