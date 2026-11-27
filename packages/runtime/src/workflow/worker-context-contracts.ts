import { Schema } from "effect";
import { Count, PolicySchema, RoleSchema, ApprovalSchema } from "@abracode/contracts/primitives";
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
} from "@abracode/contracts/identities";
import {
  WorkerEnvironmentSchema,
  ToolObservationSchema,
  digestText,
} from "../opencode/worker-environment.ts";
import { PreparedAgent, canonicalJson, digest } from "@abracode/agents/contracts";
export const contextDigest = (value: object) =>
  digest(
    canonicalJson(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "capture_digest")),
    ),
  );

const decisionReference = Schema.Struct({
  key: Schema.String,
  status: Schema.String,
  scope: Schema.optionalKey(Schema.String),
  generation: Schema.optionalKey(Count),
  basis: Schema.optionalKey(Schema.Literals(["current_generation", "accepted_contract"])),
});
const reference = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["discovered", "declared", "unavailable"]),
});
const WorkerContextV1 = Schema.Struct({
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
  decisions: Schema.Array(decisionReference),
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
const WorkerContextV2 = Schema.Struct({
  ...WorkerContextV1.fields,
  schema_version: Schema.Literal(2),
  guidance: Schema.Struct({ digest: Schema.String, content: Schema.String }),
  prepared: PreparedAgent,
  capture_digest: Schema.String,
}).check(
  Schema.makeFilter(
    (context) =>
      (context.guidance.digest === digestText(context.guidance.content) &&
        context.guidance.content === context.prepared.profile.system &&
        context.prepared.profile.role === context.role &&
        context.environment.agent === context.prepared.native_agent &&
        canonicalJson(context.environment.model) === canonicalJson(context.prepared.model) &&
        context.capture_digest === contextDigest(context)) ||
      "Prepared context identity or guidance does not match captured assignment",
  ),
);
export const WorkerContextSchema = Schema.Union([WorkerContextV1, WorkerContextV2]);
export const WorkerContextSummarySchema = Schema.Struct({
  role: RoleSchema,
  provenance: Schema.Literals(["captured", "legacy_unavailable", "invalid"]),
  context_id: Schema.optional(MessageId),
  captured_at: Schema.optional(Timestamp),
  generation: Schema.optional(Count),
  policy: Schema.optional(Schema.String),
  definition: Schema.optional(Schema.String),
  profile_revision: Schema.optional(Schema.String),
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
  decisions: Schema.Array(decisionReference),
  omitted: Count,
  current_inventory: Schema.Literal("not_observed"),
  native_context: Schema.Literal("not_captured"),
  status: Schema.optional(ContextStatusSchema),
});
