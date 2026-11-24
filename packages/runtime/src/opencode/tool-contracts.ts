import { MemoryBody, MemoryPage } from "@abracode/contracts/visibility/memory";
import { ReviewChangesPage } from "../git/review-changes.ts";
import { EvidenceDataSchema, EvidenceReceiptSchema } from "@abracode/contracts/web/worker-evidence";
import { SessionObservationSchema } from "@abracode/contracts/opencode/session-observation-contracts";
import { ExecutionContractSchema } from "../visibility/execution-contract.ts";
export { SessionObservationSchema } from "@abracode/contracts/opencode/session-observation-contracts";
import { SelectionSourceSchema } from "../config/dispatch.ts";
import { SupervisionSummarySchema, SupervisionAggregateSchema } from "../visibility/supervision.ts";
import { DeliveryOutcomeSchema, OperationInProgressSchema } from "../workflow/delivery-outcome.ts";
import { LeadRecordSchema, LeadRequestSchema } from "../workflow/lead-contracts.ts";
import {
  CommunicationSchema,
  MessageIntentSchema,
  MessagesPageSchema,
} from "@abracode/contracts/workflow/message-contracts";
import { WorkerContextSummarySchema } from "../workflow/worker-context-contracts.ts";
import { ReviewerSuggestions } from "../git/reviewers.ts";
import { FeedbackPageSchema } from "@abracode/contracts/workflow/feedback-contracts";
import { Schema } from "effect";

import * as Id from "@abracode/contracts/identities";
import {
  Count,
  PhaseSchema,
  RoleSchema,
  ReadinessBlockerSchema,
  RecordDiagnosticSchema,
  WorkerModelSchema,
} from "@abracode/contracts/primitives";
import { ExecutionStateSchema, ProjectRecordSchema } from "../storage/contracts.ts";
import { BatchInputSchema, BatchItemResultSchema, BatchResultSchema } from "../work/batch.ts";
import { IssueSchema } from "../work/model.ts";
import {
  DecisionSchema,
  ProgressSchema,
  DeclaredWaitSchema,
} from "../workflow/obligation-contracts.ts";
import { ForgeFindingSchema } from "../workflow/correction-contracts.ts";
import { VisualBuildSummarySchema, ReportReceiptSchema } from "../reporting/report-contracts.ts";
import { SpecStatusSchema, ApplyStatusSchema, InstructionsSchema } from "../openspec/contracts.ts";
import { VerificationSchema } from "../config/contracts.ts";
import { WorkEventSchema } from "../work/graph.ts";
const execution = Schema.Struct({
  ...ExecutionStateSchema.fields,
  visual_reports: Schema.optional(Schema.Array(VisualBuildSummarySchema)),
});
const {
  messages: _messages,
  report_intent: _reportIntent,
  ...bulkExecutionFields
} = execution.fields;
const bulkExecution = Schema.Struct(bulkExecutionFields);
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
const retainedSource = Schema.Struct({
  work_revision: Schema.String,
  captured_at: Id.Timestamp,
  execution_revision: Schema.optional(Count),
});
const leadProposal = Schema.Struct({
  request_id: Id.RequestId,
  revision: Count,
  batch: BatchInputSchema,
  accepted: Schema.optional(BatchResultSchema),
  notice_id: Id.MessageId,
  notified: Schema.optional(Schema.Boolean),
});
const leadTaskSummary = Schema.Struct({
  id: Id.IssueId,
  repository_id: Id.RepositoryId,
  title: Schema.String,
  description: Schema.String,
  status: IssueSchema.fields.status,
  workflow_policy: IssueSchema.fields.workflow_policy,
  phase: Schema.optional(PhaseSchema),
  decisions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Id.ObligationKey,
        generation: Count,
        owner: DecisionSchema.fields.owner,
        question: Schema.String,
      }),
    ),
  ),
  findings: Schema.optional(Schema.Array(CommunicationSchema)),
  report: Schema.optional(
    Schema.Struct({
      report_id: ReportReceiptSchema.fields.report_id,
      hash: ReportReceiptSchema.fields.hash,
    }),
  ),
});
const leadStatus = Schema.Struct({
  id: Id.LeadId,
  revision: Count,
  repositories: LeadRecordSchema.fields.repositories,
  tasks: Schema.Array(leadTaskSummary),
  requests: Schema.Array(LeadRequestSchema),
  proposals: Schema.Array(leadProposal),
  snapshot_at: Id.Timestamp,
});
export const toolOutputs = {
  lead_control: Schema.Union([
    Schema.Array(LeadRecordSchema),
    LeadRecordSchema,
    LeadRequestSchema,
    leadProposal,
  ]),
  lead_action: Schema.Union([
    MemoryBody,
    MemoryPage,
    leadStatus,
    LeadRequestSchema,
    leadProposal,
    DecisionSchema,
    Schema.Struct({ request_id: Id.RequestId }),
  ]),
  work_message: MessageIntentSchema,
  worker_reply: CommunicationSchema,
  work_messages: MessagesPageSchema,
  work_reviewers: ReviewerSuggestions,
  work_feedback_status: FeedbackPageSchema,
  work_validation: execution,
  work_pr_action: execution,
  work_feedback: execution,
  work_findings: Schema.Array(ForgeFindingSchema),
  work_correct: execution,
  research_report: Schema.Struct({
    ...ReportReceiptSchema.fields,
    visual: Schema.optional(VisualBuildSummarySchema),
  }),
  work_report: Schema.Union([
    Schema.String,
    VisualBuildSummarySchema,
    Schema.Array(VisualBuildSummarySchema),
  ]),
  work_scope: execution,
  work_attention: execution,
  work_wait_disposition: execution,
  worker_question: DecisionSchema,
  worker_progress: Schema.Union([
    EvidenceDataSchema,
    Schema.Struct({
      ...ProgressSchema.fields,
      capture: Schema.optional(EvidenceReceiptSchema),
    }),
  ]),
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
  work_create_batch: Schema.Struct({
    ...BatchResultSchema.fields,
    tasks: Schema.Array(
      Schema.Struct({ ...BatchItemResultSchema.fields, readiness: Schema.optional(ready) }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  }),
  work_list: Schema.Struct({
    retained_source: Schema.optional(retainedSource),
    supervision: SupervisionAggregateSchema,
    issues: Schema.Array(IssueSchema),
    executions: Schema.Array(bulkExecution),
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
    execution_contract: ExecutionContractSchema,
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
        model_source: Schema.optional(SelectionSourceSchema),
      }),
    ),
  }),
  work_status: Schema.Struct({
    retained_source: Schema.optional(retainedSource),
    execution_contract: ExecutionContractSchema,
    supervision: SupervisionSummarySchema,
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
  review_changes: ReviewChangesPage,
  review_report: execution,
};
