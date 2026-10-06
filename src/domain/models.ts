import type { Money } from "./money";

export type BackendId = "wow" | "cap4k";
export type Finality = "NON_FINAL" | "FINAL" | "REVIEW_REQUIRED";
export type AcceptanceStatus = "ACCEPTED" | "ALREADY_ACCEPTED";
export type OperationStatus = "ACCEPTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "REVIEW_REQUIRED";
export type ReadAfterMode = "READ_ONCE" | "POLL";
export type ChannelOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";
export type ResourceType = "payment" | "refund" | "reconciliationRun" | "settlement" | "manualReview" | "notification" | "bill";
export type CapabilityLevel = "full" | "alternative" | "unavailable";
export type ReconciliationDifferenceType =
  | "MATCHED"
  | "PLATFORM_ONLY"
  | "CHANNEL_ONLY"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "STATUS_MISMATCH"
  | "DUPLICATE"
  | "UNMATCHED"
  | "UNKNOWN";

/**
 * A non-authoritative browser shortcut. Authoritative collections always come
 * from the adapter list APIs; this shape is never used as list data.
 */
export interface RecentRecord {
  backendId: BackendId;
  resourceType: ResourceType;
  id: string;
  label: string;
  status?: string;
  accessedAt: string;
}

export interface ResourceRef {
  resourceType: string;
  resourceId: string;
  uri?: string | null;
}

export interface EvidenceRef {
  evidenceType: string;
  evidenceId: string;
  uri?: string | null;
}

export interface SourceMetadata {
  adapter: BackendId;
  sourceStatus?: string | null;
  sourceId?: string | null;
  sourceTime?: string | null;
  diagnostic?: unknown;
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
  retryable: boolean;
  fields: FieldError[];
  httpStatus?: number;
  sourceCode?: string;
  sourceMessage?: string;
  diagnostic?: unknown;
}

export interface ReadAfter {
  mode: ReadAfterMode;
  operationUrl: string;
  resourceUrl?: string | null;
  retryAfterMs?: number | null;
}

export interface OperationReceipt {
  operationId: string;
  commandType: string;
  resource?: ResourceRef | null;
  acceptanceStatus: AcceptanceStatus;
  acceptedAt?: string | null;
  idempotentReplay: boolean;
  correlationId?: string | null;
  readAfter: ReadAfter;
  source: SourceMetadata;
}

export interface Operation {
  operationId: string;
  commandType: string;
  resource?: ResourceRef | null;
  status: OperationStatus;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: ApiErrorShape | null;
  result?: unknown;
  source: SourceMetadata;
}

export type ActionKind =
  | "CREATE_PAYMENT_ATTEMPT"
  | "SUBMIT_PAYMENT_ATTEMPT"
  | "RECEIVE_PAYMENT_RESULT"
  | "CLOSE_EXPIRED_PAYMENT"
  | "REQUEST_REFUND"
  | "CREATE_REFUND_ATTEMPT"
  | "SUBMIT_REFUND_ATTEMPT"
  | "RECEIVE_REFUND_RESULT"
  | "REGISTER_BILL"
  | "SIGNAL_BILL_AVAILABLE"
  | "RUN_RECONCILIATION"
  | "RERUN_RECONCILIATION"
  | "DISPOSE_RECONCILIATION_DIFFERENCE"
  | "CONFIRM_RECONCILIATION_FACT"
  | "COMPLETE_RECONCILIATION"
  | "PREPARE_SETTLEMENT"
  | "CONFIRM_SETTLEMENT"
  | "EXECUTE_SETTLEMENT"
  | "RECEIVE_SETTLEMENT_RESULT"
  | "VOID_SETTLEMENT"
  | "CREATE_SETTLEMENT_REPLACEMENT"
  | "RESOLVE_MANUAL_REVIEW"
  | "RETRY_NOTIFICATION"
  | "VIEW_TIMELINE";

export interface ActionDescriptor {
  kind: ActionKind;
  label: string;
  executable: boolean;
  availability: CapabilityLevel;
  reason?: string;
  alternative?: string;
  confirmation: "none" | "confirm" | "danger";
}

