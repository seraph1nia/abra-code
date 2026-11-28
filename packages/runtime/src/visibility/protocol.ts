import { ProposalReviewView } from "@abracode/contracts/visibility/proposal-review";
import {
  PlanBriefSchema,
  PlanStepsSchema,
  TaskIntentSchema,
} from "@abracode/contracts/visibility/document-contracts";
import { exactParseOptions } from "@abracode/contracts/primitives";
import {
  WorkQuery,
  WorkDocumentQuery,
  WorkWorkerQuery,
  WorkPageQuery,
  EvidenceSearch,
  EvidenceSearchPage,
  SessionQuery,
  SessionPage,
} from "@abracode/contracts/visibility/discovery-contracts";
import { ThoughtWorkQuery, ThoughtWorkPage } from "@abracode/contracts/visibility/thoughts";
import {
  ThoughtSource,
  ThoughtQuery,
  ThoughtPage,
  ThoughtReference,
  ThoughtDetail,
} from "@abracode/contracts/visibility/thoughts";
import {
  InboxQuery,
  InboxPage,
  InboxTarget,
  InboxDetail,
} from "@abracode/contracts/visibility/github-inbox";
import { ContentHash } from "@abracode/contracts/identities";
import { EvidenceDataSchema, EvidenceQuerySchema } from "@abracode/contracts/web/worker-evidence";
import { VerificationViewSchema } from "@abracode/contracts/web/verification";
import {
  WorkDiffSchema as diff,
  DiffScopeSchema,
} from "@abracode/contracts/visibility/document-contracts";
import {
  BindingReadQuery,
  BindingReadSchema,
  BindingCoverageSchema,
} from "@abracode/contracts/web/bindings";
import { ChangeScopeSchema } from "@abracode/contracts/web/changes";
import { LeadAttentionSchema } from "@abracode/contracts/visibility/lead-observation";
import {
  LeadEvidenceQuery,
  LeadEvidencePageSchema,
} from "@abracode/contracts/visibility/lead-observation";
import { PlanningObservationSchema } from "@abracode/contracts/visibility/document-contracts";
import { WorkSummarySchema } from "@abracode/contracts/visibility/work-summary";
import {
  WorkDiscoveryQuery,
  WorkPageSchema,
} from "@abracode/contracts/visibility/discovery-contracts";
import { SupervisionAggregateSchema } from "../workflow/read-model/supervision.ts";
import { FleetSchema } from "./fleet.ts";
import { WorkerInspectionSchema } from "@abracode/contracts/visibility/worker";
import { FeedbackQuery, FeedbackPageSchema } from "@abracode/contracts/workflow/feedback-contracts";
import { MessagesPageSchema } from "@abracode/contracts/workflow/message-contracts";
import { AutomationFields, QualityReceipt } from "../config/policy.ts";
import { ProgressSchema as TaskProgressSchema, SpecArtifactSchema } from "../openspec/contracts.ts";
import {
  AbsolutePath,
  ChangeName,
  ArtifactId,
  IssueId,
  Commit,
  RelativePath,
  RoundId,
  Timestamp,
  Fingerprint,
} from "@abracode/contracts/identities";
import {
  ReadinessBlockerSchema,
  RecordDiagnosticSchema,
  Count,
  Positive,
  MergeMethodSchema,
  CIPolicySchema,
} from "@abracode/contracts/primitives";

