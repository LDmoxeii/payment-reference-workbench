import type {
  BackendProfile,
  CreatePaymentInput,
  CreateRefundInput,
  ExecuteActionInput,
  HealthStatus,
  OperationReceipt,
  PageRequest,
  PageResult,
  Payment,
  PaymentTrace,
  Reconciliation,
  Refund,
  Settlement,
  SubmitPaymentResultInput,
  SubmitRefundResultInput,
} from "../domain/models";

export interface PaymentBackendAdapter {
  readonly profile: BackendProfile;
  health(): Promise<HealthStatus>;
  createPayment(input: CreatePaymentInput): Promise<OperationReceipt>;
  getPayment(paymentId: string): Promise<Payment>;
  listPayments(request: PageRequest): Promise<PageResult<Payment>>;
  startPaymentAttempt(paymentId: string): Promise<OperationReceipt>;
  submitPaymentResult(input: SubmitPaymentResultInput): Promise<OperationReceipt>;
  expirePayment(paymentId: string): Promise<OperationReceipt>;
  createRefund(input: CreateRefundInput): Promise<OperationReceipt>;
  getRefund(refundId: string): Promise<Refund>;
  listRefunds(request: PageRequest): Promise<PageResult<Refund>>;
  submitRefundResult(input: SubmitRefundResultInput): Promise<OperationReceipt>;
  adjudicateRefund(refundId: string, payload: Record<string, unknown>): Promise<OperationReceipt>;
  getPaymentTrace(paymentId: string): Promise<PaymentTrace>;
  getReconciliation(batchId: string): Promise<Reconciliation>;
  getSettlement(settlementId: string): Promise<Settlement>;
  executeAction(input: ExecuteActionInput): Promise<OperationReceipt>;
}
