import { BusinessError } from "../domain/errors";
import { submittableAttempt } from "../domain/attempts";
import { createMoney, subtractMoney } from "../domain/money";
import type {
  ActionDescriptor,
  ActionKind,
  AuthoritativeBill,
  BackendId,
  BillRecord,
  ChannelOutcome,
  ChannelResultReceipt,
  ChannelSubmissionReceipt,
  EvidenceRef,
  Finality,
  ManualReviewDisposition,
  ManualReviewItem,
  MerchantNotification,
  Operation,
  OperationReceipt,
  PageResult,
  Payment,
  PaymentAttempt,
  PaymentTimeline,
  ReadAfter,
  ReconciliationDifference,
  ReconciliationDifferenceType,
  ReconciliationRun,
  Refund,
  RefundAttempt,
  ResourceRef,
  Settlement,
  SettlementExecution,
  SettlementItem,
  SourceMetadata,
  TimelineEntry,
} from "../domain/models";
import { arrayValue, booleanValue, isRecord, numberValue, stringValue, type JsonRecord } from "../http/client";

export const action = (kind: ActionKind, label: string, confirmation: ActionDescriptor["confirmation"] = "confirm"): ActionDescriptor => ({
  kind,
  label,
  executable: true,
  availability: "full",
  confirmation,
});

export const alternativeAction = (
  kind: ActionKind,
  label: string,
  reason: string,
  alternative: string,
  confirmation: ActionDescriptor["confirmation"] = "confirm",
): ActionDescriptor => ({
  kind,
  label,
  executable: false,
  availability: "alternative",
  reason,
  alternative,
  confirmation,
});

export function source(adapter: BackendId, value: JsonRecord, sourceId?: string): SourceMetadata {
  return {
    adapter,
    sourceStatus: text(value.status) ?? text(value.finality) ?? null,
    sourceId: sourceId ?? firstText(value, ["paymentId", "refundId", "runId", "settlementId", "reviewId", "notificationId", "billId", "billIdentity"]) ?? null,
    sourceTime: firstText(value, ["updatedAt", "recordedAt", "completedAt", "createdAt", "sortTime"]) ?? null,
    diagnostic: value.diagnosticSummary ?? value.blockingReason ?? value.lastConflictSummary ?? null,
  };
}

export function finality(value: unknown): Finality {
  const candidate = String(value ?? "NON_FINAL");
  return candidate === "FINAL" || candidate === "REVIEW_REQUIRED" ? candidate : "NON_FINAL";
}

