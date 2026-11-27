import { PlanStepsSchema, TaskIntentSchema } from "../visibility/document-contracts.ts";
import { ThoughtSource } from "../visibility/thoughts.ts";
import { FilePatchId } from "./resources.ts";
import { Count } from "../primitives.ts";
import { LeadAttentionSchema } from "../visibility/lead-observation.ts";
import { PlanningObservationSchema } from "../visibility/document-contracts.ts";
import { WorkSummarySchema as WorkItemSchema } from "../visibility/work-summary.ts";
import { SupervisionAggregateSchema } from "../visibility/supervision.ts";
import { FleetSchema } from "../visibility/fleet.ts";
export { MessagesPageSchema } from "../workflow/message-contracts.ts";
export { FeedbackPageSchema } from "../workflow/feedback-contracts.ts";
export { WorkerInspectionSchema } from "../visibility/worker.ts";
import { Schema } from "effect";
import { RelativePath, Timestamp, ContentHash } from "../identities.ts";
import {
  VisualBuildSummarySchema,
  ReportDocumentReceiptSchema,
} from "../workflow/report-metadata.ts";

/** Browser projections deliberately contain data only, without controller/adaptor imports. */
const strings = Schema.Array(Schema.String);
export {
  DecisionObservationSchema as DecisionSchema,
  WaitObservationSchema as DeclaredWaitSchema,
} from "../workflow/obligation-summary.ts";
export {
  WorkSummarySchema as WorkItemSchema,
  type WorkSummary as WebWorkItem,
} from "../visibility/work-summary.ts";
export const WorkSnapshotSchema = Schema.Struct({
  fleet: Schema.optional(FleetSchema),
  management: Schema.optional(LeadAttentionSchema),
  supervision: Schema.optional(SupervisionAggregateSchema),
  home: Schema.String,
  at: Timestamp,
  work: Schema.Array(WorkItemSchema),
  work_revision: Schema.optional(Schema.String),
  closed_total: Schema.optional(Count),
  closed_page: Schema.optional(Count),
});
export const WorkOverviewSchema = Schema.Struct({
  work: WorkItemSchema,
  description: Schema.String,
  intent: Schema.optional(TaskIntentSchema),
  thought_source: Schema.optional(ThoughtSource),
  errors: strings,
});
export const WorkDetailSchema = Schema.Struct({
  ...WorkOverviewSchema.fields,
  change: Schema.optional(Schema.String),
  archive: Schema.optional(RelativePath),
  artifacts: Schema.Array(
    Schema.Struct({ id: Schema.String, status: Schema.String, path: RelativePath }),
  ),
  steps: Schema.optional(PlanStepsSchema),
  proposal: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.Array(RelativePath)),
  planning: Schema.optional(PlanningObservationSchema),
  progress: Schema.optional(Schema.Struct({ total: Count, complete: Count, remaining: Count })),
});
export const WorkDiffSchema = Schema.Struct({
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  at: Timestamp,
  historical: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      patch_id: FilePatchId,
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
export const WorkDocumentSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  hash: Schema.optionalKey(ContentHash),
  generation: Schema.optionalKey(Count),
});
export const WorkReportSchema = Schema.Union([
  Schema.Struct({ content: Schema.String }),
  Schema.Struct({ unavailable: Schema.Literals(["not_started", "not_published"]) }),
]);
export const ArtifactSummarySchema = Schema.Struct({
  format: Schema.Literal("a2ui-snapshot"),
  request_id: VisualBuildSummarySchema.fields.request.fields.request_id,
  title: VisualBuildSummarySchema.fields.request.fields.title,
  status: VisualBuildSummarySchema.fields.status,
  generation: VisualBuildSummarySchema.fields.generation,
  hash: Schema.optional(ReportDocumentReceiptSchema.fields.hash),
  bytes: Schema.optional(ReportDocumentReceiptSchema.fields.bytes),
  captured_at: Schema.optional(ReportDocumentReceiptSchema.fields.observed_at),
  error: Schema.optional(Schema.String),
});
export const artifactPageSize = 8;
export const ArtifactsSchema = Schema.Struct({
  artifacts: Schema.Array(ArtifactSummarySchema),
  total: Schema.optional(Count),
  offset: Schema.optional(Count),
  limit: Schema.optional(Count),
  next_offset: Schema.optional(Count),
});
export const DocumentArtifactSchema = Schema.Struct({
  json: Schema.String.check(Schema.isMaxLength(1024 * 1024)),
  hash: ReportDocumentReceiptSchema.fields.hash,
  bytes: Count.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
});
