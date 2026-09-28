import type { ApiErrorShape, FieldError } from "./models";

export class BusinessError extends Error implements ApiErrorShape {
  readonly code: string;
  readonly fields: FieldError[];
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly sourceCode?: string;
  readonly sourceMessage?: string;
  readonly diagnostic?: unknown;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = "BusinessError";
    this.code = shape.code;
    this.fields = shape.fields;
    this.httpStatus = shape.httpStatus;
    this.retryable = shape.retryable;
    this.sourceCode = shape.sourceCode;
    this.sourceMessage = shape.sourceMessage;
    this.diagnostic = shape.diagnostic;
    this.details = shape.details;
    this.correlationId = shape.correlationId;
  }
}

export function capabilityUnavailable(message: string): BusinessError {
  return new BusinessError({
    code: "CAPABILITY_UNAVAILABLE",
    message,
    fields: [],
    retryable: false,
  });
}