export function channelOutcome(value: unknown): ChannelOutcome | null {
  switch (String(value ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCEEDED": return "SUCCESS";
    case "FAILED":
    case "FAILURE":
    case "RETRYABLE_FAILURE": return "FAILURE";
    case "UNKNOWN":
    case "RESULT_UNKNOWN": return "UNKNOWN";
    default: return null;
  }
}

export function money(value: unknown, currencyHint = "CNY"): ReturnType<typeof createMoney> {
  const record = object(value);
  if (record) {
    const currency = text(record.currency) ?? currencyHint;
    const amountMinor = typeof record.amountMinor === "string"
      ? record.amountMinor
      : typeof record.minorAmount === "string"
        ? record.minorAmount
        : undefined;
    if (amountMinor !== undefined) return createMoney(currency, amountMinor);
    if (typeof record.amountMinor === "number" || typeof record.minorAmount === "number") {
      throw invalidResponse("Money.amountMinor 必须由后端序列化为十进制字符串，数字会丢失大整数精度。", value);
    }
    if (record.money !== undefined) return money(record.money, currency);
    if (record.amount !== undefined) return money(record.amount, currency);
  }
  if (typeof value === "string") return createMoney(currencyHint, value);
  if (typeof value === "number") throw invalidResponse("Money 金额必须由后端序列化为十进制字符串，数字会丢失大整数精度。", value);
  throw invalidResponse("响应缺少 Money{currency,amountMinor}。", value);
}

export function optionalMoney(value: unknown, currencyHint = "CNY") {
  return value === undefined || value === null ? undefined : money(value, currencyHint);
}

export function toWireMoney(value: { currency: string; amountMinor: string }): JsonRecord {
  return { currency: value.currency, amountMinor: value.amountMinor };
}

export function mapReceipt(adapter: BackendId, responseValue: unknown, fallback?: { type: string; id?: string }): OperationReceipt {
  const outer = requiredObject(responseValue, "操作响应不是 JSON 对象。");
  const raw = object(outer.receipt) ?? outer;
  const resourceObject = object(raw.resource);
  const resourceType = text(resourceObject?.resourceType) ?? text(raw.resourceType) ?? fallback?.type;
  const resourceId = text(resourceObject?.resourceId) ?? text(raw.resourceId) ?? fallback?.id ?? inferResourceId(outer);
  const readAfterRaw = object(raw.readAfter) ?? {};
  const operationId = requiredOne(raw, ["operationId"], "OperationReceipt 缺少 operationId。");
  const mode = String(readAfterRaw.mode ?? "READ_ONCE") === "POLL" ? "POLL" : "READ_ONCE";
  const operationUrl = text(readAfterRaw.operationUrl) ?? `/operations/${encodeURIComponent(operationId)}`;
  const readAfter: ReadAfter = {
    mode,
    operationUrl,
    resourceUrl: text(readAfterRaw.resourceUrl) ?? null,
    retryAfterMs: numberValue(readAfterRaw.retryAfterMs) ?? null,
  };
  return {
    operationId,
    commandType: text(raw.commandType) ?? text(outer.commandType) ?? "UNKNOWN_COMMAND",
    resource: resourceType && resourceId ? { resourceType, resourceId, uri: readAfter.resourceUrl } : null,
    acceptanceStatus: String(raw.acceptanceStatus) === "ALREADY_ACCEPTED" || raw.idempotentReplay === true ? "ALREADY_ACCEPTED" : "ACCEPTED",
    acceptedAt: text(raw.acceptedAt) ?? null,
    idempotentReplay: raw.idempotentReplay === true || outer.idempotentReplay === true,
    correlationId: text(raw.correlationId) ?? null,
    readAfter,
    source: source(adapter, raw, resourceId),
  };
}

export function mapOperation(adapter: BackendId, value: unknown): Operation {
  const outer = requiredObject(value, "Operation 响应不是对象。");
  const raw = object(outer.operation) ?? outer;
  const error = object(raw.error);
  const resourceRaw = object(raw.resource);
  const resourceType = text(resourceRaw?.resourceType) ?? text(raw.resourceType);
  const resourceId = text(resourceRaw?.resourceId) ?? text(raw.resourceId);
  return {
    operationId: requiredOne(raw, ["operationId"], "Operation 缺少 operationId。"),
    commandType: text(raw.commandType) ?? "UNKNOWN_COMMAND",
    resource: resourceType && resourceId ? { resourceType, resourceId, uri: text(raw.resourceUrl) } : null,
    status: operationStatus(raw.status),
    acceptedAt: text(raw.acceptedAt) ?? null,
    startedAt: text(raw.startedAt) ?? null,
    completedAt: text(raw.completedAt) ?? null,
    error: error ? ({ ...error, fields: [], retryable: booleanValue(error.retryable) ?? false } as never) : null,
    result: raw.result,
    source: source(adapter, raw, requiredOne(raw, ["operationId"], "Operation 缺少 operationId。")),
  };
}

export function mapPage<T>(value: unknown, mapper: (item: JsonRecord) => T): PageResult<T> {
  const raw = requiredObject(value, "分页响应不是对象。");
  return {
    items: records(raw.items).map(mapper),
    nextCursor: text(raw.nextCursor) ?? null,
    pageSize: numberValue(raw.pageSize) ?? records(raw.items).length,
  };
}

export function mapPayment(adapter: BackendId, value: JsonRecord): Payment {
  const paymentId = requiredOne(value, ["paymentId"], "支付响应缺少 paymentId。");
  const paymentMoney = money(value.money ?? value.amount);
  const attempts = records(value.attempts).map((item) => mapPaymentAttempt(item));
  const budgetRaw = object(value.refundBudget);
  const successful = value.successfulRefundAmount ?? budgetRaw?.succeededAmount;
  const reserved = value.reservedRefundAmount ?? budgetRaw?.reservedAmount;
  const available = budgetRaw?.availableAmount;
  const hasRefundBudget = successful !== undefined || reserved !== undefined || available !== undefined;
  const originalAmount = budgetRaw?.originalAmount ? money(budgetRaw.originalAmount, paymentMoney.currency) : paymentMoney;
  const succeededAmount = successful ? money(successful, paymentMoney.currency) : createMoney(paymentMoney.currency, "0");
  const reservedAmount = reserved ? money(reserved, paymentMoney.currency) : createMoney(paymentMoney.currency, "0");
  const derivedAvailableAmount = subtractMoney(originalAmount, succeededAmount, reservedAmount);
  const explicitAvailableAmount = available ? money(available, paymentMoney.currency) : undefined;
  const availableAmount = explicitAvailableAmount ?? derivedAvailableAmount;
  if (hasRefundBudget && (
    !derivedAvailableAmount
    || BigInt(derivedAvailableAmount.amountMinor) < 0n
    || (explicitAvailableAmount !== undefined
      && (explicitAvailableAmount.currency !== derivedAvailableAmount.currency
        || explicitAvailableAmount.amountMinor !== derivedAvailableAmount.amountMinor))
  )) {
    throw invalidResponse("退款预算币种不一致、超过原支付金额或 available 与预算事实不一致。", value);
  }
  const reviewIds = records(value.reviews).map((item) => firstText(item, ["reviewId", "reviewIdentity"])).filter(notEmpty);
  for (const id of arrayValue(value.reviewIds).map(text).filter(notEmpty)) if (!reviewIds.includes(id)) reviewIds.push(id);
  const status = text(value.status) ?? "PAYABLE";
  return {
    resourceType: "payment",
    paymentId,
    merchantId: text(value.merchantId) ?? "",
    merchantOrderId: firstText(value, ["merchantOrderId", "merchantOrderNumber", "merchantOrderNo"]) ?? "",
    idempotencyKey: text(value.idempotencyKey) ?? null,
    money: paymentMoney,
    paymentMethod: text(value.paymentMethod) ?? "",
    status,
    finality: finality(value.finality),
    createdAt: firstText(value, ["createdAt", "sortTime"]) ?? null,
    expiresAt: text(value.expiresAt) ?? null,
    succeededAt: text(value.succeededAt) ?? null,
    closedAt: text(value.closedAt) ?? null,
    externalTransactionId: firstText(value, ["channelTransactionId", "externalTransactionId"])
      ?? attempts.find((attempt) => attempt.finalResult === "SUCCESS")?.externalTransactionId
      ?? attempts.at(-1)?.externalTransactionId
      ?? null,
    successFactId: firstText(value, ["successClaimIdentity", "merchantOrderSuccessIdentity"]) ?? null,
    feeSnapshot: value.feeSnapshot,
    refundBudget: hasRefundBudget ? {
      originalAmount,
      succeededAmount,
      reservedAmount,
      availableAmount: availableAmount!,
    } : undefined,
    attempts,
    reviewIds,
    settlementEligible: booleanValue(value.settlementEligible) ?? null,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? null,
    actions: paymentActions(status, attempts, reviewIds.length > 0),
    source: source(adapter, value, paymentId),
  };
}

function mapPaymentAttempt(value: JsonRecord): PaymentAttempt {
  const attemptId = requiredOne(value, ["attemptId", "paymentAttemptId"], "支付 attempt 缺少标识。");
  return {
    attemptId,
    channelId: firstText(value, ["channelId", "channel"]) ?? "",
    requestIdentity: text(value.requestIdentity) ?? null,
    submissionIdentity: text(value.submissionIdentity) ?? null,
    status: text(value.status) ?? "CREATED",
    interactionInformation: text(value.interactionInformation) ?? null,
    riskReason: text(value.riskReason) ?? null,
    createdAt: firstText(value, ["createdAt", "initiatedAt"]) ?? null,
    submittedAt: text(value.submittedAt) ?? null,
    acceptedAt: text(value.acceptedAt) ?? null,
    completedAt: text(value.completedAt) ?? null,
    externalTransactionId: firstText(value, ["externalTransactionId", "channelTransactionId"]) ?? null,
    finalResult: channelOutcome(value.finalResult),
    submissions: mapAttemptSubmissions(value, attemptId, ["externalTransactionId", "channelTransactionId"]),
    receipts: records(value.resultReceipts ?? value.notificationReceipts).map(mapResultReceipt),
  };
}

function mapSubmission(value: JsonRecord): ChannelSubmissionReceipt {
  return {
    submissionId: requiredOne(value, ["submissionIdentity", "submissionId"], "提交回执缺少 identity。"),
    requestIdentity: text(value.requestIdentity) ?? null,
    channelId: firstText(value, ["channelId", "channel"]) ?? null,
    outcome: firstText(value, ["outcome", "submissionOutcome"]) ?? null,
    channelReference: firstText(value, ["channelReference", "channelTransactionId"]) ?? null,
    submittedAt: text(value.submittedAt) ?? null,
    diagnostic: text(value.diagnosticSummary) ?? null,
  };
}

function mapAttemptSubmissions(value: JsonRecord, attemptId: string, channelReferenceKeys: string[]): ChannelSubmissionReceipt[] {
  const explicit = records(value.submissionReceipts).map(mapSubmission);
  if (explicit.length > 0) return explicit;

  const status = String(text(value.status) ?? "").toUpperCase();
  const submittedAt = text(value.submittedAt);
  const acceptedAt = text(value.acceptedAt);
  const submissionIdentity = text(value.submissionIdentity);
  // CAP4K keeps submission evidence on the attempt even after its status becomes terminal.
  // WOW can mark a newly created attempt PROCESSING and assign requestIdentity
  // before it is submitted, so neither status nor requestIdentity proves submission.
  if (!submissionIdentity && !submittedAt && !acceptedAt) return [];
  const submissionId = submissionIdentity ?? text(value.requestIdentity)
    ?? `${attemptId}:submitted:${submittedAt ?? acceptedAt}`;
  return [{
    submissionId,
    requestIdentity: text(value.requestIdentity) ?? null,
    channelId: firstText(value, ["channelId", "channel"]) ?? null,
    outcome: status,
    channelReference: firstText(value, channelReferenceKeys) ?? null,
    submittedAt: firstText(value, ["submittedAt", "acceptedAt"]) ?? null,
    diagnostic: `由 attempt ${attemptId} 的权威受理事实映射`,
  }];
}

function mapResultReceipt(value: JsonRecord): ChannelResultReceipt {
  const receiptId = firstText(value, ["receiptId", "resultReceiptId", "notificationIdentity"]) ?? "unknown-receipt";
  return {
    receiptId,
    resultIdentity: firstText(value, ["resultIdentity", "notificationIdentity"]) ?? receiptId,
    payloadIdentity: text(value.payloadIdentity) ?? null,
    channelId: firstText(value, ["channelId", "channel"]) ?? null,
    externalTransactionId: firstText(value, ["externalTransactionId", "channelTransactionId", "channelRefundId", "externalSettlementIdentity"]) ?? null,
    money: optionalMoney(value.money ?? value.amount),
    outcome: channelOutcome(value.outcome ?? value.result),
    disposition: firstText(value, ["disposition", "decision"]) ?? null,
    verified: booleanValue(value.verified) ?? (text(value.verificationStatus) === "VERIFIED" ? true : null),
    accepted: booleanValue(value.accepted) ?? null,
    receiveCount: numberValue(value.receiveCount) ?? 1,
    occurredAt: text(value.occurredAt) ?? null,
    recordedAt: firstText(value, ["recordedAt", "firstReceivedAt"]) ?? null,
    summary: firstText(value, ["verificationSummary", "verdictSummary", "rejectionSummary", "conflictSummary"]) ?? null,
  };
}

export function mapRefund(adapter: BackendId, value: JsonRecord): Refund {
  const refundId = requiredOne(value, ["refundId"], "退款响应缺少 refundId。");
  const status = text(value.status) ?? "REQUESTED";
  const attempts = records(value.attempts).map(mapRefundAttempt);
  const reviewIds = arrayValue(value.reviewIds).map(text).filter(notEmpty);
  return {
    resourceType: "refund",
    refundId,
    paymentId: text(value.paymentId) ?? "",
    merchantId: text(value.merchantId) ?? "",
    merchantRefundId: firstText(value, ["merchantRefundId", "merchantRefundNumber", "merchantRefundNo"]) ?? "",
    idempotencyKey: text(value.idempotencyKey) ?? null,
    money: money(value.money ?? value.amount),
    reason: text(value.reason) ?? null,
    paymentMethod: text(value.paymentMethod) ?? null,
    status,
    finality: finality(value.finality),
    requestedAt: firstText(value, ["requestedAt", "createdAt", "sortTime"]) ?? null,
    finalizedAt: text(value.finalizedAt) ?? null,
    externalTransactionId: firstText(value, ["channelRefundId", "channelTransactionId"]) ?? null,
    reservationActive: booleanValue(value.reservationActive) ?? null,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? null,
    attempts,
    reviewIds,
    actions: refundActions(status, attempts, reviewIds.length > 0),
    source: source(adapter, value, refundId),
  };
}

function mapRefundAttempt(value: JsonRecord): RefundAttempt {
  const attemptId = requiredOne(value, ["attemptId", "refundAttemptId"], "退款 attempt 缺少标识。");
  return {
    attemptId,
    channelId: firstText(value, ["channelId", "channel"]) ?? "",
    requestIdentity: text(value.requestIdentity) ?? null,
    submissionIdentity: text(value.submissionIdentity) ?? null,
    status: text(value.status) ?? "CREATED",
    createdAt: firstText(value, ["createdAt", "initiatedAt"]) ?? null,
    acceptedAt: text(value.acceptedAt) ?? null,
    completedAt: text(value.completedAt) ?? null,
    externalTransactionId: firstText(value, ["channelRefundId", "channelTransactionId"]) ?? null,
    finalResult: channelOutcome(value.finalResult),
    submissions: mapAttemptSubmissions(value, attemptId, ["channelRefundId", "channelTransactionId"]),
    receipts: records(value.resultReceipts ?? value.notificationReceipts).map(mapResultReceipt),
  };
}

export function mapReconciliationRun(adapter: BackendId, value: JsonRecord): ReconciliationRun {
  const runId = requiredOne(value, ["runId"], "对账响应缺少 runId。");
  const status = text(value.status) ?? "PENDING";
  const scopeRaw = object(value.scope);
  const merchantIds = arrayValue(scopeRaw?.merchantIds ?? value.merchantIds).map(text).filter(notEmpty);
  const singleMerchantId = firstText(value, ["merchantId"]) ?? firstText(scopeRaw ?? {}, ["merchantId"]);
  if (singleMerchantId && !merchantIds.includes(singleMerchantId)) merchantIds.push(singleMerchantId);
  return {
    resourceType: "reconciliationRun",
    runId,
    billId: firstText(value, ["billId", "billIdentity", "statementId"]) ?? "",
    scope: {
      channelId: firstText(scopeRaw ?? {}, ["channelId"]) ?? text(value.channelId) ?? "",
      currency: firstText(scopeRaw ?? {}, ["currency"]) ?? text(value.currency) ?? "CNY",
      businessDate: firstText(scopeRaw ?? {}, ["businessDate", "reconciliationDate"])
        ?? firstText(value, ["businessDate", "reconciliationDate"])
        ?? null,
      businessTimezone: firstText(scopeRaw ?? {}, ["businessTimezone"])
        ?? text(value.businessTimezone)
        ?? null,
    },
    merchantIds,
    billRevision: value.billRevision as number | string | undefined ?? value.statementRevision as number | string | undefined ?? null,
    status,
    finality: finality(value.finality),
    effectiveRun: booleanValue(value.effectiveRun) ?? null,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? null,
    createdAt: firstText(value, ["createdAt", "sortTime"]) ?? null,
    completedAt: text(value.completedAt) ?? null,
    differences: records(value.differences ?? value.items).map(mapDifference),
    actions: reconciliationActions(status),
    source: source(adapter, value, runId),
  };
}

function mapDifference(value: JsonRecord): ReconciliationDifference {
  const platformEvidenceRefs = evidenceRefs(value.platformEvidenceRefs ?? value.platformEvidence);
  const billEvidenceRefs = evidenceRefs(value.billEvidenceRefs ?? value.billEvidence);
  const platformFactIdentity = text(value.platformFactIdentity);
  const channelRecordIdentity = firstText(value, ["channelRecordIdentity", "recordIdentity"]);
  if (platformFactIdentity && platformEvidenceRefs.length === 0) platformEvidenceRefs.push({ evidenceType: "PLATFORM_FACT", evidenceId: platformFactIdentity });
  if (channelRecordIdentity && billEvidenceRefs.length === 0) billEvidenceRefs.push({ evidenceType: "BILL_RECORD", evidenceId: channelRecordIdentity });
  return {
    // Commands address the CAP4K reconciliation item resource by itemId;
    // differenceIdentity is business evidence, not that transport resource id.
    // WOW exposes differenceId directly and therefore still takes precedence.
    differenceId: requiredOne(value, ["differenceId", "itemId", "differenceIdentity"], "差异响应缺少标识。"),
    differenceType: reconciliationDifferenceType(value.differenceType),
    transactionKind: text(value.transactionKind) ?? null,
    paymentId: text(value.paymentId) ?? null,
    refundId: text(value.refundId) ?? null,
    attemptId: firstText(value, ["paymentAttemptId", "refundAttemptId", "attemptId"]) ?? null,
    externalTransactionId: firstText(value, ["channelTransactionIdentity", "externalTransactionId"]) ?? null,
    platformMoney: optionalMoney(value.platformMoney ?? value.platformAmount ?? value.amount, text(value.currency) ?? "CNY"),
    channelMoney: optionalMoney(value.channelMoney ?? value.channelAmount, text(value.currency) ?? "CNY"),
    platformStatus: text(value.platformStatus) ?? null,
    channelStatus: text(value.channelStatus) ?? null,
    matchingBasis: firstText(value, ["matchingBasis", "sourceFactIdentity"]) ?? null,
    platformEvidenceRefs,
    billEvidenceRefs,
    resolved: booleanValue(value.resolved) ?? false,
    settlementBlocked: booleanValue(value.settlementBlocked) ?? false,
    dispositions: records(value.dispositions).map((item) => ({
      status: text(item.status) ?? null,
      conclusion: text(item.conclusion) ?? null,
      settlementImpact: text(item.settlementImpact) ?? null,
      actorId: firstText(item, ["actorId", "operatorIdentity"]) ?? null,
      actorRole: firstText(item, ["actorRole", "operatorRole"]) ?? null,
      reason: text(item.reason) ?? null,
      evidenceRefs: evidenceRefs(item.evidenceRefs ?? item.evidence),
      recordedAt: firstText(item, ["recordedAt", "decidedAt"]) ?? null,
    })),
    confirmations: records(value.confirmationFacts).map((item) => ({
      actorId: firstText(item, ["actorId", "operatorIdentity"]) ?? null,
      actorRole: firstText(item, ["actorRole", "operatorRole"]) ?? null,
      reason: text(item.reason) ?? null,
      evidenceRefs: evidenceRefs(item.evidenceRefs ?? item.evidence),
      recordedAt: firstText(item, ["recordedAt", "confirmedAt"]) ?? null,
      confirmation: item,
    })),
  };
}

export function mapSettlement(adapter: BackendId, value: JsonRecord): Settlement {
  const settlementId = requiredOne(value, ["settlementId"], "结算响应缺少 settlementId。");
  const currency = text(value.currency) ?? "CNY";
  const status = text(value.status) ?? "PREPARING";
  const items = records(value.items ?? value.lines).map((item) => mapSettlementItem(item, currency));
  const executions = records(value.executions ?? value.attempts).map((item) => mapSettlementExecution(item, currency));
  return {
    resourceType: "settlement",
    settlementId,
    merchantId: text(value.merchantId) ?? "",
    channelId: firstText(value, ["channelId", "executionChannelId"]) ?? null,
    currency,
    scopeId: firstText(value, ["effectiveScopeIdentity", "scopeIdentity"]) ?? null,
    status,
    finality: finality(value.finality),
    grossAmount: optionalMoney(value.grossAmount ?? value.grossMoney, currency),
    refundAmount: optionalMoney(value.refundAmount ?? value.refundMoney, currency),
    feeAmount: optionalMoney(value.feeAmount ?? value.feeMoney, currency),
    adjustmentAmount: optionalMoney(value.adjustmentAmount ?? value.adjustmentMoney, currency),
    netAmount: optionalMoney(value.netAmount ?? value.netMoney, currency),
    periodStart: text(value.periodStart) ?? text(object(value.settlementPeriod)?.start) ?? null,
    periodEnd: text(value.periodEnd) ?? text(object(value.settlementPeriod)?.end) ?? null,
    businessTimezone: text(value.businessTimezone) ?? text(object(value.settlementPeriod)?.timezone) ?? null,
    version: numberValue(value.version) ?? null,
    blockerSummary: text(value.blockerSummary) ?? null,
    predecessorSettlementId: text(value.predecessorSettlementId) ?? null,
    replacementSettlementId: text(value.replacementSettlementId) ?? null,
    items,
    executions,
    reviewIds: arrayValue(value.reviewIds ?? value.reviewDecisionIds).map(text).filter(notEmpty),
    actions: settlementActions(status),
    source: source(adapter, value, settlementId),
  };
}

function mapSettlementItem(value: JsonRecord, currency: string): SettlementItem {
  return {
    settlementItemId: requiredOne(value, ["settlementItemId", "lineId", "itemId"], "结算 item 缺少标识。"),
    sourceKind: text(value.sourceKind) ?? "UNKNOWN",
    sourceIdentity: firstText(value, ["sourceIdentity", "lineIdentity"]) ?? null,
    sourceFactIdentity: text(value.sourceFactIdentity) ?? null,
    disposition: firstText(value, ["disposition", "decision"]) ?? "INCLUDED",
    amountImpact: money(value.amountImpact ?? value.signedNetAmount ?? value.signedNetMoney ?? { currency, amountMinor: "0" }, currency),
    reasonCode: text(value.reasonCode) ?? "UNSPECIFIED",
    description: text(value.description) ?? null,
    paymentId: text(value.paymentId) ?? null,
    refundId: text(value.refundId) ?? null,
    reconciliationRunId: firstText(value, ["reconciliationRunId", "reconciliationRunIdentity"]) ?? null,
    occurredAt: text(value.occurredAt) ?? null,
    recordedAt: text(value.recordedAt) ?? null,
  };
}

function mapSettlementExecution(value: JsonRecord, currency: string): SettlementExecution {
  const executionId = requiredOne(value, ["executionId", "attemptId"], "结算 execution 缺少标识。");
  return {
    executionId,
    executionGroupIdentity: text(value.executionGroupIdentity) ?? null,
    requestIdentity: text(value.requestIdentity) ?? null,
    status: text(value.status) ?? "SUBMITTED",
    money: money(value.money ?? value.amount ?? { currency, amountMinor: "0" }, currency),
    submittedAt: firstText(value, ["submittedAt", "initiatedAt", "createdAt"]) ?? null,
    occurredAt: text(value.occurredAt) ?? null,
    externalSettlementId: firstText(value, ["externalSettlementIdentity", "externalSettlementId"]) ?? null,
    receipts: records(value.receipts).map(mapResultReceipt),
  };
}

export function mapManualReview(adapter: BackendId, value: JsonRecord): ManualReviewItem {
  const raw = object(value.review) ?? value;
  const reviewId = requiredOne(raw, ["reviewId", "reviewIdentity"], "人工核对响应缺少 reviewId。");
  const dispositions = records(raw.dispositions ?? raw.resolutions).map(mapReviewDisposition);
  return {
    resourceType: "manualReview",
    reviewId,
    merchantId: text(raw.merchantId) ?? null,
    type: text(raw.type) ?? text(raw.originKind) ?? "UNKNOWN",
    status: text(raw.status) ?? "OPEN",
    finality: finality(raw.finality),
    summary: text(raw.summary) ?? null,
    relatedResources: resourceRefs(raw.relatedResourceRefs ?? raw.relatedRefs, raw),
    blockingScopes: arrayValue(raw.blockingScopes).map((item) => {
      if (typeof item === "string") return item;
      const scope = object(item);
      const scopeType = firstText(scope, ["scopeType", "type"]);
      const scopeId = firstText(scope, ["scopeId", "id"]);
      return scopeType && scopeId ? `${scopeType}:${scopeId}` : undefined;
    }).filter(notEmpty),
    evidenceRefs: evidenceRefs(raw.evidenceRefs),
    createdAt: firstText(raw, ["createdAt", "sortTime"]) ?? null,
    resolvedAt: text(raw.resolvedAt) ?? null,
    dispositions,
    actions: String(raw.status) === "OPEN" ? [action("RESOLVE_MANUAL_REVIEW", "提交责任处置", "danger")] : [],
    source: source(adapter, raw, reviewId),
  };
}

function mapReviewDisposition(value: JsonRecord): ManualReviewDisposition {
  return {
    outcome: text(value.outcome) ?? text(value.decision) ?? "UNKNOWN",
    actorId: firstText(value, ["actorId", "operatorIdentity"]) ?? null,
    actorRole: firstText(value, ["actorRole", "operatorRole"]) ?? null,
    reason: text(value.reason) ?? "",
    evidenceRefs: evidenceRefs(value.evidenceRefs ?? value.evidence),
    recordedAt: firstText(value, ["recordedAt", "resolvedAt", "decidedAt"]) ?? null,
  };
}

export function mapNotification(adapter: BackendId, value: JsonRecord): MerchantNotification {
  const raw = object(value.notification) ?? value;
  const notificationId = requiredOne(raw, ["notificationId", "notificationIdentity"], "通知响应缺少 notificationId。");
  const resourceType = firstText(raw, ["resourceType", "sourceKind"]);
  const resourceId = firstText(raw, ["resourceId", "sourceFactIdentity", "paymentId", "settlementId"]);
  return {
    notificationId,
    contentIdentity: text(raw.contentIdentity) ?? null,
    merchantId: text(raw.merchantId) ?? null,
    resource: resourceType && resourceId ? { resourceType, resourceId } : null,
    status: firstText(raw, ["status", "deliveryStatus"]) ?? "UNKNOWN",
    attempts: records(raw.deliveryAttempts).map((item) => ({
      attemptId: firstText(item, ["attemptId", "deliveryAttemptId"]) ?? null,
      status: firstText(item, ["status", "outcome"]) ?? "UNKNOWN",
      attemptedAt: firstText(item, ["attemptedAt", "recordedAt"]) ?? null,
      diagnostic: text(item.diagnostic) ?? null,
    })),
    createdAt: firstText(raw, ["createdAt", "sortTime"]) ?? null,
    source: source(adapter, raw, notificationId),
  };
}

export function mapTimeline(adapter: BackendId, paymentId: string, value: unknown): PaymentTimeline {
  const raw = requiredObject(value, "Timeline 响应不是对象。");
  const rawEntries = records(raw.entries ?? raw.items);
  const entries = rawEntries.map(mapTimelineEntry).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId));
  return {
    paymentId: text(raw.paymentId) ?? paymentId,
    entries,
    nextCursor: text(raw.nextCursor) ?? null,
    pageSize: numberValue(raw.pageSize) ?? entries.length,
    source: source(adapter, raw, paymentId),
  };
}