import { OperationIntentSchema } from "@abracode/contracts/workflow/operation-contracts";
import { ScopeRecordSchema } from "../work/scope.ts";
import { ReportReceiptSchema } from "../reporting/report-contracts.ts";
import {
  DecisionSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "../workflow/obligation-contracts.ts";
import { AttentionSchema } from "@abracode/contracts/workflow/attention-contracts";
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
const strings = Schema.Array(Schema.String);
import { LeadSummarySchema } from "@abracode/contracts/visibility/lead-observation";
export {
  LeadSummarySchema,
  type LeadSummary,
} from "@abracode/contracts/visibility/lead-observation";
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
        source: Schema.Literals(["check", "review", "forge", "checkpoint"]),
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
const overview = Schema.Struct({
  work,
  description: Schema.String,
  intent: Schema.optional(TaskIntentSchema),
  thought_source: Schema.optional(ThoughtSource),
  errors: strings,
});
const detail = Schema.Struct({
  ...overview.fields,
  change: Schema.optional(ChangeName),
  archive: Schema.optional(RelativePath),
  artifacts: Schema.Array(
    Schema.Struct({ id: ArtifactId, status: SpecArtifactSchema.fields.status, path: RelativePath }),
  ),
  progress: Schema.optional(TaskProgressSchema),
  proposal_reviews: Schema.optionalKey(Schema.Array(ProposalReviewView)),
  plan_brief: Schema.optional(PlanBriefSchema),
  steps: Schema.optional(PlanStepsSchema),
  proposal: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.Array(RelativePath)),
  planning: Schema.optional(PlanningObservationSchema),
});
const document = Schema.Struct({
  hash: Schema.optionalKey(ContentHash),
  generation: Schema.optionalKey(Count),
  path: Schema.Union([RelativePath, Schema.Literal("@report")]),
  content: Schema.String,
});
export type { WorkDiff, DiffScope } from "@abracode/contracts/visibility/document-contracts";
export { DiffScopeSchema } from "@abracode/contracts/visibility/document-contracts";
export type WorkDocument = typeof document.Type;
export type WorkItem = typeof work.Type;
export type WorkSnapshot = typeof snapshot.Type;
export type WorkDetail = typeof detail.Type;
export const WorkReportSchema = Schema.Struct({ content: Schema.String });
export const observerErrors = {
  not_found: Schema.Struct({ code: Schema.String }),
  resource_unavailable: Schema.Struct({ code: Schema.String }),
  invalid_selection: Schema.Struct({ code: Schema.String }),
};
const method = <I, O>(input: Schema.Codec<I, unknown>, output: Schema.Codec<O, unknown>) => ({
  input: input.annotate(exactParseOptions),
  output,
  errors: observerErrors,
});
// Native RPC methods decode their Effect codecs at the host boundary.
export const visibility = Rpc.define({
  id: "abracode-visibility",
  methods: {
    binding: method(BindingReadQuery, BindingReadSchema),
    evidenceSearch: method(EvidenceSearch, EvidenceSearchPage),
    sessions: method(SessionQuery, SessionPage),
    thoughtWork: method(ThoughtWorkQuery, ThoughtWorkPage),
    thoughtList: method(ThoughtQuery, ThoughtPage),
    thoughtDetail: method(ThoughtReference, ThoughtDetail),
    githubInbox: method(InboxQuery, InboxPage),
    githubItem: method(InboxTarget, InboxDetail),
    find: method(WorkDiscoveryQuery, WorkPageSchema),
    leads: method(LeadEvidenceQuery, LeadEvidencePageSchema),
    messages: method(WorkPageQuery, MessagesPageSchema),
    worker: method(WorkWorkerQuery, WorkerInspectionSchema),
    feedback: method(FeedbackQuery, FeedbackPageSchema),
    report: method(WorkQuery, WorkReportSchema),
    snapshot: method(Schema.Struct({ closed_page: Schema.optional(Count) }), snapshot),
    diff: method(
      Schema.Struct({
        issue_id: IssueId,
        scope: DiffScopeSchema,
        file: Schema.optional(RelativePath),
      }),
      diff,
    ),
    document: method(WorkDocumentQuery, document),
    evidence: method(EvidenceQuerySchema, EvidenceDataSchema),
    verification: method(WorkQuery, VerificationViewSchema),
    overview: method(WorkQuery, overview),
    detail: method(WorkQuery, detail),
  },
  events: {
    changed: {
      schema: Schema.Struct({ home: AbsolutePath, scope: Schema.optional(ChangeScopeSchema) }),
    },
  },
});

export {
  snapshot as WorkSnapshotSchema,
  overview as WorkOverviewSchema,
  detail as WorkDetailSchema,
  diff as WorkDiffSchema,
  document as WorkDocumentSchema,
};
