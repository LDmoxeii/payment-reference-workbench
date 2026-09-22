import type { Money } from "./money";

export type BackendId = "wow" | "cap4k";
export type CapabilityLevel = "full" | "partial" | "unavailable";
export type PaymentStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CLOSED" | "PENDING_CONFIRMATION";
export type RefundStatus = "REQUESTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "REJECTED" | "PENDING_CONFIRMATION";
export type AttemptStatus = "PROCESSING" | "SUCCEEDED" | "FAILED" | "PENDING_CONFIRMATION" | "UNKNOWN";
export type ChannelResult = "SUCCEEDED" | "FAILED" | "UNKNOWN";
export type ResourceType = "payment" | "refund" | "reconciliation" | "settlement";

export interface SourceMetadata {
  adapter: BackendId;
  sourceStatus?: string | null;
  sourceId?: string | null;
  sourceTime?: string | null;
  diagnostic?: string | null;
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface BusinessErrorShape {
  code: string;
  message: string;
  fields: FieldError[];
  httpStatus?: number;
  retryable: boolean;
  sourceCode?: string;
  sourceMessage?: string;
  diagnostic?: unknown;
}

export interface OperationReceipt {
  resourceType: ResourceType;
  resourceId: string;
  accepted: boolean;
  reused: boolean;
  sourceStatus?: string | null;
  refresh: "none" | "read_once" | "poll";
  diagnostic?: string | null;
  source: SourceMetadata;
}

export type ActionKind =
  | "START_PAYMENT_ATTEMPT"
  | "SUBMIT_PAYMENT_RESULT"
  | "EXPIRE_PAYMENT"
  | "ADJUDICATE_PAYMENT"
  | "CREATE_REFUND"
  | "SUBMIT_REFUND_RESULT"
  | "ADJUDICATE_REFUND"
  | "GET_PAYMENT_TRACE"
  | "RERUN_RECONCILIATION"
  | "DISPOSE_RECONCILIATION_DIFFERENCE"
  | "REGISTER_AUTHORITATIVE_STATEMENT"
  | "MARK_BILL_AVAILABLE"
  | "GENERATE_SETTLEMENT"
  | "REPLACE_SETTLEMENT"
  | "ADJUDICATE_SETTLEMENT"
  | "PREPARE_SETTLEMENT"
  | "CONFIRM_SETTLEMENT"
  | "START_SETTLEMENT_EXECUTION"
  | "SUBMIT_SETTLEMENT_RESULT"
  | "VOID_SETTLEMENT";

export interface ActionDescriptor {
  kind: ActionKind;
  label: string;
  executable: boolean;
  reason?: string;
  requiredFields?: string[];
  /** Backend-neutral UI defaults supplied by the adapter's action declaration. */
  defaultValues?: Record<string, string | boolean>;
  confirmation: "none" | "confirm" | "danger";
  refresh: "none" | "read_once" | "poll";
}

export interface CapabilityDeclaration {
  id: string;
  level: CapabilityLevel;
  reason?: string;
  actions?: ActionKind[];
}

export interface BackendProfile {
  id: BackendId;
  label: string;
  apiBaseUrl: string;
  referenceOnly: true;
  capabilities: CapabilityDeclaration[];
}

export interface PaymentAttempt {
  id: string;
  channel: string;
  requestIdentity?: string | null;
  status: AttemptStatus;
  initiatedAt?: string | null;
  channelTransactionId?: string | null;
  finalResult?: ChannelResult | null;
  receiptCount: number;
  receipts: ChannelReceipt[];
  source: SourceMetadata;
}

export interface ChannelReceipt {
  id: string;
  result?: ChannelResult | null;
  disposition?: string | null;
  accepted?: boolean | null;
  verified?: boolean | null;
  duplicate?: boolean | null;
  occurredAt?: string | null;
  summary?: string | null;
  source: SourceMetadata;
}

export interface RefundSummary {
  successful?: Money;
  reserved?: Money;
  refundable?: Money;
}

export interface Payment {
  id: string;
  merchantId: string;
  merchantOrderNo: string;
  idempotencyKey?: string | null;
  amount: Money;
  paymentMethod: string;
  status: PaymentStatus;
  createdAt?: string | null;
  expiresAt?: string | null;
  succeededAt?: string | null;
  closedAt?: string | null;
  channelTransactionId?: string | null;
  attempts: PaymentAttempt[];
  refundSummary: RefundSummary;
  reviewIds: string[];
  settlementEligible?: boolean | null;
  settlementBlocked?: boolean | null;
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface RefundAttempt {
  id: string;
  channel: string;
  requestIdentity?: string | null;
  status: AttemptStatus;
  initiatedAt?: string | null;
  channelRefundId?: string | null;
  finalResult?: ChannelResult | null;
  receiptCount: number;
  receipts: ChannelReceipt[];
  source: SourceMetadata;
}

export interface Refund {
  id: string;
  paymentId: string;
  merchantId: string;
  merchantRefundNo: string;
  amount: Money;
  paymentMethod?: string | null;
  status: RefundStatus;
  requestedAt?: string | null;
  finalizedAt?: string | null;
  channelRefundId?: string | null;
  reservationActive?: boolean | null;
  attempts: RefundAttempt[];
  reviewIds: string[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface ReconciliationItem {
  id: string;
  differenceType: string;
  transactionKind?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  amount?: Money;
  resolved?: boolean | null;
  settlementBlocked?: boolean | null;
  evidence?: string | null;
  source: SourceMetadata;
}

export interface Reconciliation {
  id: string;
  statementId?: string | null;
  channelId: string;
  currency: string;
  reconciliationDate?: string | null;
  businessTimezone?: string | null;
  status: string;
  revision?: string | number | null;
  settlementBlocked?: boolean | null;
  blockingReason?: string | null;
  items: ReconciliationItem[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface SettlementLine {
  id: string;
  sourceKind?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  reconciliationId?: string | null;
  grossAmount?: Money;
  feeAmount?: Money;
  signedNetAmount?: Money;
  source: SourceMetadata;
}

export interface Settlement {
  id: string;
  merchantId: string;
  channelId: string;
  currency: string;
  status: string;
  netAmount?: Money;
  paymentGrossAmount?: Money;
  refundGrossAmount?: Money;
  feeTotalAmount?: Money;
  adjustmentTotalAmount?: Money;
  periodStart?: string | null;
  periodEnd?: string | null;
  blockerSummary?: string | null;
  predecessorSettlementId?: string | null;
  replacementSettlementId?: string | null;
  lines: SettlementLine[];
  actions: ActionDescriptor[];
  source: SourceMetadata;
}

export interface PaymentTrace {
  payment: Payment;
  refunds: Refund[];
  reconciliations: Reconciliation[];
  settlements: Settlement[];
  notifications: Array<{ id: string; status?: string; diagnostic?: string | null }>;
  partial: boolean;
  source: SourceMetadata;
}

export interface PageRequest { page: number; pageSize: number; cursor?: string; }
export interface PageResult<T> { items: T[]; page: number; pageSize: number; total?: number; hasNext: boolean; nextCursor?: string; }

export interface RecentRecord {
  resourceType: ResourceType;
  id: string;
  label: string;
  accessedAt: string;
  backendId: BackendId;
  status?: string;
}

export interface HealthStatus {
  status: "connected" | "degraded" | "unreachable";
  checkedAt: string;
  message?: string;
  source: SourceMetadata;
}

export interface CreatePaymentInput {
  merchantId: string;
  merchantOrderNo: string;
  idempotencyKey: string;
  amount: Money;
  paymentMethod: string;
  expiresAt?: string;
}

export interface SubmitPaymentResultInput {
  paymentId: string;
  attemptId: string;
  notificationId: string;
  channel: string;
  channelTransactionId: string;
  amount: Money;
  result: ChannelResult;
  occurredAt?: string;
  verified?: boolean;
  verificationMaterial?: string;
}

export interface CreateRefundInput {
  paymentId: string;
  merchantId: string;
  merchantRefundNo: string;
  idempotencyKey?: string;
  amount: Money;
  reason?: string;
  requestedAt?: string;
  /** WOW's reference endpoint takes result during creation. */
  initialResult?: ChannelResult;
}

export interface SubmitRefundResultInput {
  refundId: string;
  attemptId: string;
  notificationId: string;
  channel: string;
  channelRefundId: string;
  amount: Money;
  result: ChannelResult;
  occurredAt?: string;
  verificationMaterial?: string;
}

export interface ExecuteActionInput {
  kind: ActionKind;
  resourceId?: string;
  /** Adapter-specific fields for real, publicly exposed operation endpoints. */
  payload?: Record<string, unknown>;
}
