import { Schema } from "effect";
import { Commit, Count, NonEmpty, Positive } from "../primitives.ts";
import {
  FindingId,
  FormId,
  SessionId,
  RepositoryId,
  PullRequestUrl,
  ErrorCode,
} from "../identities.ts";
const text = NonEmpty.check(Schema.isMaxLength(8192));
export const ActionKind = Schema.Literals(["ready", "reviewers", "reply", "resolve", "rerun"]);
export const FindingRevision = Schema.Struct({ id: FindingId, revision: NonEmpty });
export type FindingRevision = typeof FindingRevision.Type;
const revisions = Schema.Array(FindingRevision).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
);
const destination = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("issue") }),
  Schema.Struct({ kind: Schema.Literal("thread"), thread_id: NonEmpty, comment_id: Positive }),
]);
const fields = {
  schema_version: Schema.Literal(1),
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
    return true;
  }),
);
export const ActionSchema = CurrentActionSchema;
export type PRAction = typeof ActionSchema.Type;
export type CurrentAction = typeof CurrentActionSchema.Type;
export type ActionTarget = Pick<CurrentAction, "kind" | "target" | "repository_id" | "pr" | "head">;

export function replyBody(a: PRAction) {
  return a.kind === "reply" ? a.target.body : undefined;
}
export function actionFindings(a: PRAction): readonly { id: FindingId; revision: string }[] {
  return a.kind === "rerun"
    ? a.findings
    : a.kind === "reply"
      ? [{ id: a.target.finding, revision: a.target.revision }]
      : a.kind === "resolve"
        ? a.target.revisions
        : [];
}
