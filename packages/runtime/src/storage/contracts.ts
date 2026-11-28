import { ProposalReviewSelection } from "@abracode/contracts/visibility/proposal-review";
import { ReviewRevision } from "../workflow/proposal-review-contracts.ts";
import {
  PlanBriefSchema,
  PlanStepsSchema,
} from "@abracode/contracts/visibility/document-contracts";
import {
  RetainedReferenceSchema,
  EvidenceReceiptSchema,
} from "@abracode/contracts/web/worker-evidence";
import { CheckResultSchema } from "@abracode/contracts/web/verification";
import { SchemaBinding } from "@abracode/contracts/openspec/schema-contracts";
import { ProjectDispatchSchema } from "../config/dispatch.ts";
import { ConfigurationSnapshotSchema } from "../config/snapshot.ts";
import {
  MessageIntentsSchema,
  validMessageGenerations,
} from "@abracode/contracts/workflow/message-contracts";
import { ExternalRecord } from "@abracode/contracts/validation/contracts";
import { FeedbackSchema, ProvisionalSchema } from "@abracode/contracts/workflow/feedback-contracts";
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
} from "@abracode/contracts/primitives";
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
  RequestId,
  OperationId,
  ChangeName,
  SpecSchemaName,
  PullRequestUrl,
  Timestamp,
  Fingerprint,
  GitTree,
} from "@abracode/contracts/identities";

