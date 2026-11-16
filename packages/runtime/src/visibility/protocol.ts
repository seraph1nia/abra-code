import {
  BindingReadQuery,
  BindingReadSchema,
  BindingCoverageSchema,
} from "@abracode/contracts/web/bindings";
import { ChangeScopeSchema } from "@abracode/contracts/web/changes";
import { LeadAttentionSchema } from "./lead-observation.ts";
import { LeadEvidenceQuery, LeadEvidencePageSchema } from "./lead-observation.ts";
import { PlanningObservationSchema } from "./document-contracts.ts";
import { WorkSummarySchema } from "./work-summary.ts";
import { WorkDiscoveryQuery, WorkPageSchema } from "./discovery-contracts.ts";
import { SupervisionAggregateSchema } from "./supervision.ts";
import { FleetSchema } from "./fleet.ts";
import { WorkerInspectionSchema } from "./worker.ts";
import { FeedbackPageSchema } from "../workflow/feedback-contracts.ts";
import { MessagesPageSchema } from "../workflow/message-contracts.ts";
import { AutomationFields, QualityReceipt } from "../config/policy.ts";
import { ProgressSchema as TaskProgressSchema, SpecArtifactSchema } from "../openspec/contracts.ts";
import {
  AbsolutePath,
  ChangeName,
  ArtifactId,
  IssueId,
  SessionId,
  Commit,
  RelativePath,
  RoundId,
  Timestamp,
  Fingerprint,
} from "../identities.ts";
import {
  ReadinessBlockerSchema,
  RecordDiagnosticSchema,
  Count,
  Positive,
  MergeMethodSchema,
  CIPolicySchema,
} from "../contracts.ts";

