import { FeedbackBatchSchema } from "./feedback-contracts.ts";
import { IncidentId, SessionId, MessageId, OperationId } from "../identities.ts";
import { Schema } from "effect";
import { Count, NonEmpty, Positive } from "../contracts.ts";
export const AttentionSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  batch: Schema.optional(FeedbackBatchSchema),
  id: IncidentId,
  observed_operation: Schema.optional(OperationId),
  observed_session: Schema.optional(SessionId),
  observed_prompt: Schema.optional(MessageId),
  generation: Count,
  key: NonEmpty,
  code: Schema.Literals([
    "decision_pending",
    "pr_feedback",
    "suspected_stall",
    "wait_expired",
    "wait_invalid",
    "worker_failure",
    "operation_stall",
    "cleanup_blocked",
  ]),
  evidence: NonEmpty.check(Schema.isMaxLength(8192)),
  created_at: Count,
  status: Schema.Literals([
    "pending",
    "uncertain",
    "admitted",
    "unavailable",
    "exhausted",
    "handled",
    "user_needed",
    "superseded",
  ]),
  session_id: Schema.optional(SessionId),
  prompt_id: Schema.optional(MessageId),
  attempts: Count,
  delivered_at: Schema.optional(Count),
  disposition: Schema.optional(NonEmpty),
});
export const WatchdogPolicySchema = Schema.Struct({
  explore: Positive,
  apply: Positive,
  review: Positive,
  research: Positive,
  operation: Positive,
});
export type Attention = typeof AttentionSchema.Type;
