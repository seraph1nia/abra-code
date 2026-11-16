import { Schema } from "effect";
import { Count, PolicySchema, RoleSchema, ApprovalSchema } from "../contracts.ts";
import {
  AbsolutePath,
  Commit,
  Fingerprint,
  ExecutionId,
  IssueId,
  MessageId,
  RepositoryId,
  SessionId,
  Timestamp,
} from "../identities.ts";
import {
  WorkerEnvironmentSchema,
  ToolObservationSchema,
  digestText,
} from "../opencode/worker-environment.ts";

const reference = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["discovered", "declared", "unavailable"]),
});
export const WorkerContextSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  issue_id: IssueId,
  execution_id: ExecutionId,
  repository_id: RepositoryId,
  generation: Count,
  role: RoleSchema,
  session_id: SessionId,
  prompt_id: MessageId,
  workflow: PolicySchema,
  directory: AbsolutePath,
  base: Commit,
  policy: Schema.String,
  environment: WorkerEnvironmentSchema,
  guidance: Schema.Struct({ path: AbsolutePath, digest: Schema.String, content: Schema.String }),
  prompt: Schema.String,
  scope_reference: Schema.optional(Schema.String),
  scope_fingerprint: Schema.optional(Fingerprint),
  approvals: Schema.Array(ApprovalSchema),
  references: Schema.Array(reference),
  decisions: Schema.Array(Schema.Struct({ key: Schema.String, status: Schema.String })),
  at: Timestamp,
}).check(
  Schema.makeFilter(
    (context) =>
      context.guidance.digest === digestText(context.guidance.content) ||
      "Captured role guidance digest does not match its content",
  ),
);
export type WorkerContext = typeof WorkerContextSchema.Type;
export const ContextStatusSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  execution_id: ExecutionId,
  role: RoleSchema,
  generation: Count,
  directory: Schema.optional(AbsolutePath),
  context_id: Schema.optional(MessageId),
  stage: Schema.Literals(["preflight", "captured", "request", "blocked"]),
  blocker: Schema.optional(
    Schema.Struct({ code: Schema.String, message: Schema.String, clearing_action: Schema.String }),
  ),
  observation: Schema.optional(ToolObservationSchema),
  at: Timestamp,
});
export const WorkerContextSummarySchema = Schema.Struct({
  role: RoleSchema,
  provenance: Schema.Literals(["captured", "legacy_unavailable", "invalid"]),
  context_id: Schema.optional(MessageId),
  captured_at: Schema.optional(Timestamp),
  generation: Schema.optional(Count),
  policy: Schema.optional(Schema.String),
  directory: Schema.optional(AbsolutePath),
  scope_reference: Schema.optional(Schema.String),
  scope_fingerprint: Schema.optional(Fingerprint),
  selection: Schema.optional(
    Schema.Struct({
      agent: WorkerEnvironmentSchema.fields.agent,
      model: WorkerEnvironmentSchema.fields.model,
    }),
  ),
  references: Schema.Array(reference),
  skills: WorkerEnvironmentSchema.fields.skills,
  required_tools: WorkerEnvironmentSchema.fields.tools,
  decisions: Schema.Array(Schema.Struct({ key: Schema.String, status: Schema.String })),
  omitted: Count,
  current_inventory: Schema.Literal("not_observed"),
  native_context: Schema.Literal("not_captured"),
  status: Schema.optional(ContextStatusSchema),
});