import { OperationIntentSchema } from "../workflow/operation-contracts.ts";
import { ScopeRecordSchema } from "../work/scope.ts";
import { ReportReceiptSchema } from "../workflow/report-contracts.ts";
import {
  DecisionSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "../workflow/obligation-contracts.ts";
import { AttentionSchema } from "../workflow/attention-contracts.ts";
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
const strings = Schema.Array(Schema.String);
import { LeadSummarySchema } from "./lead-observation.ts";
export { LeadSummarySchema, type LeadSummary } from "./lead-observation.ts";
const work = Schema.Struct({
  ...WorkSummarySchema.fields,
  waits: Schema.optional(Schema.Array(DeclaredWaitSchema)),
  progress: Schema.optional(ProgressSchema),
  attention: Schema.optional(Schema.Array(AttentionSchema)),
  delivered_head: Schema.optional(Commit),
  implementation_head: Schema.optional(Commit),
  feedback_summary: Schema.optional(
    Schema.Struct({
      complete: Schema.Boolean,
      observed_at: Count,
      next_check_at: Count,
      finding_count: Count,
      unhandled_count: Count,
      action_count: Count,
      uncertain_count: Count,
      unsubmitted_count: Schema.optional(Count),
      reruns: Count,
      error: Schema.optional(Schema.String),
    }),
  ),
  external_summary: Schema.optional(
    Schema.Struct({
      custody: Schema.String,
      status: Schema.String,
      run: Schema.optional(Schema.String),
      gate: Schema.optional(Schema.String),
      runs: Count,
      observed_at: Count,
    }),
  ),
  operation: Schema.optional(OperationIntentSchema),
  attention_turns: Schema.optional(Count),
  command_wait: Schema.optional(Schema.Struct({ command: Schema.String, deadline_at: Schema.Int })),
  policy_summary: Schema.optional(
    Schema.Struct({
      ...AutomationFields,
      quality: Schema.optional(QualityReceipt),
      plan_approval: Schema.Boolean,
      merge_approval: Schema.Boolean,
      merge_method: MergeMethodSchema,
      ci_policy: CIPolicySchema,
      repair_rounds: Count,
      diagnostic_turns: Count,
    }),
  ),
  rounds: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: RoundId,
        ordinal: Positive,
        source: Schema.Literals(["check", "review", "forge"]),
        starting_head: Commit,
        archive_path: Schema.optional(RelativePath),
        instructions: Schema.String,
        finding_count: Count,
      }),
    ),
  ),
  report_available: Schema.optional(Schema.Boolean),
  scope: Schema.optional(ScopeRecordSchema),
  scope_history: Schema.optional(
    Schema.Array(
      Schema.Struct({ revision: Positive, goal: Schema.String, fingerprint: Fingerprint }),
    ),
  ),
  report: Schema.optional(ReportReceiptSchema),
  decisions: Schema.optional(Schema.Array(DecisionSchema)),
  blocker_details: Schema.optional(Schema.Array(ReadinessBlockerSchema)),
});
const snapshot = Schema.Struct({
  fleet: Schema.optional(FleetSchema),
  management: Schema.optional(LeadAttentionSchema),
  leads: Schema.optional(Schema.Array(LeadSummarySchema)),
  lead_diagnostics: Schema.optional(strings),
  supervision: Schema.optional(SupervisionAggregateSchema),
  record_diagnostics: Schema.optional(Schema.Array(RecordDiagnosticSchema)),
  home: AbsolutePath,
  binding_coverage: Schema.optionalKey(BindingCoverageSchema),
  work: Schema.Array(work),
  at: Timestamp,
  work_revision: Schema.optional(Schema.String),
  closed_total: Schema.optional(Count),
  closed_page: Schema.optional(Count),
});
const detail = Schema.Struct({
  work,
  description: Schema.String,
  change: Schema.optional(ChangeName),
  archive: Schema.optional(RelativePath),
  artifacts: Schema.Array(
    Schema.Struct({ id: ArtifactId, status: SpecArtifactSchema.fields.status, path: RelativePath }),
  ),
  progress: Schema.optional(TaskProgressSchema),
  proposal: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.Array(RelativePath)),
  planning: Schema.optional(PlanningObservationSchema),
  errors: strings,
});
const diff = Schema.Struct({
  base: Schema.optional(Commit),
  head: Schema.optional(Commit),
  at: Timestamp,
  historical: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      path: RelativePath,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: Count,
      deletions: Count,
      binary: Schema.Boolean,
      limited: Schema.Boolean,
    }),
  ),
  file: Schema.optional(RelativePath),
  patch: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  limited: Schema.Boolean,
});
const document = Schema.Struct({
  path: Schema.Union([RelativePath, Schema.Literal("@report")]),
  content: Schema.String,
});
export type WorkDiff = typeof diff.Type;
export type WorkDocument = typeof document.Type;
export const DiffScopeSchema = Schema.Literals(["all", "uncommitted"]);
export type DiffScope = typeof DiffScopeSchema.Type;
export type WorkItem = typeof work.Type;
export type WorkSnapshot = typeof snapshot.Type;
export type WorkDetail = typeof detail.Type;
export const WorkReportSchema = Schema.Struct({ content: Schema.String });
export const observerErrors = {
  not_found: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })),
  resource_unavailable: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })),
  invalid_selection: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })),
};
// Portable schemas keep the observer contract typed in both the native server and TUI.
export const visibility = Rpc.define({
  id: "abracode-visibility",
  methods: {
    binding: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(BindingReadQuery, {
        parseOptions: { onExcessProperty: "error", reportInput: false },
      }),
      output: Schema.toStandardSchemaV1(BindingReadSchema),
    },
    find: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(WorkDiscoveryQuery, {
        parseOptions: { onExcessProperty: "error", reportInput: false },
      }),
      output: Schema.toStandardSchemaV1(WorkPageSchema),
    },
    leads: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(LeadEvidenceQuery, {
        parseOptions: { onExcessProperty: "error", reportInput: false },
      }),
      output: Schema.toStandardSchemaV1(LeadEvidencePageSchema),
    },
    messages: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ issue_id: IssueId, offset: Schema.optional(Count) }),
      ),
      output: Schema.toStandardSchemaV1(MessagesPageSchema),
    },
    worker: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(Schema.Struct({ issue_id: IssueId, session_id: SessionId })),
      output: Schema.toStandardSchemaV1(WorkerInspectionSchema),
    },
    feedback: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ issue_id: IssueId, page: Schema.optional(Count) }),
      ),
      output: Schema.toStandardSchemaV1(FeedbackPageSchema),
    },
    report: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(Schema.Struct({ issue_id: IssueId })),
      output: Schema.toStandardSchemaV1(WorkReportSchema),
    },
    snapshot: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(Schema.Struct({ closed_page: Schema.optional(Count) })),
      output: Schema.toStandardSchemaV1(snapshot),
    },
    diff: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          issue_id: IssueId,
          scope: DiffScopeSchema,
          file: Schema.optional(RelativePath),
        }),
      ),
      output: Schema.toStandardSchemaV1(diff),
    },
    document: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(Schema.Struct({ issue_id: IssueId, path: RelativePath })),
      output: Schema.toStandardSchemaV1(document),
    },
    detail: {
      errors: observerErrors,
      input: Schema.toStandardSchemaV1(Schema.Struct({ issue_id: IssueId })),
      output: Schema.toStandardSchemaV1(detail),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(
        Schema.Struct({ home: AbsolutePath, scope: Schema.optional(ChangeScopeSchema) }),
      ),
    },
  },
});

export {
  snapshot as WorkSnapshotSchema,
  detail as WorkDetailSchema,
  diff as WorkDiffSchema,
  document as WorkDocumentSchema,
};
