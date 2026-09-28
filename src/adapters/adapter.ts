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

/**
 * The only backend boundary visible to services and UI. Implementations own every
 * transport-specific path, method, header, envelope and convergence decision.
 */
export interface PaymentBackendAdapter {
  readonly profile: BackendProfile;

  health(): Promise<HealthStatus>;
  getReferenceEnvironment(fixtureId?: string): Promise<ReferenceEnvironment>;
  executeReference(command: ReferenceCommand): Promise<ReferenceCommandResult>;

  execute(command: BusinessCommand): Promise<OperationReceipt>;
  getOperation(operationId: string): Promise<Operation>;

  getPayment(paymentId: string): Promise<Payment>;
  listPayments(request: PageRequest): Promise<PageResult<Payment>>;
  getRefund(refundId: string): Promise<Refund>;
  listRefunds(request: PageRequest): Promise<PageResult<Refund>>;

  getBill(billId: string): Promise<AuthoritativeBill>;
  getReconciliationRun(runId: string): Promise<ReconciliationRun>;
  listReconciliationRuns(request: PageRequest): Promise<PageResult<ReconciliationRun>>;

  getSettlement(settlementId: string): Promise<Settlement>;
  listSettlements(request: PageRequest): Promise<PageResult<Settlement>>;

  getManualReview(reviewId: string): Promise<ManualReviewItem>;
  listManualReviews(request: PageRequest): Promise<PageResult<ManualReviewItem>>;

  getNotification(notificationId: string): Promise<MerchantNotification>;
  listNotifications(request: PageRequest): Promise<PageResult<MerchantNotification>>;
  getPaymentTimeline(paymentId: string, request?: PageRequest): Promise<PaymentTimeline>;
}
