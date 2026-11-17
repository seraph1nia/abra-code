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
import { RelativePath, Timestamp } from "../identities.ts";
import { VisualBuildSummarySchema, VisualReceiptSchema } from "../workflow/report-metadata.ts";

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
export const WorkDetailSchema = Schema.Struct({
  work: WorkItemSchema,
  description: Schema.String,
  change: Schema.optional(Schema.String),
  archive: Schema.optional(RelativePath),
  artifacts: Schema.Array(
    Schema.Struct({ id: Schema.String, status: Schema.String, path: RelativePath }),
  ),
  proposal: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.Array(RelativePath)),
  planning: Schema.optional(PlanningObservationSchema),
  errors: strings,
  progress: Schema.optional(Schema.Struct({ total: Count, complete: Count, remaining: Count })),
});
export const WorkDiffSchema = Schema.Struct({
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
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
export const WorkDocumentSchema = Schema.Struct({ path: Schema.String, content: Schema.String });
export const WorkReportSchema = Schema.Struct({ content: Schema.String });
export const ArtifactSummarySchema = Schema.Struct({
  format: Schema.optional(Schema.Literals(["legacy-html", "a2ui-snapshot"])),
  request_id: VisualBuildSummarySchema.fields.request.fields.request_id,
  title: VisualBuildSummarySchema.fields.request.fields.title,
  status: VisualBuildSummarySchema.fields.status,
  generation: VisualBuildSummarySchema.fields.generation,
  hash: Schema.optional(VisualReceiptSchema.fields.hash),
  bytes: Schema.optional(VisualReceiptSchema.fields.bytes),
  captured_at: Schema.optional(VisualReceiptSchema.fields.observed_at),
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
export const ArtifactSchema = Schema.Struct({
  html: Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)),
  hash: Schema.String,
  bytes: Count,
});
export const DocumentArtifactSchema = Schema.Struct({
  json: Schema.String.check(Schema.isMaxLength(1024 * 1024)),
  hash: VisualReceiptSchema.fields.hash,
  bytes: Count.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
});
