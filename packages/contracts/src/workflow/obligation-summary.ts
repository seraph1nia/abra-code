import {
  ObligationKey,
  SessionId,
  FormId,
  ActivityId,
  IssueId,
  OperationId,
  ExecutionId,
} from "../identities.ts";
import { Schema } from "effect";
import { Count, NonEmpty, Positive } from "../primitives.ts";
const bounded = NonEmpty.check(Schema.isMaxLength(8192));
export const QuestionInputSchema = Schema.Struct({
  key: ObligationKey,
  generation: Count,
  scope: bounded,
  question: bounded,
  owner: Schema.Literals(["user", "supervisor"]),
});
export const DecisionSummarySchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  ...QuestionInputSchema.fields,
  session_id: Schema.Union([SessionId, Schema.Literal("controller")]),
  opened_at: Count,
  status: Schema.Literals(["open", "answered", "cancelled", "superseded"]),
  form_id: Schema.optional(FormId),
  form_session: Schema.optional(SessionId),
  answer: Schema.optional(bounded),
  resolved_at: Schema.optional(Count),
});
const waitFields = {
  key: ObligationKey,
  generation: Count,
  condition: bounded,
  owner: NonEmpty,
  expires_in_ms: Positive.check(Schema.isLessThanOrEqualTo(604800000)),
};
const dependency = { ...waitFields, kind: Schema.Literal("dependency"), reference: IssueId };
const user = { ...waitFields, kind: Schema.Literal("user"), reference: ObligationKey };
const command = { ...waitFields, kind: Schema.Literal("command"), reference: OperationId };
export const WaitInputSchema = Schema.Union([
  Schema.Struct(dependency),
  Schema.Struct(user),
  Schema.Struct(command),
]);
const retained = {
  schema_version: Schema.Literal(1),
  session_id: SessionId,
  started_at: Count,
  expires_at: Count,
  next_check_at: Count,
  status: Schema.Literals(["waiting", "cleared", "expired", "invalid", "superseded"]),
  evidence: Schema.optional(bounded),
};
export const DeclaredWaitSchema = Schema.Union([
  Schema.Struct({ ...dependency, ...retained }),
  Schema.Struct({ ...user, ...retained }),
  Schema.Struct({ ...command, ...retained }),
]);
export const ProgressSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  generation: Count,
  session_id: Schema.Union([SessionId, ExecutionId]),
  at: Count,
  summary: bounded,
  source: Schema.Literals(["worker", "native", "command"]),
  identity: Schema.optional(ActivityId),
});

/** Older browser snapshots omitted record versions and wait timing evidence.
 * Preserve those observations without fabricating missing native evidence. */
export const DecisionObservationSchema = Schema.Struct({
  ...DecisionSummarySchema.fields,
  schema_version: Schema.optional(DecisionSummarySchema.fields.schema_version),
});
export const ProgressObservationSchema = Schema.Struct({
  ...ProgressSchema.fields,
  schema_version: Schema.optional(ProgressSchema.fields.schema_version),
});
export const WaitObservationSchema = Schema.Union(
  DeclaredWaitSchema.members.map((member) =>
    Schema.Struct({
      ...member.fields,
      schema_version: Schema.optional(member.fields.schema_version),
      session_id: Schema.optional(member.fields.session_id),
      expires_in_ms: Schema.optional(member.fields.expires_in_ms),
      started_at: Schema.optional(member.fields.started_at),
      expires_at: Schema.optional(member.fields.expires_at),
      next_check_at: Schema.optional(member.fields.next_check_at),
    }),
  ),
);