export interface CapabilityDeclaration {
  id: string;
  label: string;
  description: string;
  level: CapabilityLevel;
  alternative?: string;
}

export interface ImplementationDifference {
  topic: string;
  unifiedMeaning: string;
  implementation: string;
}

export interface BackendProfile {
  id: BackendId;
  label: string;
  apiBaseUrl: string;
  referenceOnly: true;
  capabilities: CapabilityDeclaration[];
  implementationDifferences: ImplementationDifference[];
}

export interface ChannelSubmissionReceipt {
  submissionId: string;
  requestIdentity?: string | null;
  channelId?: string | null;
  outcome?: string | null;
  channelReference?: string | null;
  submittedAt?: string | null;
  diagnostic?: string | null;
}

export interface ChannelResultReceipt {
  receiptId: string;
  resultIdentity: string;
  payloadIdentity?: string | null;
  channelId?: string | null;
  externalTransactionId?: string | null;
  money?: Money;
  outcome?: ChannelOutcome | null;
  disposition?: string | null;
  verified?: boolean | null;
  accepted?: boolean | null;
  receiveCount?: number;
  occurredAt?: string | null;
  recordedAt?: string | null;
  summary?: string | null;
}

export interface PaymentAttempt {
  attemptId: string;
  channelId: string;
  requestIdentity?: string | null;
  submissionIdentity?: string | null;
  status: string;
  interactionInformation?: string | null;
  riskReason?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  externalTransactionId?: string | null;
  finalResult?: ChannelOutcome | null;
  submissions: ChannelSubmissionReceipt[];
  receipts: ChannelResultReceipt[];
}

export interface RefundBudget {
  originalAmount: Money;
  succeededAmount: Money;
  reservedAmount: Money;
  availableAmount: Money;
}