import {
  OperationIntentSchema,
  DeliveryWaitSchema,
} from "@abracode/contracts/workflow/operation-contracts";
export {
  OperationIntentSchema,
  DeliveryWaitSchema,
} from "@abracode/contracts/workflow/operation-contracts";
import {
  RoundSchema,
  ScopeDispositionSchema,
} from "@abracode/contracts/workflow/correction-contracts";
import {
  PatchAssessment,
  SpecVerificationSchema,
} from "@abracode/contracts/workflow/review-contracts";
import { ScopeRecordSchema } from "../work/scope.ts";
import {
  VisualBuildsSchema,
  ReportIntentSchema,
  ReportReceiptSchema,
} from "../reporting/report-contracts.ts";
import { AttentionSchema } from "@abracode/contracts/workflow/attention-contracts";
import {
  DecisionSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "../workflow/obligation-contracts.ts";
import { GeneratedPathsSchema } from "@abracode/contracts/config/paths";
import {
  DirectoryIdentitySchema,
  RetirementSchema,
  CleanupBlockerSchema,
} from "@abracode/contracts/git/retirement-contracts";
import { Schema } from "effect";
import {
  PlanningSchema,
  currentPlanning,
  validPlanningGenerations,
} from "../workflow/planning-contracts.ts";
import { FinishingSchema, validFinishingGenerations } from "../workflow/finishing/contracts.ts";

import { ForgeObservationSchema } from "../git/readiness-contracts.ts";

import { VerificationSchema } from "../config/contracts.ts";

export { PhaseSchema } from "@abracode/contracts/primitives";
import {
  AutomationFields,
  QualityFields,
  QualityProfile,
  QualityReceipt,
  PlanApprovalSource,
} from "../config/policy.ts";

export const PolicySnapshotSchema = Schema.Struct({
  ...AutomationFields,
  quality: Schema.optional(QualityReceipt),
  verification: VerificationSchema,
  delivery: DeliveryPolicySchema,
  plan_approval: Schema.Boolean,
  plan_approval_source: Schema.optional(PlanApprovalSource),
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
  dispatch: Schema.optional(ProjectDispatchSchema),
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
  planning: Schema.optional(PlanningSchema),
  finishing: Schema.optional(FinishingSchema),
  configuration_snapshot: Schema.optional(ConfigurationSnapshotSchema),
  worker_context_id: Schema.optional(MessageId),
  delivery_block: Schema.optional(Schema.Literals(["CI_FAILED", "CI_CANCELLED", "REVIEW_FAILED"])),
  feedback: Schema.optional(FeedbackSchema),
  provisional: Schema.optional(ProvisionalSchema),
  quality_profile: Schema.optional(QualityProfile),
  openspec_schema: Schema.optional(SpecSchemaName),
  openspec_schema_binding: Schema.optional(SchemaBinding),
  rounds: Schema.optional(Schema.Array(RoundSchema)),
  planning_base_commit: Schema.optional(Commit),
  openspec_update_commit: Schema.optional(Commit),
  scope: Schema.optional(ScopeRecordSchema),
  scope_history: Schema.optional(Schema.Array(ScopeRecordSchema)),
  visual_reports: Schema.optional(VisualBuildsSchema),
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
      request_id: Schema.optional(RequestId),
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
  openspec_base_change: Schema.optional(ChangeName),
  approval_receipts: Schema.Array(ApprovalSchema),
  updated_at: Timestamp,
  worktree_directory: Schema.optional(AbsolutePath),
  base_commit: Schema.optional(Commit),
  target_branch: Schema.optional(BranchName),
  setup: Schema.optional(Schema.Literal(false)),
  explore_session_id: Schema.optional(SessionId),
  apply_session_id: Schema.optional(SessionId),
  review_session_id: Schema.optional(SessionId),
  proposal_reviews: Schema.optional(Schema.Array(ReviewRevision)),
  proposal_review: Schema.optional(ProposalReviewSelection),
  plan_approval_required: Schema.Boolean,
  merge_approval_required: Schema.Boolean,
  delivery_policy: DeliveryPolicySchema,
  archived_tree: Schema.optional(GitTree),
  retry_instructions: Schema.optional(Schema.String),
  active_role: Schema.optional(RoleSchema),
  session_intent: Schema.optional(
    Schema.Struct({
      role: RoleSchema,
      id: SessionId,
      prompt: Schema.optional(MessageId),
      native_started: Schema.optional(Schema.Literal(true)),
    }),
  ),
  prompt_id: Schema.optional(MessageId),
  messages: Schema.optional(MessageIntentsSchema),
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
  plan_brief: Schema.optional(PlanBriefSchema),
  retained_steps: Schema.optional(
    Schema.Struct({ change: ChangeName, fingerprint: Fingerprint, steps: PlanStepsSchema }),
  ),
  plan_fingerprint: Schema.optional(Fingerprint),
  worker_references: Schema.optional(
    Schema.Array(RetainedReferenceSchema).check(Schema.isMaxLength(64)),
  ),
  worker_evidence: Schema.optional(
    Schema.Array(EvidenceReceiptSchema).check(Schema.isMaxLength(64)),
  ),
  check_history: Schema.optional(Schema.Array(CheckResultSchema).check(Schema.isMaxLength(16))),
  verification_receipt: Schema.optional(
    Schema.Struct({ fingerprint: Fingerprint, commands: VerificationSchema, at: Timestamp }),
  ),
  review_coverage: Schema.optional(
    Schema.Struct({
      session_id: SessionId,
      generation: Count,
      fingerprint: Fingerprint,
      prompt_id: MessageId,
      unavailable: Schema.Array(RelativePath),
      through: Count,
      complete: Schema.Boolean,
      limited: Schema.Boolean,
    }),
  ),
  review_receipt: Schema.optional(
    Schema.Struct({
      fingerprint: Fingerprint,
      passed: Schema.Boolean,
      findings: Schema.String,
      scope_status: Schema.optional(ScopeDispositionSchema),
      spec_verification: Schema.optional(SpecVerificationSchema),
      patch_assessments: Schema.optional(PatchAssessment),
      session_id: SessionId,
    }),
  ),
  archive_path: Schema.optional(RelativePath),
  pull_request_reference: Schema.optional(PullRequestUrl),
  delivery_receipt: Schema.optional(DeliveryReceiptSchema),
  delivered_commit: Schema.optional(Commit),
  error_or_recovery_reason: Schema.optional(Schema.String),
  resume_phase: Schema.optional(PhaseSchema),
  pending_issue_status: Schema.optional(Schema.Literals(["blocked", "in_progress", "closed"])),
  delivery_wait: Schema.optional(DeliveryWaitSchema),
  operation: Schema.optional(OperationIntentSchema),
};
export const executionRecordFields = fields;
export const ExecutionStateSchema = Schema.Struct({
  ...fields,
  setup: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter(validFinishingGenerations),
  Schema.makeFilter(validMessageGenerations),
  Schema.makeFilter(validPlanningGenerations),
);
/** Decode fields once, then check the evidence required by the persisted phase. */
const recordFields = Schema.Struct(fields);
type RecordFields = typeof recordFields.Type;
type Evidence<
  P extends RecordFields["current_phase"],
  K extends keyof RecordFields = never,
> = RecordFields & { readonly current_phase: P } & Required<Pick<RecordFields, K>>;
type Provisioned = "worktree_directory" | "base_commit" | "target_branch";
type Approved = Provisioned | "plan_fingerprint";
type Verified = Approved | "verification_receipt" | "review_receipt";
type PersistedExecution =
  | Evidence<
      | "queued"
      | "claiming"
      | "provisioning"
      | "blocked"
      | "interrupted"
      | "failed"
      | "recovery_required"
    >
  | Evidence<"exploring" | "planning", Provisioned>
  | Evidence<"researching", Approved | "scope">
  | Evidence<"awaiting_plan_approval" | "applying" | "verifying" | "validating_external", Approved>
  | Evidence<"archiving", Verified>
  | Evidence<"delivering", Verified | "archived_tree">
  | Evidence<"awaiting_merge", Provisioned | "delivered_commit">
  | Evidence<"cleaning" | "completed", Provisioned>;

function phaseEvidence(e: RecordFields): true | string {
  if (
    e.pending_issue_status === "closed" &&
    (e.current_phase !== "cleaning" || e.retirement?.native !== "confirmed")
  )
    return "Closing the issue requires confirmed worktree retirement during cleaning";
  if (e.pending_issue_status === "blocked" && !["blocked", "failed"].includes(e.current_phase))
    return "Blocking the issue requires a stopped execution";
  if (
    e.pending_issue_status === "in_progress" &&
    ["queued", "completed", "blocked", "failed", "recovery_required", "interrupted"].includes(
      e.current_phase,
    )
  )
    return "Resuming the issue requires an active execution phase";
  const provisioned = !!(e.worktree_directory && e.base_commit && e.target_branch);
  const approved = provisioned && !!e.plan_fingerprint;
  switch (e.current_phase) {
    case "exploring":
    case "planning":
      if (!provisioned) return "Planning requires a provisioned worktree";
      break;
    case "researching":
      if (e.workflow_policy !== "research-only" || !approved || !e.scope)
        return "Research requires an approved research scope";
      break;
    case "awaiting_plan_approval":
    case "applying":
    case "verifying":
    case "validating_external":
      if (!approved)
        return "Phase requires worktree_directory, base_commit, target_branch and plan_fingerprint";
      break;
    case "archiving":
    case "delivering":
      if (!approved || !e.verification_receipt || !e.review_receipt?.passed)
        return "Delivery requires successful verification and independent review";
      if (
        e.current_phase === "delivering" &&
        (!e.archived_tree || (e.workflow_policy === "lightweight-fix" ? !e.scope : !e.archive_path))
      )
        return "Delivery requires an identified source tree and retained scope or archive";
      break;
    case "awaiting_merge":
      if (!provisioned || !e.delivered_commit) return "Merge requires a delivered commit";
      break;
    case "cleaning":
    case "completed":
      if (
        !provisioned ||
        (e.workflow_policy !== "research-only" && !(e.delivered_commit && e.delivery_receipt))
      )
        return "Completion requires a provisioned worktree, delivered_commit and delivery_receipt";
      break;
  }
  if (e.setup) return "Use the setup record contract";
  if (
    e.plan_approval_required !== e.effective_policy.plan_approval ||
    e.merge_approval_required !== e.effective_policy.merge_approval ||
    e.delivery_policy !== e.effective_policy.delivery
  )
    return "Execution authority differs from its retained policy snapshot";
  const synchronization = e.finishing?.synchronization?.at(-1);
  if (
    e.workflow_policy === "full-openspec" &&
    ["exploring", "planning"].includes(e.current_phase) &&
    !e.planning_base_commit &&
    !currentPlanning(e) &&
    (!synchronization || ["published", "failed"].includes(synchronization.stage)) &&
    e.approval_receipts.some((r) => r.kind === "plan" && r.authorized_at !== undefined)
  )
    return "Controlled replan requires an attributable planning baseline";
  if (
    ["researching", "applying", "verifying"].includes(e.current_phase) &&
    e.workflow_policy !== "full-openspec" &&
    !e.scope
  )
    return "Scoped policy requires retained scope";
  if (e.workflow_policy === "research-only" && ["cleaning", "completed"].includes(e.current_phase))
    return (
      !!(e.scope && e.report_receipt && e.report_acceptance_met) ||
      "Research completion requires its scoped report receipt"
    );
  return true;
}
// phaseEvidence checks the same discriminated evidence represented by PersistedExecution.
const persistedFields = recordFields.check(
  Schema.makeFilter(validFinishingGenerations),
  Schema.makeFilter(validMessageGenerations),
  Schema.makeFilter(validPlanningGenerations),
  Schema.makeFilter(phaseEvidence),
);
export const ExecutionRecordSchema = Schema.make<
  Schema.Codec<PersistedExecution, typeof recordFields.Encoded>
>(persistedFields.ast);

// Setup has a separate completion path when the fetched base already contains OpenSpec.
export const SetupRecordSchema = Schema.Struct({
  ...fields,
  setup: Schema.Literal(true),
  openspec_change: Schema.Union([ChangeName, Schema.Literal("")]),
}).check(
  Schema.makeFilter((e) => {
    if (e.pending_issue_status) return "Setup has no issue claim";
    const finishing = validFinishingGenerations(e);
    if (finishing !== true) return finishing;
    const messages = validMessageGenerations(e);
    if (messages !== true) return messages;
    if (
      e.plan_approval_required !== e.effective_policy.plan_approval ||
      e.merge_approval_required !== e.effective_policy.merge_approval ||
      e.delivery_policy !== e.effective_policy.delivery
    )
      return "Setup authority differs from its retained policy snapshot";
    if (
      e.current_phase === "queued" &&
      (!e.supervisor_session_id ||
        e.base_commit ||
        e.worktree_directory ||
        e.operation ||
        e.capacity_reservation ||
        e.active_role)
    )
      return "Queued setup requires its requesting supervisor and must precede provisioning";
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
export { RecordDiagnosticSchema, type RecordDiagnostic } from "@abracode/contracts/primitives";
