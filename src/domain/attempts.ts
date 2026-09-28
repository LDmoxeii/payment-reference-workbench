import type { ChannelOutcome, ChannelSubmissionReceipt } from "./models";

export function submittableAttempt<T extends { status: string; submissions: ChannelSubmissionReceipt[]; finalResult?: ChannelOutcome | null }>(attempt: T): boolean {
  return attempt.submissions.length === 0
    && !attempt.finalResult
    && !["ACCEPTED", "SUBMITTED", "FAILED", "REJECTED", "SUCCEEDED", "CANCELLED", "CLOSED"].includes(attempt.status);
}
