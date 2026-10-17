import { Schema } from "effect";
import { Commit, Count, NonEmpty } from "../contracts.ts";
import { AbsolutePath, BranchName, Executable, FormId, IssueId, SessionId } from "../identities.ts";

export const ExternalStep = Schema.Literals([
  "intent",
  "rebase",
  "review",
  "test",
  "document",
  "lint",
  "push",
  "pr",
  "ci",
]);
export const SkippedSteps = ["rebase", "push", "pr", "ci"] as const;
const bounded = Schema.String.check(Schema.isMaxLength(8192));
export const ExternalGate = Schema.Struct({
  step: ExternalStep,
  status: Schema.Literal("awaiting_approval"),
  summary: Schema.optional(bounded),
  risk: Schema.optional(bounded),
  findings: Schema.Array(
    Schema.Struct({
      id: NonEmpty,
      severity: NonEmpty,
      file: Schema.String,
      action: Schema.String,
      description: bounded,
    }),
  ).check(Schema.isMaxLength(64)),
});
export const ExternalRun = Schema.Struct({
  id: NonEmpty,
  branch: BranchName,
  head_sha: Commit,
  status: Schema.Literals([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "ci_monitor_interrupted",
  ]),
  awaiting_agent: Schema.optional(Schema.String),
  test_override_reason: Schema.optional(bounded),
  steps: Schema.Array(
    Schema.Struct({
      step: ExternalStep,
      status: Schema.Literals([
        "pending",
        "running",
        "awaiting_approval",
        "fixing",
        "fix_review",
        "completed",
        "skipped",
        "failed",
      ]),
      findings: Count,
      duration_ms: Count,
    }),
  ).check(Schema.isMaxLength(9)),
  automatic_skips: Schema.optional(
    Schema.Array(Schema.Struct({ step: ExternalStep, reason: bounded })),
  ),
});
export const LaunchReceipt = Schema.Struct({
  run_id: NonEmpty,
  disposition: Schema.Literals(["created", "reused"]),
  launch_nonce: NonEmpty,
  validation_generation: NonEmpty,
  branch: BranchName,
  head_sha: Commit,
  submitted_head_sha: Commit,
  intent_digest: NonEmpty,
});
export const BranchSync = Schema.Struct({
  state: Schema.Literals([
    "pipeline_owned",
    "push_in_progress",
    "behind",
    "synchronized",
    "local_ahead",
    "diverged",
    "dirty",
    "remote_advanced",
    "remote_rewritten",
    "remote_missing",
    "merged_remote_retained",
    "merged_remote_removed",
    "closed",
    "offline",
    "target_changed",
    "ambiguous_context",
    "legacy_unbound",
    "custody_returned",
    "user_owned",
  ]),
  changed: Schema.Boolean,
  recovered: Schema.optional(Schema.Boolean),
  local: Schema.Struct({
    branch: BranchName,
    head: Commit,
    clean: Schema.Boolean,
    reason: Schema.optional(bounded),
  }),
  pipeline: Schema.Struct({
    run: Schema.String,
    status: Schema.String,
    phase: Schema.String,
    submitted_head: Schema.String,
    current_head: Schema.String,
    pushed_head: Schema.String,
    pushed_at: Schema.String,
    push_generation: Count,
  }),
  target: Schema.Struct({
    kind: Schema.String,
    remote: Schema.String,
    url: Schema.String,
    ref: Schema.String,
  }),
  remote: Schema.Struct({
    observed_head: Schema.String,
    freshness: Schema.String,
    observed_at: Schema.String,
  }),
  relation: Schema.String,
  safety: NonEmpty,
  pr_state: Schema.String,
  recovery: Schema.optional(
    Schema.Struct({
      source: NonEmpty,
      repository: NonEmpty,
      run: NonEmpty,
      branch: BranchName,
      required_head: Commit,
      preserved_head: Schema.String,
      archive_ref: Schema.String,
      keep_local: Schema.Boolean,
      proof: NonEmpty,
    }),
  ),
  next_action: Schema.optional(Schema.Struct({ code: NonEmpty, command: NonEmpty })),
  note: Schema.optional(bounded),
});
export const ExternalDocument = Schema.Struct({
  launch_receipt: Schema.optional(LaunchReceipt),
  run: Schema.optional(ExternalRun),
  gate: Schema.optional(ExternalGate),
  branch_sync: Schema.optional(BranchSync),
  outcome: Schema.optional(
    Schema.Literals([
      "passed",
      "passed-with-skips",
      "passed-with-override",
      "checks-passed",
      "failed",
      "cancelled",
      "ci-monitor-interrupted",
    ]),
  ),
  error: Schema.optional(bounded),
});
export function externalSucceeded(doc: typeof ExternalDocument.Type | undefined) {
  const steps = doc?.run?.steps ?? [];
  return (
    doc?.run?.status === "completed" &&
    doc.outcome === "passed" &&
    !doc.run.test_override_reason &&
    !doc.run.automatic_skips?.length &&
    steps.length === 9 &&
    new Set(steps.map((s) => s.step)).size === 9 &&
    steps.every((s) =>
      SkippedSteps.some((x) => x === s.step) ? s.status === "skipped" : s.status === "completed",
    )
  );
}
export const EnginePreflight = Schema.Struct({
  schema_version: Schema.Literal(1),
  version: Schema.Literal("1.84.0"),
  bin: Executable,
  home: AbsolutePath,
  fix_limits: Schema.Record(ExternalStep, Count.check(Schema.isLessThanOrEqualTo(10))),
  config_digest: NonEmpty,
});
export const ExternalResponse = Schema.Struct({
  id: NonEmpty,
  gate_digest: NonEmpty,
  step: ExternalStep,
  action: Schema.Literals(["approve", "fix", "skip"]),
  findings: Schema.Array(NonEmpty),
  instructions: bounded,
  status: Schema.Literals(["prepared", "running", "uncertain", "confirmed", "rejected"]),
  at: Count,
  form_id: FormId,
  session_id: SessionId,
});
export const ExternalRecord = Schema.Struct({
  schema_version: Schema.Literal(1),
  generation: Count,
  nonce: NonEmpty,
  validation_generation: NonEmpty,
  submitted_head: Commit,
  intent: NonEmpty.check(Schema.isMaxLength(8192)),
  intent_digest: NonEmpty,
  branch: BranchName,
  custody: Schema.Literals(["reserved", "external", "uncertain", "returned"]),
  status: Schema.Literals(["prepared", "running", "gated", "terminal", "adopted", "aborted"]),
  preflight: EnginePreflight,
  created_at: Count,
  observed_at: Count,
  next_check_at: Count,
  launch: Schema.optional(LaunchReceipt),
  observation: Schema.optional(ExternalDocument),
  responses: Schema.Array(ExternalResponse).check(Schema.isMaxLength(64)),
  adoption: Schema.optional(Schema.Struct({ head: Commit, at: Count, sync: BranchSync })),
  error: Schema.optional(bounded),
}).check(
  Schema.makeFilter((r) => {
    if (
      r.launch &&
      (r.launch.launch_nonce !== r.nonce ||
        r.launch.validation_generation !== r.validation_generation ||
        r.launch.submitted_head_sha !== r.submitted_head ||
        r.launch.branch !== r.branch ||
        r.launch.intent_digest !== r.intent_digest)
    )
      return "External launch binding differs from admission";
    if (r.observation?.run && r.observation.run.id !== r.launch?.run_id)
      return "External observation has no matching launch proof";
    if (r.adoption) {
      const sync = r.adoption.sync;
      if (
        r.custody !== "returned" ||
        !["user_owned", "custody_returned", "synchronized"].includes(sync.state) ||
        !sync.local.clean ||
        sync.local.branch !== r.branch ||
        sync.local.head !== r.adoption.head ||
        sync.pipeline.run !== r.launch?.run_id ||
        sync.pipeline.submitted_head !== r.submitted_head ||
        (!!sync.pipeline.current_head && sync.pipeline.current_head !== r.adoption.head)
      )
        return "Adoption differs from clean preserved custody evidence";
    }
    if (r.status === "adopted" && !externalSucceeded(r.observation))
      return "Successful adoption needs its complete external validation outcome";
    if (r.custody === "returned" && !r.adoption) return "Returned custody needs adoption evidence";
    if (r.status === "adopted" && r.custody !== "returned")
      return "Adopted result still owns external custody";
    return true;
  }),
);
export type ExternalRecord = typeof ExternalRecord.Type;
export const ValidationInput = Schema.Struct({
  issue_id: IssueId,
  generation: Count,
  expected_head: Commit,
  action: Schema.Literals(["preflight", "setup", "respond", "adopt", "abort"]),
  gate_digest: Schema.optional(NonEmpty),
  response: Schema.optional(ExternalResponse.fields.action),
  finding_ids: Schema.optional(Schema.Array(NonEmpty).check(Schema.isMaxLength(64))),
  instructions: Schema.optional(bounded),
});
export function externalOwns(e: { external_validation?: ExternalRecord }) {
  return !!e.external_validation && e.external_validation.custody !== "returned";
}
