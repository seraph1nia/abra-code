import { utf8Bytes } from "../utf8.ts";
import { Schema } from "effect";
import { Count, PolicySchema, Priority, WorkerModelSchema } from "../primitives.ts";
import {
  IssueId,
  LeadId,
  RepositoryId,
  RequestId,
  SessionId,
  Timestamp,
  Identifier,
} from "../identities.ts";
import {
  RequestSchema,
  MessageReplySchema,
  ResponseRecoverySchema,
} from "../workflow/message-contracts.ts";
import { BatchDependencySchema } from "../work/batch-dependency.ts";
import { WorkSummarySchema } from "./work-summary.ts";
export const LeadSummarySchema = Schema.Struct({
  id: LeadId,
  revision: Count,
  repositories: Schema.Array(RepositoryId),
  enabled: Schema.Boolean,
  session_available: Schema.Boolean,
  session_id: SessionId,
  parent_session_id: SessionId,
  state: Schema.Literals([
    "disabled",
    "stopping",
    "unavailable",
    "provisioning",
    "running",
    "queued",
    "idle",
    "unknown",
  ]),
  request_count: Count,
  outstanding_count: Count,
  requests: Schema.Array(
    Schema.Struct({
      issue_id: IssueId,
      request_id: RequestId,
      status: Schema.String,
      question: Schema.String,
      reply: Schema.optional(Schema.String),
    }),
  ),
  pending_proposals: Schema.Array(RequestId),
  assigned_work: Schema.Array(IssueId),
  latest_outcome: Schema.optional(Schema.String),
  observed_at: Timestamp,
});
export type LeadSummary = typeof LeadSummarySchema.Type;

const summary = LeadSummarySchema.fields;
export const LeadCompactSchema = Schema.Struct({
  id: summary.id,
  revision: summary.revision,
  repositories: summary.repositories,
  enabled: summary.enabled,
  state: summary.state,
  session_available: summary.session_available,
  session_id: summary.session_id,
  observed_at: summary.observed_at,
  model: WorkerModelSchema,
  request_count: summary.request_count,
  outstanding_count: summary.outstanding_count,
  proposal_count: Count,
  pending_proposal_count: Count,
  scope: Schema.Literals(["configured_repository", "retained_history"]),
});
const request = RequestSchema.fields;
export const LeadRequestObservationSchema = Schema.Struct({
  issue_id: IssueId,
  request_id: request.request_id,
  generation: request.generation,
  recipient_session_id: request.recipient_session_id,
  body: request.body,
  response: request.response,
  source: request.source,
  status: request.status,
  created_at: request.created_at,
  acknowledged_at: request.acknowledged_at,
  reply: Schema.optional(MessageReplySchema),
  recovery: Schema.optional(ResponseRecoverySchema.fields.status),
});
export const LeadProposalObservationSchema = Schema.Struct({
  request_id: RequestId,
  revision: Count,
  accepted: Schema.Boolean,
  tasks: Schema.Array(
    Schema.Struct({
      key: Identifier,
      title: WorkSummarySchema.fields.title,
      description: Schema.String,
      repository_id: RepositoryId,
      policy: Schema.optional(PolicySchema),
      priority: Schema.optional(Priority),
      dependencies: Schema.Array(BatchDependencySchema),
      accepted_issue_id: Schema.optional(IssueId),
      limited: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(32)),
});
export const LeadEvidenceQuery = Schema.Struct({
  issue_id: Schema.optional(IssueId),
  repository_id: Schema.optional(RepositoryId),
  lead_id: Schema.optional(LeadId),
  offset: Schema.optional(Count),
  request_offset: Schema.optional(Count),
  proposal_offset: Schema.optional(Count),
}).check(
  Schema.makeFilter(
    (query) =>
      !!query.issue_id !== !!query.repository_id ||
      "Select exactly one task or registered repository",
  ),
);
export const LeadEvidencePageSchema = Schema.Struct({
  issue_id: Schema.optional(IssueId),
  repository_id: RepositoryId,
  observed_at: Timestamp,
  entries: Schema.Array(LeadCompactSchema).check(Schema.isMaxLength(20)),
  total: Count,
  offset: Count,
  next_offset: Schema.optional(Count),
  diagnostics: Schema.Array(Schema.String),
  detail: Schema.optional(
    Schema.Struct({
      lead_id: LeadId,
      retired_sessions: Schema.Array(SessionId),
      requests: Schema.Array(LeadRequestObservationSchema).check(Schema.isMaxLength(20)),
      request_limit: Schema.Literal(10),
      request_total: Count,
      request_offset: Count,
      request_next: Schema.optional(Count),
      proposals: Schema.Array(LeadProposalObservationSchema).check(Schema.isMaxLength(5)),
      proposal_total: Count,
      proposal_offset: Count,
      proposal_next: Schema.optional(Count),
      related_work: Schema.Array(
        Schema.Struct({
          issue_id: IssueId,
          title: WorkSummarySchema.fields.title,
          issue_status: WorkSummarySchema.fields.issue_status,
        }),
      ).check(Schema.isMaxLength(50)),
      related_total: Count,
    }),
  ),
}).check(
  Schema.makeFilter(
    (page) => utf8Bytes(JSON.stringify(page)) <= 1024 * 1024 || "Lead evidence exceeds 1 MiB",
  ),
);

export const LeadAttentionSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      lead_id: LeadId,
      repository_id: RepositoryId,
      state: LeadSummarySchema.fields.state,
      unanswered: Count,
      proposals: Count,
    }),
  ).check(Schema.isMaxLength(20)),
  total: Count,
  truncated: Schema.Boolean,
  diagnostic_count: Count,
});
