import {
  FindingId,
  IssueId,
  RoundId,
  Fingerprint,
  ChangeName,
  RelativePath,
  PullRequestUrl,
  SessionId,
} from "../identities.ts";
import { Schema } from "effect";
import { Count, Positive, NonEmpty, Commit, ApprovalSchema, RoleSchema } from "../contracts.ts";
export const ScopeDispositionSchema = Schema.Literals(["in_scope", "scope_change", "uncertain"]);
export const ForgeFindingSchema = Schema.Struct({
  id: FindingId,
  head: Commit,
  kind: Schema.Literals(["check", "review", "comment", "thread"]),
  text: NonEmpty.check(Schema.isMaxLength(8192)),
  url: Schema.optional(NonEmpty),
});
export const CorrectionInputSchema = Schema.Struct({
  issue_id: IssueId,
  expected_head: Commit,
  finding_ids: Schema.Array(FindingId).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  scope: ScopeDispositionSchema,
  instructions: NonEmpty.check(Schema.isMaxLength(8192)),
});
export const RoundSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  worker_sessions: Schema.optional(
    Schema.Array(Schema.Struct({ id: SessionId, role: RoleSchema })).check(Schema.isMaxLength(4)),
  ),
  id: RoundId,
  ordinal: Positive,
  generation: Count,
  source: Schema.Literals(["check", "review", "forge"]),
  starting_head: Commit,
  plan_fingerprint: Fingerprint,
  findings: Schema.Array(FindingId),
  instructions: NonEmpty,
  openspec_change: Schema.Union([ChangeName, Schema.Literal("")]),
  archive_path: Schema.optional(RelativePath),
  prior_delivered_commit: Schema.optional(Commit),
  pull_request_reference: Schema.optional(PullRequestUrl),
  approval_receipts: Schema.Array(ApprovalSchema),
  created_at: Count,
});
