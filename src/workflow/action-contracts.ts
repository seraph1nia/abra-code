import { Schema } from "effect";
import { Commit, Count, NonEmpty, Positive } from "../contracts.ts";
import {
  FindingId,
  FormId,
  SessionId,
  RepositoryId,
  PullRequestUrl,
  ErrorCode,
} from "../identities.ts";
const text = NonEmpty.check(Schema.isMaxLength(8192));
export const LegacyActionSchema = Schema.Struct({
  form_id: Schema.optional(FormId),
  session_id: Schema.optional(SessionId),
  authorized_at: Schema.optional(Count),
  schema_version: Schema.Literal(1),
  id: NonEmpty,
  generation: Count,
  head: Commit,
  kind: Schema.Literals(["ready", "reviewers", "reply", "resolve", "rerun"]),
  status: Schema.Literals(["prepared", "running", "uncertain", "confirmed", "superseded"]),
  created_at: Count,
  updated_at: Count,
  authority: NonEmpty,
  finding: Schema.optional(FindingId),
  revision: Schema.optional(NonEmpty),
  thread_id: Schema.optional(NonEmpty),
  comment_id: Schema.optional(Positive),
  body: Schema.optional(text),
  users: Schema.optional(Schema.Array(NonEmpty)),
  teams: Schema.optional(Schema.Array(NonEmpty)),
  run_id: Schema.optional(Positive),
  run_attempt: Schema.optional(Positive),
  workflow: Schema.optional(NonEmpty),
  result: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
}).check(
  Schema.makeFilter((a) => {
    if (a.status === "confirmed" && !a.result)
      return "Confirmed action needs source receipt evidence";
    if (a.updated_at < a.created_at) return "Action update precedes admission";
    if (a.kind === "rerun" && !(a.run_id && a.run_attempt && a.finding && a.revision && a.workflow))
      return "Rerun needs its source attempt";
    if (["reply", "resolve"].includes(a.kind) && !(a.finding && a.revision))
      return "Discussion action needs a source revision";
    if (a.kind === "reply" && !a.body) return "Reply needs prepared content";
    if (a.kind === "resolve" && !a.thread_id) return "Resolution needs a thread";
    if (!!a.form_id !== !!a.session_id) return "Approval form needs its session";
    return true;
  }),
);
export type LegacyAction = typeof LegacyActionSchema.Type;

export const ActionKind = LegacyActionSchema.fields.kind;
export const FindingRevision = Schema.Struct({ id: FindingId, revision: NonEmpty });
const revisions = Schema.Array(FindingRevision).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
);
const destination = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("issue") }),
  Schema.Struct({ kind: Schema.Literal("thread"), thread_id: NonEmpty, comment_id: Positive }),
]);
const fields = {
  schema_version: Schema.Literal(2),
  id: NonEmpty,
  generation: Count,
  repository_id: RepositoryId,
  pr: PullRequestUrl,
  head: Commit,
  status: Schema.Literals([
    "prepared",
    "running",
    "uncertain",
    "confirmed",
    "superseded",
    "rejected",
  ]),
  created_at: Count,
  updated_at: Count,
  authority: Schema.Literals(["execution-policy", "manual"]),
  form_id: Schema.optional(FormId),
  session_id: Schema.optional(SessionId),
  authorized_at: Schema.optional(Count),
  result: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
  submission: Schema.Union([
    Schema.Struct({ stage: Schema.Literal("unsubmitted") }),
    Schema.Struct({ stage: Schema.Literal("admitted"), at: Count }),
    Schema.Struct({ stage: Schema.Literal("accepted"), at: Count }),
    Schema.Struct({ stage: Schema.Literal("confirmed"), at: Count, receipt: NonEmpty }),
  ]),
  preflight: Schema.optional(
    Schema.Struct({
      code: ErrorCode,
      reason: text,
      retryable: Schema.Boolean,
      next_check_at: Count,
    }),
  ),
  legacy: Schema.optional(LegacyActionSchema),
};
export const CurrentActionSchema = Schema.Union([
  Schema.Struct({ ...fields, kind: Schema.Literal("ready"), target: Schema.Struct({}) }),
  Schema.Struct({
    ...fields,
    kind: Schema.Literal("reviewers"),
    target: Schema.Struct({ users: Schema.Array(NonEmpty), teams: Schema.Array(NonEmpty) }),
  }),
  Schema.Struct({
    ...fields,
    kind: Schema.Literal("reply"),
    target: Schema.Struct({ finding: FindingId, revision: NonEmpty, body: text, destination }),
  }),
  Schema.Struct({
    ...fields,
    kind: Schema.Literal("resolve"),
    target: Schema.Struct({ thread_id: NonEmpty, revisions }),
  }),
  Schema.Struct({
    ...fields,
    kind: Schema.Literal("rerun"),
    target: Schema.Struct({ run_id: Positive, run_attempt: Positive, workflow: NonEmpty }),
    findings: revisions,
  }),
]).check(
  Schema.makeFilter((a) => {
    if (a.updated_at < a.created_at) return "Action update precedes admission";
    if (!!a.form_id !== !!a.session_id) return "Approval form needs its session";
    if (a.status === "confirmed" && (a.submission.stage !== "confirmed" || !a.result))
      return "Confirmed action needs its source receipt";
    if (
      ["prepared", "superseded", "rejected"].includes(a.status) &&
      a.submission.stage !== "unsubmitted"
    )
      return "Unsubmitted status contradicts submission evidence";
    if (
      ["running", "uncertain"].includes(a.status) &&
      !["admitted", "accepted"].includes(a.submission.stage)
    )
      return "Active action needs admission evidence";
    if (a.kind === "reviewers" && !a.target.users.length && !a.target.teams.length)
      return "Reviewer request needs explicit targets";
    if (a.preflight && a.submission.stage !== "unsubmitted")
      return "Preparation failure contradicts submission evidence";
    if (a.submission.stage === "confirmed" && a.result !== a.submission.receipt)
      return "Confirmed receipt differs from retained result";
    if (
      a.submission.stage !== "unsubmitted" &&
      (a.submission.at < a.created_at || a.submission.at > a.updated_at)
    )
      return "Submission time contradicts retained lifecycle";
    if (a.legacy && (a.legacy.id !== a.id || a.legacy.head !== a.head || a.legacy.kind !== a.kind))
      return "Legacy action identity changed";
    return true;
  }),
);
export const ActionSchema = Schema.Union([LegacyActionSchema, CurrentActionSchema]);
export type PRAction = typeof ActionSchema.Type;
export type CurrentAction = typeof CurrentActionSchema.Type;
export type ActionTarget = Pick<CurrentAction, "kind" | "target" | "repository_id" | "pr" | "head">;

export function replyBody(a: PRAction) {
  return a.kind === "reply" ? (a.schema_version === 1 ? a.body : a.target.body) : undefined;
}
export function actionFindings(a: PRAction): readonly { id: FindingId; revision: string }[] {
  if (a.schema_version === 1)
    return a.finding && a.revision ? [{ id: a.finding, revision: a.revision }] : [];
  return a.kind === "rerun"
    ? a.findings
    : a.kind === "reply"
      ? [{ id: a.target.finding, revision: a.target.revision }]
      : a.kind === "resolve"
        ? a.target.revisions
        : [];
}
