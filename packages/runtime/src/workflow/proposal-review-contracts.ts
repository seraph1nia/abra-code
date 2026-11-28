import { Count, Positive } from "@abracode/contracts/primitives";
import type { Execution } from "../domain.ts";
import { ReaderReport, ReviewStatus } from "@abracode/contracts/visibility/proposal-review";
export { ReaderReport };
import { Schema } from "effect";
import { Fingerprint, MessageId, SessionId } from "@abracode/contracts/identities";

export const ReviewRevision = Schema.Struct({
  fingerprint: Fingerprint,
  path: Schema.String,
  proposal: Schema.String,
  session: SessionId,
  prompt: MessageId,
  planner_notice: MessageId,
  planner_notified: Schema.optional(Schema.Boolean),
  status: ReviewStatus,
  reason: Schema.optional(Schema.String),
  report: Schema.optional(ReaderReport),
  reuse_session_on_retry: Schema.optional(Schema.Boolean),
  started_at: Schema.optional(Count),
  attempt: Positive,
});
export type ReviewRevision = typeof ReviewRevision.Type;
export const reviewQuestion =
  "What goal, boundaries and observable success do you infer from this proposal? Which material assumptions or decisions need attention?";
export const readerPrompt = (review: Pick<ReviewRevision, "path" | "proposal">) =>
  reviewQuestion + "\n\n" + JSON.stringify({ path: review.path, proposal: review.proposal });

export function currentReview(e: {
  plan_fingerprint?: Fingerprint;
  proposal_reviews?: readonly ReviewRevision[];
}) {
  return e.proposal_reviews?.find((r) => r.fingerprint === e.plan_fingerprint);
}

export function reviewAnswers(e: Execution, prefix: string) {
  return (
    e.decisions?.filter(
      (d) =>
        d.generation === e.control_generation &&
        d.proposal_fingerprint === e.plan_fingerprint &&
        d.session_id === "controller" &&
        d.key.startsWith(prefix),
    ) ?? []
  );
}
export const scopeKey = (r: ReviewRevision, index: number) => `reader-${r.fingerprint}-q${index}-`;
export function reviewSatisfied(e: Execution) {
  if (!e.proposal_review) return true;
  const r = currentReview(e);
  return (
    r?.status === "continued" ||
    (r?.status === "completed" &&
      !!r.report &&
      r.report.findings.every((f, i) =>
        f.owner === "planner" ? r.planner_notified : scopeAnswered(e, r, i),
      ))
  );
}

export function scopeAnswered(e: Execution, r: ReviewRevision, index: number) {
  return (
    e.decisions?.some(
      (d) =>
        d.proposal_fingerprint === r.fingerprint &&
        d.session_id === "controller" &&
        d.key.startsWith(scopeKey(r, index)) &&
        d.status === "answered",
    ) ?? false
  );
}
