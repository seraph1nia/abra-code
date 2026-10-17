import { Schema } from "effect";
import { join } from "node:path";
import { Count, NonEmpty, Positive, ApprovalSchema } from "../contracts.ts";
import {
  Commit,
  Fingerprint,
  FormId,
  GitTree,
  MessageId,
  ObligationKey,
  OperationId,
  PullRequestUrl,
  SessionId,
  Timestamp,
  ContentHash,
  RelativePath,
  ChangeName,
} from "../identities.ts";
import { GeneratedPathSchema, GeneratedPathsSchema } from "../config/paths.ts";
import {
  CleanupPathSchema,
  CleanupPathsSchema,
  DirectoryIdentitySchema,
} from "../git/retirement-contracts.ts";

const identity = { schema_version: Schema.Literal(1), generation: Count };
const directories = Schema.Array(
  Schema.Struct({ path: GeneratedPathSchema, identity: DirectoryIdentitySchema }),
).check(Schema.isMaxLength(64));
const exactDirectories = directories.check(
  Schema.isMinLength(1),
  Schema.makeFilter((items) => Schema.is(GeneratedPathsSchema)(items.map((item) => item.path))),
);
const directoryBinding = (value: {
  worktree: typeof DirectoryIdentitySchema.Type;
  directories: typeof exactDirectories.Type;
}) =>
  value.directories.every((d) => d.identity.path === join(value.worktree.path, d.path)) ||
  "Selected directory identity must belong to the exact worktree-relative path";

/** A fingerprint identifies the complete input; sampled names are never content authority. */
export const FinishingTargetSchema = Schema.Union([
  Schema.Struct({
    ...identity,
    kind: Schema.Literal("residue"),
    worktree: DirectoryIdentitySchema,
    fingerprint: Fingerprint,
    paths: CleanupPathsSchema.check(Schema.isMinLength(1)),
    truncated: Schema.Boolean,
    directories: directories.check(Schema.isMinLength(0)),
    files: Schema.Array(Schema.Struct({ path: CleanupPathSchema, hash: ContentHash })).check(
      Schema.isMaxLength(64),
    ),
  }).check(
    Schema.makeFilter(
      (t) =>
        (directoryBinding(t) === true &&
          t.directories.every((d) =>
            t.paths.some((p) => p.path === d.path && p.kind === "directory"),
          ) &&
          t.files.every((f) => t.paths.some((p) => p.path === f.path && p.kind === "file"))) ||
        "Disposition choices must identify exact sampled paths in this worktree",
    ),
  ),
  Schema.Struct({
    ...identity,
    kind: Schema.Literals(["adopt", "additional_attempt", "follow_on"]),
    worktree: DirectoryIdentitySchema,
    fingerprint: Fingerprint,
    head: Commit,
    published: Commit,
    plan: Fingerprint,
  }),
]);

export const FinishingRoutingSchema = Schema.Struct({
  ...identity,
  key: ObligationKey,
  status: Schema.Literals(["undelivered", "pending", "answered", "deferred", "superseded"]),
  attempts: Count.check(Schema.isLessThanOrEqualTo(8)),
  next_check_at: Count,
  form_id: Schema.optional(FormId),
  session_id: Schema.optional(SessionId),
  prompt_id: Schema.optional(MessageId),
  observed_at: Count,
  reason: Schema.optional(NonEmpty.check(Schema.isMaxLength(8192))),
}).check(
  Schema.makeFilter(
    (r) =>
      r.status !== "pending" ||
      !!(r.form_id && r.session_id) ||
      "Pending routing requires its native form and session",
  ),
);

export const GeneratedAuthorizationSchema = Schema.Struct({
  ...identity,
  revision: Positive,
  key: ObligationKey,
  form_id: FormId,
  session_id: SessionId,
  authorized_at: Timestamp,
  worktree: DirectoryIdentitySchema,
  fingerprint: Fingerprint,
  directories: exactDirectories,
}).check(Schema.makeFilter(directoryBinding));

export const CleanupPreflightSchema = Schema.Struct({
  ...identity,
  operation_id: OperationId,
  head: Commit,
  content: Fingerprint,
  published: Commit,
  worktree: DirectoryIdentitySchema,
  authorization_revision: Count,
  observed_at: Count,
  status: Schema.Literals(["ready", "blocked", "unavailable"]),
  paths: CleanupPathsSchema,
  truncated: Schema.Boolean,
  fingerprint: Schema.optional(Fingerprint),
  reason: Schema.optional(NonEmpty.check(Schema.isMaxLength(8192))),
}).check(
  Schema.makeFilter(
    (p) =>
      p.status !== "ready" ||
      (!p.truncated && p.paths.length === 0 && p.head === p.published) ||
      "Ready preflight requires complete clean synchronized evidence",
  ),
);

export const PublicationBindingSchema = Schema.Struct({
  ...identity,
  operation_id: OperationId,
  verification: Fingerprint,
  review: Fingerprint,
  review_session: SessionId,
  archived_tree: GitTree,
  commit: Commit,
  pr: Schema.optional(PullRequestUrl),
  at: Timestamp,
}).check(
  Schema.makeFilter(
    (p) => p.verification === p.review || "Publication requires matching verification and Review",
  ),
);

