import { Schema } from "effect";
import { canonicalJSON } from "../presentation/identity.ts";
import { Count, NonEmpty, ApprovalSchema, PhaseSchema } from "@abracode/contracts/primitives";
import {
  AbsolutePath,
  BranchName,
  ChangeName,
  Commit,
  ExecutionId,
  Fingerprint,
  FormId,
  GitTree,
  IssueId,
  MessageId,
  ObligationKey,
  OperationId,
  RepositoryId,
  RequestId,
  SessionId,
  Timestamp,
  ContentHash,
} from "@abracode/contracts/identities";
import { DirectoryIdentitySchema } from "@abracode/contracts/git/retirement-contracts";

export const PlanningSourceSchema = Schema.Struct({
  head: Commit,
  fingerprint: Fingerprint,
  index: GitTree,
  candidate: GitTree,
});
const admission = Schema.Struct({
  generation: Count,
  session_id: SessionId,
  prompt_id: MessageId,
  context_id: MessageId,
});
const authorization = Schema.Struct({
  key: ObligationKey,
  form_id: FormId,
  session_id: SessionId,
  at: Timestamp,
});
export const PlanningAttemptSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  id: Fingerprint,
  request_id: RequestId,
  input: Fingerprint,
  sender: SessionId,
  action: Schema.Literals(["replan", "recover_planning"]),
  generation: Count,
  operation_id: OperationId,
  issue_id: IssueId,
  repository_id: RepositoryId,
  execution_id: ExecutionId,
  worktree: DirectoryIdentitySchema,
  common_dir: AbsolutePath,
  branch: BranchName,
  change: ChangeName,
  schema_hash: ContentHash,
  at: Timestamp,
  expected_head: Commit,
  expected_fingerprint: Fingerprint,
  prior: Schema.Struct({
    phase: PhaseSchema,
    plan: Schema.optional(Fingerprint),
    verification: Schema.optional(Fingerprint),
    review: Schema.optional(Fingerprint),
    approvals: Schema.Array(ApprovalSchema),
    error: Schema.optional(Schema.String),
    prompt_id: Schema.optional(MessageId),
    context_id: Schema.optional(MessageId),
  }),
  provenance: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("apply"),
      session_id: SessionId,
      prompt_id: MessageId,
      context_id: MessageId,
      at: Timestamp,
    }),
    Schema.Struct({ kind: Schema.Literal("trusted"), commit: Commit }),
    Schema.Struct({ kind: Schema.Literal("historical"), attempt: Fingerprint }),
    Schema.Struct({ kind: Schema.Literal("prospective_adoption") }),
  ]),
  source: Schema.optional(PlanningSourceSchema),
  pinned: Schema.optional(Schema.Literal(true)),
  authorization: Schema.optional(authorization),
  stage: Schema.Literals([
    "prepared",
    "captured",
    "offered",
    "ready",
    "planning",
    "planned",
    "applying",
    "violated",
  ]),
  admissions: Schema.Array(admission).check(Schema.isMaxLength(256)),
  continuations: Schema.Array(Schema.Struct({ generation: Count, at: Timestamp })).check(
    Schema.isMaxLength(256),
  ),
  violations: Schema.Array(
    Schema.Struct({
      generation: Count,
      at: Timestamp,
      code: NonEmpty,
      reason: NonEmpty,
      source: PlanningSourceSchema,
      session_id: Schema.optional(SessionId),
      prompt_id: Schema.optional(MessageId),
    }),
  ).check(Schema.isMaxLength(256)),
}).check(
  Schema.makeFilter((a) => {
    if (a.stage !== "prepared" && !a.source)
      return "Captured planning attempt needs reconstructable content";
    if (a.pinned && !a.source) return "Pins require source trees";
    if (
      a.source &&
      (a.source.head !== a.expected_head || a.source.fingerprint !== a.expected_fingerprint)
    )
      return "Source capture differs from prepared intent";
    if (["offered", "ready", "planning", "planned", "applying"].includes(a.stage) && !a.pinned)
      return "Planning admission/offer requires pinned objects";
    if (
      ["ready", "planning", "planned", "applying"].includes(a.stage) &&
      a.provenance.kind === "prospective_adoption" &&
      !a.authorization
    )
      return "Prospective baseline requires an exact native authorization";
    if (a.authorization && a.provenance.kind !== "prospective_adoption")
      return "Only prospective adoption consumes a disposition";
    if (a.stage === "violated" && !a.violations.length) return "Violation stop needs its evidence";
    if (a.violations.length && a.stage !== "violated")
      return "A proven source violation cannot be cleared";
    return true;
  }),
);
export const PlanningSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  attempts: Schema.Array(PlanningAttemptSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
  ),
}).check(
  Schema.makeFilter(
    (p) =>
      new Set(p.attempts.map((a) => a.request_id)).size === p.attempts.length ||
      "Planning request identity cannot be reused",
  ),
);
export type PlanningAttempt = typeof PlanningAttemptSchema.Type;
export type PlanningSource = typeof PlanningSourceSchema.Type;
export type Planning = typeof PlanningSchema.Type;
export const currentPlanning = (e: { openspec_change: string; planning?: Planning }) => {
  const a = e.planning?.attempts.at(-1);
  return a?.change === e.openspec_change ? a : undefined;
};
/** This is an exact prospective offer, not a finishing/publication adoption. */
export const PlanningAdoptionTargetSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  kind: Schema.Literal("planning_baseline_adoption"),
  generation: Count,
  attempt: PlanningAttemptSchema,
}).check(
  Schema.makeFilter(
    (t) =>
      (t.attempt.generation === t.generation &&
        t.attempt.provenance.kind === "prospective_adoption" &&
        t.attempt.stage === "offered" &&
        !!t.attempt.source &&
        !!t.attempt.pinned) ||
      "Adoption must bind the complete pinned prospective offer",
  ),
);
export const validPlanningGenerations = (e: {
  control_generation: number;
  execution_id: ExecutionId;
  issue_id: IssueId;
  repository_id: RepositoryId;
  planning?: Planning;
}) => {
  for (const a of e.planning?.attempts ?? []) {
    if (
      a.execution_id !== e.execution_id ||
      a.issue_id !== e.issue_id ||
      a.repository_id !== e.repository_id
    )
      return "Planning attempt belongs to another execution";
    if (
      a.generation > e.control_generation ||
      [...a.admissions, ...a.continuations, ...a.violations].some(
        (v) => v.generation > e.control_generation || v.generation < a.generation,
      )
    )
      return "Planning evidence generation is invalid";
  }
  return true;
};
/** Storage enforces immutability as well as structural decoding. */
export function planningHistoryError(before: Planning | undefined, after: Planning | undefined) {
  const same = (left: unknown, right: unknown) => canonicalJSON(left) === canonicalJSON(right);
  if (!before) return;
  if (!after || after.attempts.length < before.attempts.length)
    return "Planning history cannot be removed";
  for (const [i, old] of before.attempts.entries()) {
    const next = after.attempts[i]!;
    const changing = new Set([
      "stage",
      "source",
      "pinned",
      "authorization",
      "admissions",
      "continuations",
      "violations",
    ]);
    for (const field of Object.keys(old) as Array<keyof PlanningAttempt>) {
      if (!changing.has(field) && !same(old[field], next[field]))
        return "Planning intent/binding/provenance cannot be rebound";
    }
    for (const field of ["source", "pinned", "authorization"] as const)
      if (old[field] !== undefined && !same(old[field], next[field]))
        return "Captured source, pins and consumed authority are immutable";
    for (const field of ["admissions", "continuations", "violations"] as const)
      if (!same(old[field], next[field].slice(0, old[field].length)))
        return "Planning evidence history cannot be rewritten";
    const order = [
      "prepared",
      "captured",
      "offered",
      "ready",
      "planning",
      "planned",
      "applying",
      "violated",
    ];
    if (order.indexOf(next.stage) < order.indexOf(old.stage))
      return "Planning stage cannot move backward";
    if (i < before.attempts.length - 1 && !same(old, next))
      return "Historical planning attempts cannot be modified";
  }
}
