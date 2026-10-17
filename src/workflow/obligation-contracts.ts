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
import { Count, NonEmpty, Positive } from "../contracts.ts";
import { FinishingTargetSchema, FinishingAnswerSchema } from "./finishing-contracts.ts";
const bounded = NonEmpty.check(Schema.isMaxLength(8192));
export const QuestionInputSchema = Schema.Struct({
  key: ObligationKey,
  generation: Count,
  scope: bounded,
  question: bounded,
  owner: Schema.Literals(["user", "supervisor"]),
});
export const DecisionSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  ...QuestionInputSchema.fields,
  session_id: Schema.Union([SessionId, Schema.Literal("controller")]),
  opened_at: Count,
  status: Schema.Literals(["open", "answered", "cancelled", "superseded"]),
  form_id: Schema.optional(FormId),
  form_session: Schema.optional(SessionId),
  answer: Schema.optional(bounded),
  resolved_at: Schema.optional(Count),
  finishing_target: Schema.optional(FinishingTargetSchema),
  finishing_answer: Schema.optional(FinishingAnswerSchema),
  finishing_history: Schema.optional(
    Schema.Array(
      Schema.Struct({
        form_id: FormId,
        form_session: SessionId,
        target: FinishingTargetSchema,
        answer: Schema.optional(FinishingAnswerSchema),
        resolved_at: Count,
      }),
    ).check(Schema.isMaxLength(64)),
  ),
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
export type Decision = typeof DecisionSchema.Type;
export type DeclaredWait = typeof DeclaredWaitSchema.Type;