export const SynchronizationAttemptSchema = Schema.Struct({
  ...identity,
  operation_id: OperationId,
  ordinal: Positive,
  input: Fingerprint,
  input_tree: GitTree,
  head: Commit,
  published: Commit,
  plan: Fingerprint,
  pr: Schema.optional(PullRequestUrl),
  attribution: Schema.Literals(["authorized_work", "native_adoption"]),
  adoption_key: Schema.optional(ObligationKey),
  additional_authorization: Schema.optional(ObligationKey),
  stage: Schema.Literals([
    "admitted",
    "planning",
    "verifying",
    "reviewing",
    "publishing",
    "published",
    "failed",
  ]),
  review_session: Schema.optional(SessionId),
  review_prompt: Schema.optional(MessageId),
  intended_commit: Schema.optional(Commit),
  admitted_at: Timestamp,
  prior_change: ChangeName,
  prior_archive: Schema.optional(RelativePath),
  prior_tree: Schema.optional(GitTree),
  planning_base_tree: Schema.optional(GitTree),
  prior_approvals: Schema.Array(ApprovalSchema),
  worker_sessions: Schema.Array(
    Schema.Struct({
      id: SessionId,
      role: Schema.Literals(["explore", "apply", "review", "research"]),
    }),
  ).check(Schema.isMaxLength(4)),
}).check(
  Schema.makeFilter((a) =>
    a.attribution === "native_adoption" && !a.adoption_key
      ? "Native adoption requires its decision receipt"
      : a.ordinal > 2 && !a.additional_authorization
        ? "Additional synchronization requires exact-content authorization"
        : a.stage === "published" && !a.intended_commit
          ? "Published attempt requires its intended commit"
          : true,
  ),
);
export const FinishingSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  current_question: Schema.optional(ObligationKey),
  completion_notice: Schema.optional(
    Schema.Struct({
      message_id: MessageId,
      session_id: Schema.optional(SessionId),
      status: Schema.Literals(["pending", "delivered"]),
      attempts: Count.check(Schema.isLessThanOrEqualTo(8)),
      next_check_at: Count,
      reason: Schema.optional(NonEmpty.check(Schema.isMaxLength(8192))),
    }),
  ),
  attribution: Schema.optional(
    Schema.Struct({
      ...identity,
      fingerprint: Fingerprint,
      head: Commit,
      session_id: SessionId,
      prompt_id: MessageId,
      at: Timestamp,
    }),
  ),
  inclusions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ...identity,
        key: ObligationKey,
        files: Schema.Array(Schema.Struct({ path: CleanupPathSchema, hash: ContentHash })).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(64),
        ),
        stage: Schema.Literals(["admitted", "staged"]),
        source_clean: Schema.Boolean,
        intended_tree: GitTree,
        content: Schema.optional(Fingerprint),
        head: Commit,
      }),
    ).check(Schema.isMaxLength(256)),
  ),
  synchronization: Schema.optional(
    Schema.Array(SynchronizationAttemptSchema).check(Schema.isMaxLength(256)),
  ),
  publication: Schema.optional(PublicationBindingSchema),
  preflight: Schema.optional(CleanupPreflightSchema),
  authorizations: Schema.optional(
    Schema.Array(GeneratedAuthorizationSchema).check(Schema.isMaxLength(64)),
  ),
  routing: Schema.optional(Schema.Array(FinishingRoutingSchema).check(Schema.isMaxLength(256))),
}).check(
  Schema.makeFilter((f) => {
    const attempts = f.synchronization ?? [];
    if (attempts.some((a, i) => a.ordinal !== i + 1))
      return "Synchronization ordinals must preserve consumed history";
    const keys = attempts.flatMap((a) =>
      a.additional_authorization ? [a.additional_authorization] : [],
    );
    if (new Set(keys).size !== keys.length) return "An additional-attempt receipt is single use";
    return true;
  }),
);
export type FinishingTarget = typeof FinishingTargetSchema.Type;

export const FinishingAnswerSchema = Schema.Struct({
  action: Schema.Literals(["generated", "include", "preserve", "authorize", "defer"]),
  paths: Schema.Array(CleanupPathSchema).check(Schema.isMaxLength(64)),
}).check(
  Schema.makeFilter(
    (a) =>
      (new Set(a.paths).size === a.paths.length &&
        (a.action === "defer" || a.action === "authorize" || a.paths.length > 0)) ||
      "Choose unique exact paths for the disposition",
  ),
);
export type FinishingAnswer = typeof FinishingAnswerSchema.Type;

export function validFinishingAnswer(target: FinishingTarget, answer: FinishingAnswer) {
  if (answer.action === "defer") return answer.paths.length === 0;
  if (target.kind === "residue") {
    const available =
      answer.action === "generated"
        ? target.directories.map((d) => d.path)
        : answer.action === "include"
          ? target.files.map((f) => f.path)
          : answer.action === "preserve"
            ? target.paths.map((p) => p.path)
            : [];
    return answer.paths.length > 0 && answer.paths.every((path) => available.includes(path));
  }
  if (target.kind === "adopt" || target.kind === "additional_attempt")
    return answer.action === "authorize" && answer.paths.length === 0;
  return answer.action === "authorize" && answer.paths.length === 0;
}

/** Historical generations remain readable; future evidence cannot grant current authority. */
export const validFinishingGenerations = (e: {
  control_generation: number;
  finishing?: typeof FinishingSchema.Type;
  decisions?: readonly { generation: number; finishing_target?: FinishingTarget }[];
}) => {
  const f = e.finishing;
  const evidence = [
    ...(f?.attribution ? [f.attribution] : []),
    ...(f?.inclusions ?? []),
    ...(f?.synchronization ?? []),
    ...(f?.authorizations ?? []),
    ...(f?.routing ?? []),
    ...(f?.publication ? [f.publication] : []),
    ...(f?.preflight ? [f.preflight] : []),
  ];
  if (evidence.some((item) => item.generation > e.control_generation))
    return "Finishing evidence cannot reference a future control generation";
  if (
    e.decisions?.some((d) => d.finishing_target && d.finishing_target.generation !== d.generation)
  )
    return "Finishing target must match its decision generation";
  return true;
};