function mapTimelineEntry(value: JsonRecord): TimelineEntry {
  return {
    eventId: requiredOne(value, ["eventId"], "Timeline entry 缺少 eventId。"),
    category: firstText(value, ["category", "eventType"]) ?? "UNKNOWN",
    occurredAt: text(value.occurredAt) ?? null,
    recordedAt: text(value.recordedAt) ?? "",
    relatedResourceRefs: resourceRefs(value.relatedResourceRefs ?? value.refs),
    outcome: text(value.outcome) ?? null,
    actorId: text(value.actorId) ?? null,
    reason: text(value.reason) ?? null,
    evidenceRefs: evidenceRefs(value.evidenceRefs),
    money: optionalMoney(value.money ?? value.amount),
    summary: text(value.summary) ?? null,
  };
}

export function mapBill(adapter: BackendId, value: JsonRecord): AuthoritativeBill {
  const billId = requiredOne(value, ["billId", "billIdentity", "statementId"], "账单响应缺少 billId。");
  return {
    billId,
    channelId: text(value.channelId) ?? "",
    merchantId: text(value.merchantId) ?? null,
    currency: text(value.currency) ?? "CNY",
    businessDate: firstText(value, ["businessDate", "reconciliationDate"]) ?? null,
    currentRevision: numberValue(value.currentRevision) ?? numberValue(value.revision) ?? null,
    currentRevisionId: text(value.currentRevisionId) ?? null,
    businessTimezone: text(value.businessTimezone) ?? null,
    createdAt: text(value.createdAt) ?? null,
    revisions: records(value.revisions).map((revision) => ({
      billId,
      revision: numberValue(revision.revision) ?? 0,
      revisionId: text(revision.revisionId) ?? null,
      channelId: text(revision.channelId) ?? text(value.channelId) ?? "",
      merchantId: text(revision.merchantId) ?? text(value.merchantId) ?? "",
      currency: text(revision.currency) ?? text(value.currency) ?? "CNY",
      businessDate: firstText(revision, ["businessDate", "reconciliationDate"]) ?? null,
      complete: booleanValue(revision.complete) ?? (text(revision.completeness) === "COMPLETE" ? true : text(revision.completeness) === "PARTIAL" ? false : null),
      completeness: text(revision.completeness)
        ?? (booleanValue(revision.complete) === true ? "COMPLETE" : booleanValue(revision.complete) === false ? "PARTIAL" : null),
      payloadFingerprint: firstText(revision, ["payloadFingerprint", "contentFingerprint"]) ?? null,
      rawEvidence: text(revision.rawEvidence) ?? null,
      records: records(revision.records).map(mapBillRecord),
      publishedAt: text(revision.publishedAt) ?? null,
    })),
    source: source(adapter, value, billId),
  };
}

