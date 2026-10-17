import { ExternalRecord } from "../validation/contracts.ts";
import { Schema } from "effect";
import { Commit, Count, NonEmpty, Positive } from "../contracts.ts";
import { BranchName, FindingId, IssueId, PullRequestUrl, ObligationKey } from "../identities.ts";

const text = NonEmpty.check(Schema.isMaxLength(8192));
export const FeedbackDisposition = Schema.Literals([
  "unclassified",
  "informational",
  "in_scope",
  "uncertain",
  "scope_change",
  "addressed",
  "superseded",
  "dismissed",
  "transient",
]);
export const FindingSchema = Schema.Struct({
  id: FindingId,
  source_id: NonEmpty,
  revision: NonEmpty,
  head: Commit,
  original_head: Schema.optional(Commit),
  review_state: Schema.optional(
    Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]),
  ),
  kind: Schema.Literals(["check", "review", "comment", "thread"]),
  text,
  url: Schema.optional(Schema.String),
  author: Schema.optional(NonEmpty),
  thread_id: Schema.optional(NonEmpty),
  comment_id: Schema.optional(Positive),
  path: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.Boolean),
  can_resolve: Schema.optional(Schema.Boolean),
  blocking: Schema.Boolean,
  run_id: Schema.optional(Positive),
  run_attempt: Schema.optional(Positive),
  workflow: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.String.check(Schema.isMaxLength(32768))),
  evidence_unavailable: Schema.optional(Schema.String),
  disposition: Schema.optional(
    Schema.Struct({
      status: FeedbackDisposition,
      head: Commit,
      at: Count,
      actor: NonEmpty,
      reason: text,
      correction: Schema.optional(NonEmpty),
      decision: Schema.optional(ObligationKey),
    }),
  ),
});
export type Finding = typeof FindingSchema.Type;
export { ActionSchema, type PRAction } from "./action-contracts.ts";
import { ActionSchema, ActionKind } from "./action-contracts.ts";
export const FeedbackSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  head: Commit,
  pr: PullRequestUrl,
  target: BranchName,
  observed_at: Count,
  next_check_at: Count,
  attempts: Count,
  complete: Schema.Boolean,
  inspection_required: Schema.optional(Schema.Boolean),
  digest: NonEmpty,
  error: Schema.optional(text),
  findings: Schema.Array(FindingSchema).check(Schema.isMaxLength(256)),
  history: Schema.Array(FindingSchema).check(Schema.isMaxLength(4096)),
  actions: Schema.Array(ActionSchema).check(Schema.isMaxLength(256)),
}).check(
  Schema.makeFilter((f) => {
    if (f.next_check_at < f.observed_at) return "Feedback deadline precedes observation";
    if (new Set(f.findings.map((x) => x.id)).size !== f.findings.length)
      return "Duplicate finding revision";
    if (new Set(f.actions.map((x) => x.id)).size !== f.actions.length)
      return "Duplicate action identity";
    if (f.findings.some((x) => x.head !== f.head)) return "Mixed assessed heads";
    return true;
  }),
);
export type Feedback = typeof FeedbackSchema.Type;
export const FeedbackInput = Schema.Struct({
  issue_id: IssueId,
  generation: Count,
  expected_head: Commit,
  finding_ids: Schema.Array(FindingId).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  disposition: FeedbackDisposition,
  reason: text,
});
export const ActionInput = Schema.Struct({
  action_id: Schema.optional(NonEmpty),
  issue_id: IssueId,
  generation: Count,
  expected_head: Commit,
  kind: ActionKind,
  finding_id: Schema.optional(FindingId),
  users: Schema.optional(Schema.Array(NonEmpty)),
  teams: Schema.optional(Schema.Array(NonEmpty)),
  body: Schema.optional(text),
});
export const ProvisionalSchema = Schema.Struct({ head: Commit, pr: PullRequestUrl, at: Count });
export function actionable(f: Finding, head: Commit) {
  return (
    f.blocking &&
    (!f.disposition ||
      f.disposition.head !== head ||
      ["unclassified", "in_scope", "uncertain", "scope_change", "transient"].includes(
        f.disposition.status,
      ))
  );
}
export function feedbackPending(feedback: Feedback) {
  return (
    !feedback.complete ||
    feedback.findings.some((f) => actionable(f, feedback.head)) ||
    feedback.actions.some((a) => !["confirmed", "superseded", "rejected"].includes(a.status))
  );
}
/** Immutable revisions preserve source identity and never evict unresolved evidence. */
export function mergeFeedback(previous: Feedback | undefined, observed: Feedback): Feedback {
  if (!observed.complete && previous)
    return {
      ...previous,
      observed_at: observed.observed_at,
      next_check_at: observed.next_check_at,
      attempts: observed.attempts,
      complete: false,
      error: observed.error ?? "Incomplete authoritative observation; retained previous evidence",
    };
  const current = new Set(observed.findings.map((f) => f.id));
  const old = new Map(previous?.findings.map((f) => [f.id, f]));
  const history = [...(previous?.history ?? [])];
  for (const f of previous?.findings ?? [])
    if (!current.has(f.id) && !history.some((h) => h.id === f.id)) history.push(f);
  if (history.length > 4096 && previous)
    return {
      ...previous,
      complete: false,
      error: "Feedback history reached its retained limit; inspection is required",
      inspection_required: true,
      observed_at: observed.observed_at,
      next_check_at: observed.next_check_at,
    };
  return {
    ...observed,
    history,
    actions: previous?.actions ?? [],
    findings: observed.findings.map((f) => {
      const prior = old.get(f.id);
      const disposition = prior?.disposition;
      return { ...f, ...(disposition ? { disposition } : {}) };
    }),
  };
}

export const FeedbackBatchSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  head: Commit,
  findings: Schema.Array(Schema.Struct({ id: FindingId, revision: NonEmpty })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
});

export const FeedbackPageSchema = Schema.Struct({
  external_validation: Schema.optional(ExternalRecord),
  external_gate_digest: Schema.optional(NonEmpty),
  external_history: Schema.Array(ExternalRecord).check(Schema.isMaxLength(1)),
  external_history_total: Count,
  issue_id: IssueId,
  generation: Count,
  head: Schema.optional(Commit),
  page: Count,
  page_size: Schema.Literal(20),
  observation: Schema.optional(
    Schema.Struct({
      head: Commit,
      pr: PullRequestUrl,
      target: BranchName,
      observed_at: Count,
      next_check_at: Count,
      complete: Schema.Boolean,
      error: Schema.optional(Schema.String),
    }),
  ),
  findings: Schema.Array(FindingSchema).check(Schema.isMaxLength(20)),
  history: Schema.Array(FindingSchema).check(Schema.isMaxLength(20)),
  actions: Schema.Array(ActionSchema).check(Schema.isMaxLength(20)),
  finding_total: Count,
  history_total: Count,
  action_total: Count,
});
export type FeedbackPage = typeof FeedbackPageSchema.Type;
