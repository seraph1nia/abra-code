import { DeliveryOutcomeSchema, OperationInProgressSchema } from "../workflow/delivery-outcome.ts";
import { WorkerContextSummarySchema } from "../workflow/worker-context-contracts.ts";
import { ReviewerSuggestions } from "../git/reviewers.ts";
import { FeedbackPageSchema } from "../workflow/feedback-contracts.ts";
import { Schema } from "effect";
import { Session, SessionMessage } from "@opencode/client/effect";
import * as Id from "../identities.ts";
import {
  Count,
  PhaseSchema,
  RoleSchema,
  ReadinessBlockerSchema,
  RecordDiagnosticSchema,
  WorkerModelSchema,
  WorkerErrorSchema,
} from "../contracts.ts";
import { ExecutionStateSchema, ProjectRecordSchema } from "../storage/contracts.ts";
import { IssueSchema } from "../work/model.ts";
import {
  DecisionSchema,
  ProgressSchema,
  DeclaredWaitSchema,
} from "../workflow/obligation-contracts.ts";
import { ForgeFindingSchema } from "../workflow/correction-contracts.ts";
import { ReportReceiptSchema } from "../workflow/report-contracts.ts";
import { SpecStatusSchema, ApplyStatusSchema, InstructionsSchema } from "../openspec/contracts.ts";
import { VerificationSchema } from "../config/contracts.ts";
import { WorkEventSchema } from "../work/graph.ts";
const execution = ExecutionStateSchema;
const deliveryExecution = Schema.Struct({
  ...execution.fields,
  outcome: Schema.optional(DeliveryOutcomeSchema),
});
const setupExecution = Schema.Struct({
  ...ExecutionStateSchema.fields,
  setup: Schema.Literal(true),
  openspec_change: Schema.Union([Id.ChangeName, Schema.Literal("")]),
});
const error = Schema.Struct({ error: Schema.String });
const setup = Schema.Union([
  setupExecution,
  Schema.Struct({ setup: setupExecution, approval_required: Schema.Boolean, form_id: Id.FormId }),
]);
const ready = Schema.Struct({
  issue: IssueSchema,
  repository_id: Id.RepositoryId,
  eligible: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
  blocker_details: Schema.Array(ReadinessBlockerSchema),
  dependencies: Schema.Union([
    Schema.Array(Id.IssueId),
    Schema.Array(
      Schema.Struct({ id: Id.IssueId, title: Schema.String, status: IssueSchema.fields.status }),
    ),
  ]),
  execution: Schema.optional(execution),
});
const message = Schema.Struct({
  id: Id.MessageId,
  type: Schema.Union([
    SessionMessage.AgentSelected.fields.type,
    SessionMessage.ModelSelected.fields.type,
    SessionMessage.LocationSwitched.fields.type,
    SessionMessage.User.fields.type,
    SessionMessage.Synthetic.fields.type,
    SessionMessage.System.fields.type,
    SessionMessage.Skill.fields.type,
    SessionMessage.Shell.fields.type,
    SessionMessage.Assistant.fields.type,
    SessionMessage.CompactionRunning.fields.type,
    SessionMessage.Idle.fields.type,
  ]),
  at: Schema.Finite,
  text: Schema.optional(Schema.String),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Id.ToolName,
        status: Schema.Union([
          SessionMessage.ToolStateStreaming.fields.status,
          SessionMessage.ToolStateRunning.fields.status,
          SessionMessage.ToolStateCompleted.fields.status,
          SessionMessage.ToolStateError.fields.status,
        ]),
        error: Schema.optional(WorkerErrorSchema),
      }),
    ),
  ),
});
export const SessionObservationSchema = Schema.Struct({
  agent: Schema.optional(Id.AgentId),
  id: Id.SessionId,
  directory: Schema.optional(Id.AbsolutePath),
  outcome: Session.Info.fields.outcome,
  busy: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model: Schema.optional(WorkerModelSchema),
  error: Schema.optional(WorkerErrorSchema),
  error_at: Schema.optional(Schema.Finite),
  diagnostic_error: Schema.optional(Schema.String),
  recent_messages: Schema.optional(Schema.Array(message)),
  activity: Schema.optional(
    Schema.Struct({ identity: Id.ActivityId, at: Schema.Finite, summary: Schema.String }),
  ),
  available_tools: Schema.optional(
    Schema.Struct({ model: WorkerModelSchema, names: Schema.Array(Id.ToolName), at: Id.Timestamp }),
  ),
});
const inspection = Schema.Struct({
  project: ProjectRecordSchema,
  inspection: Schema.Struct({
    commit: Id.Commit,
    agents_md_content: Schema.NullOr(Schema.String),
    agents_md: Schema.Boolean,
    skills: Schema.Array(Schema.String),
    openspec_config: Schema.NullOr(Schema.String),
  }),
  setup_blockers: Schema.Array(Schema.String),
  proposal: Schema.Struct({
    initialize_openspec: Schema.Boolean,
    verification: VerificationSchema,
    preserve_existing_instructions: Schema.Boolean,
  }),
  setup: Schema.optional(setup),
});
export const toolOutputs = {
  work_reviewers: ReviewerSuggestions,
  work_feedback_status: FeedbackPageSchema,
  work_validation: execution,
  work_pr_action: execution,
  work_feedback: execution,
  work_findings: Schema.Array(ForgeFindingSchema),
  work_correct: execution,
  research_report: ReportReceiptSchema,
  work_report: Schema.String,
  work_scope: execution,
  work_attention: execution,
  work_wait_disposition: execution,
  worker_question: DecisionSchema,
  worker_progress: ProgressSchema,
  worker_wait: DeclaredWaitSchema,
  work_decision: DecisionSchema,
  project_onboard: inspection,
  project_list: Schema.Array(
    Schema.Struct({
      ...ProjectRecordSchema.fields,
      effective_capacity: Schema.Struct({ active_workers: Count, retained_executions: Count }),
      setup_blockers: Schema.Array(Schema.String),
      setup: Schema.optional(setupExecution),
    }),
  ),
  project_setup: setup,
  work_create: Schema.Struct({ issue: IssueSchema, readiness: Schema.optional(ready) }),
  work_list: Schema.Struct({
    issues: Schema.Array(IssueSchema),
    executions: Schema.Array(execution),
    record_diagnostics: Schema.Array(RecordDiagnosticSchema),
    records: Schema.optional(
      Schema.Struct({
        format: Schema.String,
        entries: Schema.Array(Schema.Struct({ key: Id.StorageKey, value: Schema.Unknown })),
      }),
    ),
  }),
  work_ready: Schema.Array(ready),
  work_start: execution,
  work_diagnostics: Schema.Struct({
    contexts: Schema.Array(WorkerContextSummarySchema),
    issue_id: Id.IssueId,
    current_phase: PhaseSchema,
    resume_phase: Schema.optional(PhaseSchema),
    worktree_directory: Schema.optional(Id.AbsolutePath),
    inherited_model: Schema.optional(WorkerModelSchema),
    last_error: Schema.optional(Schema.String),
    last_worker_failure: ExecutionStateSchema.fields.worker_failure,
    sessions: Schema.Array(
      Schema.Struct({
        ...SessionObservationSchema.fields,
        role: RoleSchema,
        configured_model: Schema.optional(WorkerModelSchema),
      }),
    ),
  }),
  work_status: Schema.Struct({
    execution,
    outcome: Schema.optional(DeliveryOutcomeSchema),
    issue: IssueSchema,
    history: Schema.Array(WorkEventSchema),
    openspec: Schema.Union([
      SpecStatusSchema,
      Schema.Struct({ archive: Id.RelativePath }),
      error,
      Schema.Null,
    ]),
    git: Schema.Union([Schema.String, error, Schema.Null]),
    sessions: Schema.Array(SessionObservationSchema),
  }),
  work_control: execution,
  work_approve: Schema.Union([
    deliveryExecution,
    Schema.Struct({
      execution,
      approval_required: Schema.Boolean,
      form_id: Id.FormId,
      outcome: Schema.optional(DeliveryOutcomeSchema),
    }),
    OperationInProgressSchema,
  ]),
  work_finish: Schema.Union([deliveryExecution, OperationInProgressSchema]),
  work_reconcile: Schema.Array(execution),
  spec: Schema.Union([SpecStatusSchema, ApplyStatusSchema, InstructionsSchema]),
  review_report: execution,
};