function mapBillRecord(value: JsonRecord): BillRecord {
  return {
    recordId: requiredOne(value, ["recordId", "recordIdentity"], "账单记录缺少 recordId。"),
    recordIdentity: text(value.recordIdentity) ?? null,
    transactionKind: text(value.transactionKind) ?? "PAYMENT",
    externalTransactionId: firstText(value, ["externalTransactionId", "channelTransactionIdentity", "externalTransactionIdentity"]) ?? "",
    money: money(value.money ?? value.amount),
    status: firstText(value, ["status", "rawStatus"]) ?? "SUCCESS",
    rawStatus: firstText(value, ["rawStatus", "status"]) ?? null,
    occurredAt: text(value.occurredAt) ?? null,
    receivedAt: text(value.receivedAt) ?? null,
    rawEvidence: text(value.rawEvidence) ?? null,
  };
}

export function queryString(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")) as T;
}

export function records(value: unknown): JsonRecord[] {
  return arrayValue(value).filter(isRecord);
}

export function object(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function requiredObject(value: unknown, message: string): JsonRecord {
  if (isRecord(value)) return value;
  throw invalidResponse(message, value);
}

export function text(value: unknown): string | undefined {
  return stringValue(value);
}

export function requiredOne(value: JsonRecord, fields: string[], message: string): string {
  const candidate = firstText(value, fields);
  if (candidate) return candidate;
  throw invalidResponse(message, value);
}

export function firstText(value: JsonRecord | undefined, fields: string[]): string | undefined {
  if (!value) return undefined;
  for (const field of fields) {
    const candidate = text(value[field]);
    if (candidate !== undefined && candidate !== "") return candidate;
  }
  return undefined;
}

export function pathId(value: string): string {
  return encodeURIComponent(value);
}

export function invalidResponse(message: string, diagnostic: unknown): BusinessError {
  return new BusinessError({ code: "ADAPTER_RESPONSE_INVALID", message, fields: [], retryable: false, diagnostic });
}

function operationStatus(value: unknown): Operation["status"] {
  const status = String(value ?? "ACCEPTED");
  return ["ACCEPTED", "PROCESSING", "SUCCEEDED", "FAILED", "REVIEW_REQUIRED"].includes(status) ? status as Operation["status"] : "ACCEPTED";
}

function reconciliationDifferenceType(value: unknown): ReconciliationDifferenceType {
  const normalized = String(value ?? "UNKNOWN").trim().toUpperCase();
  if (normalized === "DUPLICATE_CHANNEL_RECORD" || normalized === "DUPLICATE_RECORD") return "DUPLICATE";
  if ([
    "MATCHED",
    "PLATFORM_ONLY",
    "CHANNEL_ONLY",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "STATUS_MISMATCH",
    "DUPLICATE",
    "UNMATCHED",
  ].includes(normalized)) return normalized as ReconciliationDifferenceType;
  return "UNKNOWN";
}

function inferResourceId(value: JsonRecord): string | undefined {
  return firstText(value, ["paymentId", "refundId", "runId", "settlementId", "reviewId", "notificationId", "billId", "billIdentity", "replacementSettlementId"]);
}

function resourceRefs(value: unknown, origin?: JsonRecord): ResourceRef[] {
  const recordValue = object(value);
  const mappedRecord = recordValue
    ? Object.entries(recordValue).map(([resourceType, resourceId]) => ({ resourceType, resourceId: text(resourceId) ?? "unknown" }))
    : [];
  const mappedArray = arrayValue(value).map((item) => {
    if (typeof item === "string") {
      const [resourceType = "resource", resourceId = item] = item.split(":", 2);
      return { resourceType, resourceId };
    }
    const record = object(item);
    if (!record) return null;
    const resourceType = firstText(record, ["resourceType", "type"]) ?? "resource";
    const resourceId = firstText(record, ["resourceId", "id"]) ?? "unknown";
    return { resourceType, resourceId, uri: text(record.uri) ?? null };
  }).filter((item): item is ResourceRef => item !== null);
  if (mappedRecord.length > 0) return mappedRecord;
  if (mappedArray.length > 0) return mappedArray;
  const originType = firstText(origin, ["originKind"]);
  const originId = firstText(origin, ["originIdentity"]);
  return originType && originId ? [{ resourceType: originType, resourceId: originId }] : [];
}

function evidenceRefs(value: unknown): EvidenceRef[] {
  return arrayValue(typeof value === "string" ? [value] : value).map((item) => {
    if (typeof item === "string") return { evidenceType: "REFERENCE", evidenceId: item };
    const record = object(item);
    if (!record) return null;
    return {
      evidenceType: firstText(record, ["evidenceType", "type"]) ?? "REFERENCE",
      evidenceId: firstText(record, ["evidenceId", "id"]) ?? "unknown",
      uri: text(record.uri) ?? null,
    };
  }).filter((item): item is EvidenceRef => item !== null);
}

function attemptActions<T extends { status: string; submissions: ChannelSubmissionReceipt[]; finalResult?: ChannelOutcome | null }>(
  attempts: T[], createKind: ActionKind, submitKind: ActionKind, createAllowed: boolean,
): ActionDescriptor[] {
  const active = attempts.find((attempt) => !attempt.finalResult && !["FAILED", "REJECTED", "SUCCEEDED", "CANCELLED", "CLOSED"].includes(attempt.status));
  const submittable = attempts.some(submittableAttempt);
  const create = action(createKind, "创建新 attempt");
  if (!createAllowed || active) {
    create.executable = false;
    create.reason = active ? submittable ? "已有未提交 attempt，请先提交现有 attempt。" : "已有在途 attempt，请等待渠道结果或处理人工核对。" : "当前业务状态不允许创建新 attempt。";
  }
  const submit = action(submitKind, "提交 attempt");
  submit.executable = submittable;
  if (!submittable) submit.reason = active ? "当前 attempt 已提交，请等待结果。" : "请先创建可提交的 attempt。";
  return [create, submit];
}

function paymentActions(status: string, attempts: PaymentAttempt[], hasReview: boolean): ActionDescriptor[] {
  const result: ActionDescriptor[] = [action("VIEW_TIMELINE", "查看完整业务轨迹", "none")];
  result.push(...attemptActions(attempts, "CREATE_PAYMENT_ATTEMPT", "SUBMIT_PAYMENT_ATTEMPT", ["PAYABLE", "PENDING", "PROCESSING"].includes(status)));
  // Result reception stays available after a business terminal state so the
  // reference workbench can demonstrate duplicate, late and conflicting inbox
  // semantics without pretending that the resource itself can move backwards.
  if (attempts.length) result.push(action("RECEIVE_PAYMENT_RESULT", "注入可信渠道结果", "danger"));
  if (["PAYABLE", "PENDING"].includes(status)) result.push(action("CLOSE_EXPIRED_PAYMENT", "处理到期支付", "danger"));
  if (status === "SUCCEEDED") result.push(action("REQUEST_REFUND", "申请退款", "danger"));
  if (hasReview) result.push(action("RESOLVE_MANUAL_REVIEW", "处理人工核对", "danger"));
  return result;
}

function refundActions(status: string, attempts: RefundAttempt[], hasReview: boolean): ActionDescriptor[] {
  const result: ActionDescriptor[] = attemptActions(attempts, "CREATE_REFUND_ATTEMPT", "SUBMIT_REFUND_ATTEMPT", ["REQUESTED", "PROCESSING"].includes(status));
  if (attempts.length) result.push(action("RECEIVE_REFUND_RESULT", "注入可信退款结果", "danger"));
  if (hasReview || status === "RESULT_UNKNOWN") result.push(action("RESOLVE_MANUAL_REVIEW", "处理人工核对", "danger"));
  return result;
}

function reconciliationActions(status: string): ActionDescriptor[] {
  const result = [action("RERUN_RECONCILIATION", "重跑对账")];
  if (["ACTION_REQUIRED", "REVIEW_REQUIRED", "RUNNING", "RECONCILING"].includes(status)) {
    result.push(action("DISPOSE_RECONCILIATION_DIFFERENCE", "追加差异处置", "danger"));
    result.push(action("CONFIRM_RECONCILIATION_FACT", "追加事实确认", "danger"));
    result.push(action("COMPLETE_RECONCILIATION", "完成对账", "danger"));
  }
  return result;
}

function settlementActions(status: string): ActionDescriptor[] {
  const result: ActionDescriptor[] = [];
  if (["READY_FOR_CONFIRMATION", "PREPARING"].includes(status)) result.push(action("CONFIRM_SETTLEMENT", "确认并冻结结算", "danger"));
  if (["CONFIRMED", "EXECUTION_FAILED"].includes(status)) result.push(action("EXECUTE_SETTLEMENT", status === "EXECUTION_FAILED" ? "明确失败后创建新执行" : "发起结算执行", "danger"));
  if (["EXECUTING", "RESULT_UNKNOWN", "EXECUTION_FAILED"].includes(status)) result.push(action("RECEIVE_SETTLEMENT_RESULT", "注入结算执行结果", "danger"));
  if (!["SETTLED", "RESULT_UNKNOWN", "VOIDED", "REPLACED"].includes(status)) result.push(action("VOID_SETTLEMENT", "作废结算", "danger"));
  if (status === "READY_FOR_CONFIRMATION") result.push(action("CREATE_SETTLEMENT_REPLACEMENT", "作废并创建替代结算", "danger"));
  return result;
}

function notEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}
