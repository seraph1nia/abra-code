import { Count } from "../primitives.ts";
import { Schema } from "effect";
import { ExecutionContractSchema } from "./execution-contract.ts";
import { IssueId, SessionId, RepositoryId, Timestamp } from "../identities.ts";
import { RoleSchema, PhaseSchema, Priority, PolicySchema } from "../primitives.ts";
import {
  DecisionObservationSchema as DecisionSchema,
  WaitObservationSchema as DeclaredWaitSchema,
  ProgressObservationSchema as ProgressSchema,
} from "../workflow/obligation-summary.ts";
import { AttentionSchema } from "../workflow/attention-contracts.ts";
import { SupervisionSummarySchema } from "./supervision.ts";
import { DeliveryOutcomeSchema } from "../workflow/delivery-contracts.ts";
import { DeliveryWaitSchema } from "../workflow/operation-contracts.ts";
const strings = Schema.Array(Schema.String);
/** Bounded observation data; full native/controller records remain with their owners. */
export const WorkSummarySchema = Schema.Struct({
  issue_id: IssueId,
  title: Schema.String,
  repository_id: Schema.optional(RepositoryId),
  priority: Priority,
  issue_status: Schema.Literals(["open", "in_progress", "blocked", "closed", "unavailable"]),
  phase: Schema.optional(PhaseSchema),
  active_role: Schema.optional(RoleSchema),
  generation: Schema.optional(Count),
  policy: Schema.optional(PolicySchema),
  execution_contract: Schema.optional(ExecutionContractSchema),
  sessions: Schema.Array(Schema.Struct({ id: SessionId, role: RoleSchema })),
  eligible: Schema.Boolean,
  /** False means this resource did not perform the separate complete admission check. */
  eligibility_observed: Schema.optional(Schema.Boolean),
  blockers: strings,
  dependencies: Schema.optional(Schema.Array(IssueId).check(Schema.isMaxLength(256))),
  dependency_count: Schema.optional(Count),
  error: Schema.optional(Schema.String),
  decisions: Schema.optional(Schema.Array(DecisionSchema)),
  waits: Schema.optional(Schema.Array(DeclaredWaitSchema)),
  progress: Schema.optional(ProgressSchema),
  attention: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: AttentionSchema.fields.id,
        status: AttentionSchema.fields.status,
        generation: Schema.optional(AttentionSchema.fields.generation),
        code: Schema.optional(AttentionSchema.fields.code),
        evidence: Schema.optional(AttentionSchema.fields.evidence),
        summary: Schema.optional(Schema.String),
      }),
    ),
  ),
  supervision: Schema.optional(SupervisionSummarySchema),
  outcome: Schema.optional(DeliveryOutcomeSchema),
  delivery_wait: Schema.optional(DeliveryWaitSchema),
  capacity_wait: Schema.optional(
    Schema.Struct({
      role: RoleSchema,
      reasons: strings,
      consuming: Schema.Array(IssueId),
      next_check_at: Schema.Int,
    }),
  ),
  supervisor_session_id: Schema.optional(SessionId),
  closed_at: Schema.optional(Timestamp),
  decision_count: Schema.optional(Count),
  wait_count: Schema.optional(Count),
  communication: Schema.optional(Schema.Struct({ total: Count, outstanding: Count })),
});
export type WorkSummary = typeof WorkSummarySchema.Type;