export interface Payment {
  resourceType: "payment";
  paymentId: string;
  merchantId: string;
  merchantOrderId: string;
  idempotencyKey?: string | null;
  money: Money;
  paymentMethod: string;
  status: string;
  finality: Finality;
  createdAt?: string | null;
  expiresAt?: string | null;
  succeededAt?: string | null;
  closedAt?: string | null;
  externalTransactionId?: string | null;
  successFactId?: string | null;
  feeSnapshot?: unknown;
  refundBudget?: RefundBudget;
  attempts: PaymentAttempt[];
  reviewIds: string[];
  settlementEligible?: boolean | null;
  settlementBlocked?: boolean | null;
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface RefundAttempt {
  attemptId: string;
  channelId: string;
  requestIdentity?: string | null;
  submissionIdentity?: string | null;
  status: string;
  createdAt?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  externalTransactionId?: string | null;
  finalResult?: ChannelOutcome | null;
  submissions: ChannelSubmissionReceipt[];
  receipts: ChannelResultReceipt[];
}

export interface Refund {
  resourceType: "refund";
  refundId: string;
  paymentId: string;
  merchantId: string;
  merchantRefundId: string;
  idempotencyKey?: string | null;
  money: Money;
  reason?: string | null;
  paymentMethod?: string | null;
  status: string;
  finality: Finality;
  requestedAt?: string | null;
  finalizedAt?: string | null;
  externalTransactionId?: string | null;
  reservationActive?: boolean | null;
  settlementBlocked?: boolean | null;
  attempts: RefundAttempt[];
  reviewIds: string[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface DifferenceDisposition {
  status?: string | null;
  conclusion?: string | null;
  settlementImpact?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  evidenceRefs: EvidenceRef[];
  recordedAt?: string | null;
}

export interface FactConfirmation extends DifferenceDisposition {
  confirmation?: unknown;
}

export interface ReconciliationDifference {
  differenceId: string;
  differenceType: ReconciliationDifferenceType;
  /** Original classification, including values unknown to this client. */
  sourceDifferenceType?: string | null;
  transactionKind?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  attemptId?: string | null;
  externalTransactionId?: string | null;
  platformMoney?: Money;
  channelMoney?: Money;
  platformStatus?: string | null;
  channelStatus?: string | null;
  matchingBasis?: string | null;
  platformEvidenceRefs: EvidenceRef[];
  billEvidenceRefs: EvidenceRef[];
  resolved: boolean | null;
  settlementBlocked: boolean | null;
  dispositions: DifferenceDisposition[];
  confirmations: FactConfirmation[];
}

export interface ReconciliationScope {
  channelId: string;
  currency: string;
  businessDate?: string | null;
  businessTimezone?: string | null;
}

export interface ReconciliationRun {
  resourceType: "reconciliationRun";
  runId: string;
  billId: string;
  scope: ReconciliationScope;
  /** Merchant associations explicitly returned by the backend; never inferred from a list filter. */
  merchantIds: string[];
  billRevision?: number | string | null;
  status: string;
  finality: Finality;
  effectiveRun?: boolean | null;
  settlementBlocked?: boolean | null;
  createdAt?: string | null;
  completedAt?: string | null;
  /** Backend counts only; omitted values must not be interpreted as zero. */
  matchedCount?: number | null;
  differenceCount?: number | null;
  unresolvedDifferenceCount?: number | null;
  blockingDifferenceCount?: number | null;
  totalRecordCount?: number | null;
  /** True only when this response is known to contain the complete Run detail. */
  detailsComplete?: boolean | null;
  differences: ReconciliationDifference[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface BillRecord {
  /** Source resource identifier; CAP4K returns an internal UUID here. */
  recordId: string;
  /** Stable business identity used when copying a record into a new revision. */
  recordIdentity?: string | null;
  transactionKind: string;
  externalTransactionId: string;
  money: Money;
  /** Normalized status for display and matching; source status remains separate. */
  status: string;
  rawStatus?: string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  rawEvidence?: string | null;
}

export interface BillRevision {
  billId: string;
  revision: number | string;
  revisionId?: string | null;
  channelId: string;
  merchantId: string;
  currency: string;
  businessDate?: string | null;
  businessTimezone?: string | null;
  complete?: boolean | null;
  completeness?: string | null;
  payloadFingerprint?: string | null;
  rawEvidence?: string | null;
  records: BillRecord[];
  publishedAt?: string | null;
}

export interface AuthoritativeBill {
  billId: string;
  channelId: string;
  merchantId?: string | null;
  currency: string;
  businessDate?: string | null;
  currentRevision?: number | string | null;
  currentRevisionId?: string | null;
  businessTimezone?: string | null;
  createdAt?: string | null;
  revisions?: BillRevision[];
  source: SourceMetadata;
}

export interface SettlementItem {
  settlementItemId: string;
  sourceKind: string;
  sourceIdentity?: string | null;
  sourceFactIdentity?: string | null;
  disposition: string;
  amountImpact: Money;
  reasonCode: string;
  description?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  reconciliationRunId?: string | null;
  occurredAt?: string | null;
  recordedAt?: string | null;
}

export interface SettlementExecutionReceipt extends ChannelResultReceipt {}

export interface SettlementExecution {
  executionId: string;
  executionGroupIdentity?: string | null;
  requestIdentity?: string | null;
  status: string;
  money: Money;
  submittedAt?: string | null;
  occurredAt?: string | null;
  externalSettlementId?: string | null;
  receipts: SettlementExecutionReceipt[];
}

export interface Settlement {
  resourceType: "settlement";
  settlementId: string;
  merchantId: string;
  channelId?: string | null;
  currency: string;
  scopeId?: string | null;
  status: string;
  finality: Finality;
  grossAmount?: Money;
  refundAmount?: Money;
  feeAmount?: Money;
  adjustmentAmount?: Money;
  netAmount?: Money;
  periodStart?: string | null;
  periodEnd?: string | null;
  businessTimezone?: string | null;
  version?: number | null;
  blockerSummary?: string | null;
  predecessorSettlementId?: string | null;
  replacementSettlementId?: string | null;
  items: SettlementItem[];
  executions: SettlementExecution[];
  reviewIds: string[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface ManualReviewDisposition {
  outcome: string;
  actorId?: string | null;
  actorRole?: string | null;
  reason: string;
  evidenceRefs: EvidenceRef[];
  recordedAt?: string | null;
}

export interface ManualReviewItem {
  resourceType: "manualReview";
  reviewId: string;
  merchantId?: string | null;
  type: string;
  status: string;
  finality: Finality;
  summary?: string | null;
  relatedResources: ResourceRef[];
  blockingScopes: string[];
  evidenceRefs: EvidenceRef[];
  createdAt?: string | null;
  resolvedAt?: string | null;
  dispositions: ManualReviewDisposition[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface NotificationAttempt {
  attemptId?: string | null;
  status: string;
  attemptedAt?: string | null;
  diagnostic?: string | null;
}

export interface MerchantNotification {
  notificationId: string;
  contentIdentity?: string | null;
  merchantId?: string | null;
  resource?: ResourceRef | null;
  status: string;
  attempts: NotificationAttempt[];
  createdAt?: string | null;
  source: SourceMetadata;
}

export interface TimelineEntry {
  eventId: string;
  category: string;
  occurredAt?: string | null;
  recordedAt: string;
  relatedResourceRefs: ResourceRef[];
  outcome?: string | null;
  actorId?: string | null;
  reason?: string | null;
  evidenceRefs: EvidenceRef[];
  money?: Money;
  summary?: string | null;
}

export interface PaymentTimeline {
  paymentId: string;
  entries: TimelineEntry[];
  nextCursor?: string | null;
  pageSize?: number;
  source: SourceMetadata;
}

export interface PageFilters {
  merchantId?: string;
  status?: string;
  finality?: Finality;
  resourceId?: string;
  paymentId?: string;
  merchantOrderId?: string;
  merchantRefundId?: string;
  channelId?: string;
  currency?: string;
  billId?: string;
  billRevision?: number;
  businessDate?: string;
  period?: string;
  executionStatus?: string;
  type?: string;
  relatedResourceId?: string;
  blockingScope?: string;
  createdFrom?: string;
  createdTo?: string;
  effectiveRun?: boolean;
}

export interface PageRequest {
  filters?: PageFilters;
  cursor?: string;
  pageSize?: number;
}

export interface PageResult<T> {
  items: T[];
  nextCursor?: string | null;
  pageSize: number;
}

export interface HealthStatus {
  status: "connected" | "degraded" | "unreachable";
  checkedAt: string;
  message: string;
  source: SourceMetadata;
}

export interface CreatePaymentInput {
  merchantId: string;
  merchantOrderId: string;
  idempotencyKey: string;
  money: Money;
  paymentMethod: string;
  expiresAt?: string;
  fixtureId?: string;
}

export interface CreateAttemptInput {
  resourceId: string;
  idempotencyKey: string;
  attemptId?: string;
  paymentMethod?: string;
  riskReason?: string;
  fixtureId?: string;
}

export interface SubmitAttemptInput {
  resourceId: string;
  attemptId: string;
  idempotencyKey: string;
  submissionId?: string;
}

export interface ChannelResultInput {
  resourceType: "PAYMENT" | "REFUND" | "SETTLEMENT";
  resourceId: string;
  attemptId: string;
  channelId: string;
  resultIdentity: string;
  externalTransactionId: string;
  money: Money;
  outcome: ChannelOutcome;
  occurredAt: string;
  rawPayload?: string;
  failureDisposition?: string;
  fixtureId?: string;
  executionGroupIdentity?: string;
  requestIdentity?: string;
}

export interface RequestRefundInput {
  merchantId: string;
  paymentId: string;
  merchantRefundId: string;
  idempotencyKey: string;
  money: Money;
  reason: string;
  requestedAt?: string;
  fixtureId?: string;
}

export interface ResponsibilityInput {
  merchantId: string;
  idempotencyKey: string;
  actorAlias?: string;
  actorId?: string;
  actorRole?: string;
  reason: string;
  evidenceRefs: string[];
}

export interface RegisterBillInput {
  billId: string;
  revision: number;
  channelId: string;
  merchantId: string;
  currency: string;
  businessDate: string;
  businessTimezone: string;
  idempotencyKey: string;
  fixtureId?: string;
  /** First-send timestamp retained by the publisher for safe retries. */
  publishedAt?: string;
  /** Reference provider script: reject this many reads before the revision becomes readable. */
  unavailableReadCount?: number;
  records: BillRecord[];
}

export interface ReconciliationScopeInput {
  channelId: string;
  currency: string;
  businessDate: string;
  businessTimezone: string;
}

export interface SignalBillAvailableInput extends ReconciliationScopeInput {
  merchantId: string;
  billId: string;
  revision: number;
  signalIdentity: string;
  idempotencyKey: string;
  publishedAt?: string;
}

export interface RunReconciliationInput extends ReconciliationScopeInput {
  merchantId: string;
  billId: string;
  revision: number;
  idempotencyKey: string;
  runId?: string;
  publishedAt?: string;
}

export interface ReconciliationDecisionInput extends ResponsibilityInput {
  runId: string;
  differenceId: string;
  revision: number;
  /** Backend-neutral operator conclusion; adapters own source enum names. */
  conclusion: "ACCEPT_DIFFERENCE" | "ESCALATE" | "CONFIRM_PLATFORM_FACT";
  /** Backend-neutral settlement decision; adapters own source enum names. */
  settlementImpact: "ALLOW" | "BLOCK" | "CONFIRM";
  outcome?: string;
  confirmation?: Record<string, unknown>;
}

export interface PrepareSettlementInput {
  merchantId: string;
  currency: string;
  channelId?: string;
  periodStart: string;
  periodEnd: string;
  businessTimezone: string;
  idempotencyKey: string;
  settlementId?: string;
  fixtureId?: string;
}

export interface SettlementResultInput extends ChannelResultInput {
  resourceType: "SETTLEMENT";
}

export interface ResolveManualReviewInput extends ResponsibilityInput {
  reviewId: string;
  reviewType?: string;
  outcome: string;
  remediationReference?: string;
  channelId?: string;
}

export interface ReferencePolicy {
  businessTimezone: string;
  enabledCurrencies: string[];
  paymentExpiry: string;
  unknownResultReviewAfter: string;
  operationPollRetryAfterMs: number;
  operationObservationTimeout: string;
  refundWindow: string;
  maxRefundAttempts: number;
  billReadMaxAttempts: number;
  billReadBackoff: string;
  feeRate: string;
  roundingMode: string;
  merchantNotificationMaxAttempts: number;
  negativeSettlementPolicy: string;
  largeRefundReviewThreshold?: Money | null;
  defaultPageSize: number;
  maxPageSize: number;
}

export interface ReferenceEnvironment {
  fixtureId: string;
  /** Legacy/default alias for simple displays; commands should select by responsibility kind. */
  actorAlias: string;
  actorAliases?: {
    paymentReviewer: string;
    refundReviewer: string;
    reconciliationOperator: string;
    settlementOperator: string;
    settlementReviewer: string;
  };
  currentTime?: string | null;
  policy?: Partial<ReferencePolicy>;
  channelId: string;
  merchantId: string;
  paymentMethod?: string;
}

/** Selectors and outcomes are business concepts; each adapter chooses the wire binding. */
export interface PaymentChannelScriptInput {
  fixtureId: string;
  channelId: string;
  outcome: "ACCEPT_THEN_SUCCESS" | "ACCEPT_THEN_FAILURE" | "ACCEPT_THEN_UNKNOWN" | "REJECT_ON_SUBMIT" | "NO_RESULT" | "SUCCESS" | "FAILURE" | "UNKNOWN";
  payload?: Record<string, unknown>;
}

export interface BillProviderScriptInput {
  fixtureId: string;
  billId: string;
  revision: number;
  unavailableReadCount: number;
}

export interface NotificationSenderScriptInput {
  fixtureId: string;
  notificationId?: string;
  sourceKind?: string;
  sourceFactId?: string;
  outcome: "SUCCESS" | "FAILURE" | "RESULT_UNKNOWN";
}

export interface SettlementExecutorScriptInput {
  fixtureId: string;
  /** WOW selects by channel; CAP4K selects by execution. Both may travel together. */
  channelId: string;
  executionId: string;
  outcome: "SUCCESS" | "FAILURE" | "UNKNOWN" | "NO_RESULT";
}

export type BusinessCommand =
  | { type: "CREATE_PAYMENT"; input: CreatePaymentInput }
  | { type: "CREATE_PAYMENT_ATTEMPT"; input: CreateAttemptInput }
  | { type: "SUBMIT_PAYMENT_ATTEMPT"; input: SubmitAttemptInput }
  | { type: "RECEIVE_PAYMENT_RESULT"; input: ChannelResultInput }
  | { type: "CLOSE_EXPIRED_PAYMENT"; input: { paymentId: string } }
  | { type: "REQUEST_REFUND"; input: RequestRefundInput }
  | { type: "CREATE_REFUND_ATTEMPT"; input: CreateAttemptInput }
  | { type: "SUBMIT_REFUND_ATTEMPT"; input: SubmitAttemptInput }
  | { type: "RECEIVE_REFUND_RESULT"; input: ChannelResultInput }
  | { type: "SIGNAL_BILL_AVAILABLE"; input: SignalBillAvailableInput }
  | { type: "RUN_RECONCILIATION"; input: RunReconciliationInput }
  | { type: "RERUN_RECONCILIATION"; input: RunReconciliationInput & { runId: string } }
  | { type: "DISPOSE_RECONCILIATION_DIFFERENCE"; input: ReconciliationDecisionInput }
  | { type: "CONFIRM_RECONCILIATION_FACT"; input: ReconciliationDecisionInput }
  | { type: "COMPLETE_RECONCILIATION"; input: ResponsibilityInput & { runId: string } }
  | { type: "PREPARE_SETTLEMENT"; input: PrepareSettlementInput }
  | { type: "CONFIRM_SETTLEMENT"; input: ResponsibilityInput & { settlementId: string } }
  | { type: "EXECUTE_SETTLEMENT"; input: { settlementId: string; merchantId: string; executionId: string; channelId: string; idempotencyKey: string; reviewAfterMinutes?: number } }
  | { type: "RECEIVE_SETTLEMENT_RESULT"; input: SettlementResultInput }
  | { type: "VOID_SETTLEMENT"; input: ResponsibilityInput & { settlementId: string } }
  | { type: "CREATE_SETTLEMENT_REPLACEMENT"; input: ResponsibilityInput & { settlementId: string; replacementSettlementId?: string } }
  | { type: "RESOLVE_MANUAL_REVIEW"; input: ResolveManualReviewInput }
  | { type: "RETRY_NOTIFICATION"; input: { notificationId: string; merchantId: string; idempotencyKey: string; fixtureId?: string } };

export type ReferenceCommand =
  | { type: "REGISTER_ENVIRONMENT"; input: ReferenceEnvironment }
  | { type: "SET_CLOCK"; input: { fixtureId: string; instant: string } }
  | { type: "ADVANCE_CLOCK"; input: { fixtureId: string; duration: string } }
  | { type: "CONFIGURE_CHANNEL"; input: PaymentChannelScriptInput }
  | { type: "READ_CHANNEL_SCRIPT" | "RESET_CHANNEL_SCRIPT"; input: Pick<PaymentChannelScriptInput, "fixtureId" | "channelId"> }
  | { type: "CONFIGURE_BILL_PROVIDER"; input: BillProviderScriptInput }
  | { type: "READ_BILL_PROVIDER_SCRIPT" | "RESET_BILL_PROVIDER_SCRIPT"; input: Pick<BillProviderScriptInput, "fixtureId" | "billId" | "revision"> }
  | { type: "CONFIGURE_NOTIFICATION_SENDER"; input: NotificationSenderScriptInput }
  | { type: "READ_NOTIFICATION_SENDER_SCRIPT" | "RESET_NOTIFICATION_SENDER_SCRIPT"; input: Omit<NotificationSenderScriptInput, "outcome"> }
  | { type: "CONFIGURE_SETTLEMENT_EXECUTOR"; input: SettlementExecutorScriptInput }
  | { type: "READ_SETTLEMENT_EXECUTOR_SCRIPT" | "RESET_SETTLEMENT_EXECUTOR_SCRIPT"; input: Omit<SettlementExecutorScriptInput, "outcome"> }
  | { type: "REGISTER_BILL"; input: RegisterBillInput }
  | { type: "RUN_MAINTENANCE"; input: { fixtureId: string } };

export interface ReferenceCommandResult {
  effect: "applied" | "alternative" | "unavailable";
  summary: string;
  receipt?: OperationReceipt;
  data?: unknown;
}
