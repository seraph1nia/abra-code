import { Schema } from "effect";
import { ReportSnapshotSchema } from "../presentation/report-evidence.ts";
import {
  RequestId,
  Timestamp,
  MessageId,
  ReportId,
  IssueId,
  ExecutionId,
  SessionId,
  ContentHash,
  AbsolutePath,
  SafeRelativePath,
  Identifier,
} from "../identities.ts";
import { NonEmpty, Commit, Count, Positive } from "../primitives.ts";
const text = NonEmpty.check(Schema.isMaxLength(16384));
export const ReportRevisionSchema = Schema.Int.check(Schema.isGreaterThan(0));
export const ReportProducerSchema = Schema.Struct({
  session_id: SessionId,
  message_id: MessageId,
  tool_call_id: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512)),
});
// Compact browser metadata must not import full document/build validation.
export const EvidenceReferenceSchema = Schema.Struct({
  base: Schema.optional(Commit),
  path: Schema.optional(SafeRelativePath),
  line: Schema.optional(Positive),
  url: Schema.optional(NonEmpty.check(Schema.isPattern(/^https?:\/\//))),
}).check(
  Schema.makeFilter(
    (r) => !!r.url || (!!r.path && !!r.base) || "Evidence requires a URL or base/path identity",
  ),
);
export const VisualRenderRequestSchema = Schema.Struct({
  format: Schema.optional(Schema.Literal("a2ui-snapshot")),
  diagrams: ReportSnapshotSchema.fields.diagrams,
  request_id: RequestId,
  title: Schema.optional(text),
  surface: Schema.optional(
    Schema.Struct({
      surface_id: Identifier,
      revision: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
});
export const ReportDocumentReceiptSchema = Schema.Struct({
  request_id: RequestId,
  issue_id: IssueId,
  execution_id: ExecutionId,
  generation: Count,
  input_hash: ContentHash,
  template_hash: ContentHash,
  hash: ContentHash,
  path: AbsolutePath,
  observed_at: Timestamp,
  source_report: Schema.optional(Schema.Struct({ report_id: ReportId, hash: ContentHash })),
  schema_version: Schema.Literal(2),
  format: Schema.Literal("a2ui-snapshot"),
  document_id: RequestId,
  revision: ReportRevisionSchema,
  catalog_id: Schema.String.check(Schema.isMaxLength(1024)),
  catalog_version: Positive,
  renderer_compatibility: Schema.String.check(Schema.isMaxLength(256)),
  bytes: Positive.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
});
export const ReportArtifactReceiptSchema = ReportDocumentReceiptSchema;
export const visualBuildFields = {
  format: Schema.Literal("a2ui-snapshot"),
  document_hash: Schema.optional(ContentHash),
  source_attachment: Schema.optional(Schema.Literals(["associated", "unavailable"])),
  producing_call: Schema.optional(ReportProducerSchema),
  request: VisualRenderRequestSchema,
  generation: Count,
  requested_by: SessionId,
  notify_session: Schema.optional(SessionId),
  source_report: ReportDocumentReceiptSchema.fields.source_report,
  input_hash: ContentHash,
  template_hash: ContentHash,
  status: Schema.Union([
    Schema.Literals(["pending", "validated", "published", "failed"]),
    Schema.Literal("building").transform("pending"),
  ]),
  artifact: Schema.optional(ReportArtifactReceiptSchema),
  error: Schema.optional(text),
};
export const VisualBuildSummarySchema = Schema.Struct({
  ...visualBuildFields,
  request: Schema.Struct({ request_id: RequestId, title: VisualRenderRequestSchema.fields.title }),
});
