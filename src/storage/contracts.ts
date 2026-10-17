import { ConfigurationSnapshotSchema } from "../config/snapshot.ts";
import { ExternalRecord } from "../validation/contracts.ts";
import { FeedbackSchema, ProvisionalSchema } from "../workflow/feedback-contracts.ts";
import {
  DeliveryPolicySchema,
  BranchPolicySchema,
  WorkerErrorSchema,
  CIPolicySchema,
  MergeMethodSchema,
  ApprovalSchema,
  Commit,
  Count,
  DeliveryReceiptSchema,
  NonEmpty,
  PolicySchema,
  Positive,
  RoleSchema,
  WorkerModelSchema,
  PhaseSchema,
} from "../contracts.ts";
import {
  FormId,
  IssueId,
  RepositoryId,
  ExecutionId,
  AbsolutePath,
  RelativePath,
  GitRemote,
  BranchName,
  NativeProjectId,
  SessionId,
  MessageId,
  OperationId,
  ChangeName,
  PullRequestUrl,
  Timestamp,
  Fingerprint,
  GitTree,
} from "../identities.ts";

import { OperationIntentSchema, DeliveryWaitSchema } from "../workflow/operation-contracts.ts";
export { OperationIntentSchema, DeliveryWaitSchema } from "../workflow/operation-contracts.ts";
import { RoundSchema, ScopeDispositionSchema } from "../workflow/correction-contracts.ts";
import { SpecVerificationSchema } from "../workflow/review-contracts.ts";
import { ScopeRecordSchema } from "../work/scope.ts";
import { ReportIntentSchema, ReportReceiptSchema } from "../workflow/report-contracts.ts";
import { AttentionSchema } from "../workflow/attention-contracts.ts";
import {
  DecisionSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "../workflow/obligation-contracts.ts";
import { GeneratedPathsSchema } from "../config/paths.ts";
import {
  DirectoryIdentitySchema,
  RetirementSchema,
  CleanupBlockerSchema,
} from "../git/retirement-contracts.ts";
import { Schema } from "effect";
import { FinishingSchema, validFinishingGenerations } from "../workflow/finishing-contracts.ts";

import { ForgeObservationSchema } from "../git/readiness-contracts.ts";

import { VerificationSchema } from "../config/contracts.ts";

export { PhaseSchema } from "../contracts.ts";
import {
  AutomationFields,
  QualityFields,
  QualityProfile,
  QualityReceipt,
} from "../config/policy.ts";

export const PolicySnapshotSchema = Schema.Struct({
  ...AutomationFields,
  quality: Schema.optional(QualityReceipt),
  verification: VerificationSchema,
  delivery: DeliveryPolicySchema,
  plan_approval: Schema.Boolean,
  merge_approval: Schema.Boolean,
  merge_method: MergeMethodSchema,
  ci_policy: CIPolicySchema,
  allow_no_checks: Schema.Boolean,
  generated_paths: GeneratedPathsSchema,
  diagnostic_turns: Count,
  repair_rounds: Count,
});
const metadata = { schema_version: Schema.Literal(1), revision: Positive };
export const ProjectRecordSchema = Schema.Struct({
  declaration_digest: Schema.optional(NonEmpty),
  ...AutomationFields,
  ...QualityFields,
  diagnostic_turns: Count.check(Schema.isLessThanOrEqualTo(5)),
  repair_rounds: Count.check(Schema.isLessThanOrEqualTo(5)),
  generated_paths: GeneratedPathsSchema,
  merge_method: MergeMethodSchema,
  ci_policy: CIPolicySchema,
  allow_no_checks: Schema.Boolean,
  ...metadata,
  id: RepositoryId,
  path: AbsolutePath,
  remote: GitRemote,
  target_branch: BranchName,
  branch_policy: BranchPolicySchema,
  managed: Schema.Boolean,
  inspected_commit: Schema.optional(Commit),
  git_common_dir: AbsolutePath,
  project_id: Schema.optional(NativeProjectId),
  openspec: Schema.Boolean,
  verification: VerificationSchema,
  max_workers: Positive,
  max_executions: Positive,
  plan_approval: Schema.Boolean,
  merge_approval: Schema.Boolean,
  delivery: DeliveryPolicySchema,
});
const fields = {
  finishing: Schema.optional(FinishingSchema),
  configuration_snapshot: Schema.optional(ConfigurationSnapshotSchema),
  worker_context_id: Schema.optional(MessageId),
  delivery_block: Schema.optional(Schema.Literals(["CI_FAILED", "CI_CANCELLED", "REVIEW_FAILED"])),
  feedback: Schema.optional(FeedbackSchema),
  provisional: Schema.optional(ProvisionalSchema),
  quality_profile: Schema.optional(QualityProfile),
  rounds: Schema.optional(Schema.Array(RoundSchema)),
  planning_base_commit: Schema.optional(Commit),
  openspec_update_commit: Schema.optional(Commit),
  scope: Schema.optional(ScopeRecordSchema),
  scope_history: Schema.optional(Schema.Array(ScopeRecordSchema)),
  report_intent: Schema.optional(ReportIntentSchema),
  report_history: Schema.optional(Schema.Array(ReportReceiptSchema)),
  report_receipt: Schema.optional(ReportReceiptSchema),
  report_acceptance_met: Schema.optional(Schema.Boolean),
  attention: Schema.optional(Schema.Array(AttentionSchema)),
  attention_turns: Schema.optional(Count),
  worker_started_at: Schema.optional(Count),
  resume_after_decision: Schema.optional(Schema.Boolean),
  decisions: Schema.optional(Schema.Array(DecisionSchema)),
  waits: Schema.optional(Schema.Array(DeclaredWaitSchema)),
  progress: Schema.optional(ProgressSchema),
  command_wait: Schema.optional(
    Schema.Struct({
      operation_id: OperationId,
      command: NonEmpty,
      started_at: Count,
      deadline_at: Count,
    }),
  ),
  research_session_id: Schema.optional(SessionId),
  worktree_identity: Schema.optional(DirectoryIdentitySchema),
  retirement: Schema.optional(RetirementSchema),
  cleanup_blocker: Schema.optional(CleanupBlockerSchema),
  intent: Schema.optional(Schema.Struct({ title: NonEmpty, description: Schema.String })),
  forge_observation: Schema.optional(ForgeObservationSchema),
  ...metadata,
  capacity_reservation: Schema.optional(
    Schema.Struct({
      role: RoleSchema,
      generation: Count,
      status: Schema.Literals(["preparing", "admitted", "active", "uncertain"]),
      session_id: Schema.optional(SessionId),
      prompt_id: Schema.optional(MessageId),
    }),
  ),
  capacity_observed_idle: Schema.optional(Schema.Boolean),
  capacity_wait: Schema.optional(
    Schema.Struct({
      role: RoleSchema,
      reasons: Schema.mutable(Schema.Array(NonEmpty)),
      consuming: Schema.mutable(Schema.Array(IssueId)),
      next_check_at: Count,
    }),
  ),
  implementation_head: Schema.optional(Commit),
  external_validation: Schema.optional(ExternalRecord),
  external_history: Schema.optional(Schema.Array(ExternalRecord).check(Schema.isMaxLength(6))),
  validation_setup: Schema.optional(
    Schema.Struct({
      form_id: FormId,
      session_id: SessionId,
      status: Schema.Literals(["prepared", "running", "uncertain", "confirmed"]),
    }),
  ),
  control_generation: Count,
  stop_status: Schema.optional(Schema.Literals(["requested", "confirmed"])),
  effective_policy: PolicySnapshotSchema,
  issue_id: IssueId,
  repository_id: RepositoryId,
  execution_id: ExecutionId,
  workflow_policy: PolicySchema,
  current_phase: PhaseSchema,
  branch: BranchName,
  openspec_change: ChangeName,
  approval_receipts: Schema.mutable(Schema.Array(ApprovalSchema)),
  updated_at: Timestamp,
  worktree_directory: Schema.optional(AbsolutePath),
  base_commit: Schema.optional(Commit),
  target_branch: Schema.optional(BranchName),
  setup: Schema.optional(Schema.Literal(false)),
  explore_session_id: Schema.optional(SessionId),
  apply_session_id: Schema.optional(SessionId),
  review_session_id: Schema.optional(SessionId),
  plan_approval_required: Schema.Boolean,
  merge_approval_required: Schema.Boolean,
  delivery_policy: DeliveryPolicySchema,
  archived_tree: Schema.optional(GitTree),
  retry_instructions: Schema.optional(Schema.String),
  active_role: Schema.optional(RoleSchema),
  session_intent: Schema.optional(Schema.Struct({ role: RoleSchema, id: SessionId })),
  prompt_id: Schema.optional(MessageId),
  supervisor_session_id: Schema.optional(SessionId),
  worker_model: Schema.optional(WorkerModelSchema),
  worker_failure: Schema.optional(
    Schema.Struct({
      prompt_id: Schema.optional(MessageId),
      session_id: SessionId,
      role: Schema.optional(RoleSchema),
      model: Schema.optional(WorkerModelSchema),
      error: WorkerErrorSchema,
      at: Timestamp,
    }),
  ),
  plan_fingerprint: Schema.optional(Fingerprint),
  verification_receipt: Schema.optional(
    Schema.Struct({ fingerprint: Fingerprint, commands: VerificationSchema, at: Timestamp }),
  ),
  review_receipt: Schema.optional(
    Schema.Struct({
      fingerprint: Fingerprint,
      passed: Schema.Boolean,
      findings: Schema.String,
      scope_status: Schema.optional(ScopeDispositionSchema),
      spec_verification: Schema.optional(SpecVerificationSchema),
      session_id: SessionId,
    }),
  ),
  archive_path: Schema.optional(RelativePath),
  pull_request_reference: Schema.optional(PullRequestUrl),
  delivery_receipt: Schema.optional(DeliveryReceiptSchema),
  delivered_commit: Schema.optional(Commit),
  error_or_recovery_reason: Schema.optional(Schema.String),
  resume_phase: Schema.optional(PhaseSchema),
  delivery_wait: Schema.optional(DeliveryWaitSchema),
  operation: Schema.optional(OperationIntentSchema),
};
export const executionRecordFields = fields;
export const ExecutionStateSchema = Schema.Struct({
  ...fields,
  setup: Schema.optional(Schema.Boolean),
}).check(Schema.makeFilter(validFinishingGenerations));
const provisioned = {
  worktree_directory: AbsolutePath,
  base_commit: Commit,
  target_branch: BranchName,
};
const approvedPlan = { ...provisioned, plan_fingerprint: Fingerprint };
const verified = {
  ...approvedPlan,
  verification_receipt: fields.verification_receipt.schema,
  review_receipt: fields.review_receipt.schema,
};
/** Transitional in-memory objects are allowed; persisted phase variants require their evidence. */
export const ExecutionRecordSchema = Schema.Union([
  Schema.Struct({
    ...fields,
    ...provisioned,
    workflow_policy: Schema.Literal("research-only"),
    current_phase: Schema.Literal("researching"),
    scope: ScopeRecordSchema,
    plan_fingerprint: Fingerprint,
  }),
  Schema.Struct({
    ...fields,
    ...provisioned,
    workflow_policy: Schema.Literal("research-only"),
    current_phase: Schema.Literals(["cleaning", "completed"]),
    scope: ScopeRecordSchema,
    report_receipt: ReportReceiptSchema,
    report_acceptance_met: Schema.Literal(true),
  }),
  Schema.Struct({
    ...fields,
    ...verified,
    workflow_policy: Schema.Literal("lightweight-fix"),
    current_phase: Schema.Literal("delivering"),
    archived_tree: GitTree,
    scope: ScopeRecordSchema,
  }),
  Schema.Struct({
    ...fields,
    current_phase: Schema.Literals([
      "queued",
      "claiming",
      "provisioning",
      "blocked",
      "interrupted",
      "failed",
      "recovery_required",
    ]),
  }),
  Schema.Struct({
    ...fields,
    ...provisioned,
    current_phase: Schema.Literals(["exploring", "planning"]),
  }),
  Schema.Struct({
    ...fields,
    ...approvedPlan,
    current_phase: Schema.Literals([
      "awaiting_plan_approval",
      "applying",
      "verifying",
      "validating_external",
    ]),
  }),
  Schema.Struct({ ...fields, ...verified, current_phase: Schema.Literal("archiving") }),
  Schema.Struct({
    ...fields,
    ...verified,
    archive_path: RelativePath,
    archived_tree: GitTree,
    current_phase: Schema.Literal("delivering"),
  }),
  Schema.Struct({
    ...fields,
    ...provisioned,
    delivered_commit: Commit,
    current_phase: Schema.Literal("awaiting_merge"),
  }),
  Schema.Struct({
    ...fields,
    ...provisioned,
    delivered_commit: Commit,
    delivery_receipt: DeliveryReceiptSchema,
    current_phase: Schema.Literals(["cleaning", "completed"]),
  }),
]).check(
  Schema.makeFilter((e) => {
    const finishing = validFinishingGenerations(e);
    if (finishing !== true) return finishing;
    if (e.setup) return "Use the setup record contract";
    if (
      e.plan_approval_required !== e.effective_policy.plan_approval ||
      e.merge_approval_required !== e.effective_policy.merge_approval ||
      e.delivery_policy !== e.effective_policy.delivery
    )
      return "Execution authority differs from its retained policy snapshot";
    if (
      ["researching", "applying", "verifying"].includes(e.current_phase) &&
      e.workflow_policy !== "full-openspec" &&
      !e.scope
    )
      return "Scoped policy requires retained scope";
    if (
      e.workflow_policy === "research-only" &&
      ["cleaning", "completed"].includes(e.current_phase)
    )
      return (
        !!(e.scope && e.report_receipt && e.report_acceptance_met) ||
        "Research completion requires its scoped report receipt"
      );
    if (e.current_phase === "archiving" || e.current_phase === "delivering")
      return e.review_receipt?.passed === true || "Successful independent review is required";
    return true;
  }),
);
// Setup has a separate completion path when the fetched base already contains OpenSpec.
export const SetupRecordSchema = Schema.Struct({
  ...fields,
  setup: Schema.Literal(true),
  openspec_change: Schema.Union([ChangeName, Schema.Literal("")]),
}).check(
  Schema.makeFilter((e) => {
    const finishing = validFinishingGenerations(e);
    if (finishing !== true) return finishing;
    if (
      e.plan_approval_required !== e.effective_policy.plan_approval ||
      e.merge_approval_required !== e.effective_policy.merge_approval ||
      e.delivery_policy !== e.effective_policy.delivery
    )
      return "Setup authority differs from its retained policy snapshot";
    if (e.current_phase === "cleaning" && !e.delivery_receipt)
      return "Setup preservation receipt is missing";
    if (["awaiting_merge", "cleaning"].includes(e.current_phase))
      return (
        !!(e.base_commit && e.worktree_directory && e.delivered_commit) ||
        "Setup delivery identity is missing"
      );
    return true;
  }),
);
export { RecordDiagnosticSchema, type RecordDiagnostic } from "../contracts.ts";
