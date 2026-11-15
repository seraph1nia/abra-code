import { Schema } from "effect";
import { IssueId, SessionId, RepositoryId, RelativePath, Timestamp } from "../identities.ts";
import { RoleSchema, PhaseSchema, Priority, PolicySchema } from "../contracts.ts";

/** Browser projections deliberately contain data only, without controller/adaptor imports. */
const strings = Schema.Array(Schema.String);
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const DecisionSchema = Schema.Struct({
  key: Schema.String,
  generation: count,
  scope: Schema.String,
  question: Schema.String,
  owner: Schema.Literals(["user", "supervisor"]),
  status: Schema.Literals(["open", "answered", "cancelled", "superseded"]),
  session_id: Schema.String,
  opened_at: Schema.Finite,
  answer: Schema.optional(Schema.String),
  form_id: Schema.optional(Schema.String),
  form_session: Schema.optional(Schema.String),
  resolved_at: Schema.optional(Schema.Finite),
});
export const DeclaredWaitSchema = Schema.Struct({
  key: Schema.String,
  generation: count,
  condition: Schema.String,
  owner: Schema.String,
  kind: Schema.String,
  reference: Schema.String,
  status: Schema.String,
});
export const WorkItemSchema = Schema.Struct({
  issue_id: IssueId,
  title: Schema.String,
  repository_id: Schema.optional(RepositoryId),
  priority: Priority,
  issue_status: Schema.Literals(["open", "in_progress", "blocked", "closed", "unavailable"]),
  phase: Schema.optional(PhaseSchema),
  active_role: Schema.optional(RoleSchema),
  generation: Schema.optional(count),
  policy: Schema.optional(PolicySchema),
  sessions: Schema.Array(Schema.Struct({ id: SessionId, role: RoleSchema })),
  eligible: Schema.Boolean,
  blockers: strings,
  error: Schema.optional(Schema.String),
  decisions: Schema.optional(Schema.Array(DecisionSchema)),
  waits: Schema.optional(Schema.Array(DeclaredWaitSchema)),
  progress: Schema.optional(
    Schema.Struct({
      summary: Schema.String,
      at: Schema.Finite,
      source: Schema.String,
      generation: count,
      session_id: Schema.String,
    }),
  ),
  attention: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        summary: Schema.optional(Schema.String),
      }),
    ),
  ),
  supervisor_session_id: Schema.optional(SessionId),
  closed_at: Schema.optional(Timestamp),
  decision_count: Schema.optional(count),
  wait_count: Schema.optional(count),
  communication: Schema.optional(Schema.Struct({ total: count, outstanding: count })),
});
export type WebWorkItem = typeof WorkItemSchema.Type;
export const WorkSnapshotSchema = Schema.Struct({
  home: Schema.String,
  at: Timestamp,
  work: Schema.Array(WorkItemSchema),
  closed_total: Schema.optional(count),
  closed_page: Schema.optional(count),
});
export const WorkDetailSchema = Schema.Struct({
  work: WorkItemSchema,
  description: Schema.String,
  change: Schema.optional(Schema.String),
  archive: Schema.optional(RelativePath),
  artifacts: Schema.Array(
    Schema.Struct({ id: Schema.String, status: Schema.String, path: RelativePath }),
  ),
  proposal: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.Array(RelativePath)),
  errors: strings,
  progress: Schema.optional(Schema.Struct({ total: count, complete: count, remaining: count })),
});
export const WorkDiffSchema = Schema.Struct({
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  at: Timestamp,
  historical: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      path: RelativePath,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: count,
      deletions: count,
      binary: Schema.Boolean,
      limited: Schema.Boolean,
    }),
  ),
  file: Schema.optional(RelativePath),
  patch: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  limited: Schema.Boolean,
});
export const WorkDocumentSchema = Schema.Struct({ path: Schema.String, content: Schema.String });
export const WorkReportSchema = Schema.Struct({ content: Schema.String });
export const WorkerInspectionSchema = Schema.Struct({
  id: SessionId,
  role: RoleSchema,
  busy: Schema.Boolean,
  executing: Schema.optional(Schema.Boolean),
  native_activity: Schema.String,
  outcome: Schema.optional(Schema.String),
  observed_at: Timestamp,
  note: Schema.String,
  recent_messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        at: Schema.optional(Schema.Finite),
        text: Schema.optional(Schema.String),
        tools: Schema.optional(
          Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
        ),
      }),
    ),
  ),
});
export const MessagesPageSchema = Schema.Struct({
  entries: Schema.Array(Schema.Json).check(Schema.isMaxLength(50)),
  total: count,
  outstanding: count,
  offset: count,
  limit: count,
  next_offset: Schema.optional(count),
  observed_at: Timestamp,
});
export const FeedbackPageSchema = Schema.Struct({
  issue_id: IssueId,
  generation: count,
  head: Schema.optional(Schema.String),
  page: count,
  page_size: Schema.Literal(20),
  external_validation: Schema.optional(Schema.Json),
  external_gate_digest: Schema.optional(Schema.String),
  external_history: Schema.Array(Schema.Json),
  external_history_total: count,
  observation: Schema.optional(Schema.Json),
  findings: Schema.Array(Schema.Json),
  history: Schema.Array(Schema.Json),
  actions: Schema.Array(Schema.Json),
  finding_total: count,
  history_total: count,
  action_total: count,
});

export const ArtifactSummarySchema = Schema.Struct({
  request_id: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.String,
  generation: count,
  hash: Schema.optional(Schema.String),
  bytes: Schema.optional(count),
  error: Schema.optional(Schema.String),
});
export const ArtifactsSchema = Schema.Struct({ artifacts: Schema.Array(ArtifactSummarySchema) });
export const ArtifactSchema = Schema.Struct({
  html: Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)),
  hash: Schema.String,
  bytes: count,
});
