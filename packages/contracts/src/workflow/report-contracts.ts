import { ReportSnapshotSchema } from "../presentation/report-evidence.ts";
import { ReportDocumentSchema, ReportProducerSchema } from "../presentation/report-document.ts";
import {
  RequestId,
  Timestamp,
  MessageId,
  ReportId,
  IssueId,
  ExecutionId,
  SessionId,
  Fingerprint,
  ContentHash,
  AbsolutePath,
  RelativePath,
} from "../identities.ts";
import { Schema } from "effect";
import { NonEmpty, Commit, Count, Positive } from "../primitives.ts";
const text = NonEmpty.check(Schema.isMaxLength(16384));
const strings = Schema.Array(text).check(Schema.isMaxLength(64));
export const EvidenceReferenceSchema = Schema.Struct({
  base: Schema.optional(Commit),
  path: Schema.optional(
    RelativePath.check(
      Schema.isNonEmpty(),
      Schema.makeFilter(
        (p) =>
          (!p.startsWith("/") &&
            !p.includes("\\") &&
            p.split("/").every((s) => s !== ".." && s !== "." && s !== "")) ||
          "Evidence path must be relative",
      ),
    ),
  ),
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
      surface_id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/)),
      revision: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
});
export const ReportEvidenceSchema = Schema.Struct({
  diagrams: ReportSnapshotSchema.fields.diagrams,
  conclusions: text,
  findings: Schema.Array(
    Schema.Struct({
      finding: text,
      evidence: Schema.Array(EvidenceReferenceSchema).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(64),
      ),
    }),
  ).check(Schema.isMaxLength(64)),
  acceptance: Schema.Array(
    Schema.Struct({ criterion: text, met: Schema.Boolean, evidence: text }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  limitations: strings,
});
export const ReportInputSchema = Schema.Struct({
  ...ReportEvidenceSchema.fields,
  render: Schema.optional(VisualRenderRequestSchema),
  report_id: ReportId,
  generation: Count,
});
export const ReportReceiptSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  issue_id: IssueId,
  execution_id: ExecutionId,
  report_id: ReportId,
  session_id: SessionId,
  base_commit: Commit,
  scope_fingerprint: Fingerprint,
  hash: ContentHash,
  bytes: Positive.check(Schema.isLessThanOrEqualTo(65536)),
  path: AbsolutePath,
});
export const ReportIntentSchema = Schema.Struct({
  evidence: Schema.optional(ReportEvidenceSchema),
  receipt: ReportReceiptSchema,
  content: NonEmpty.check(Schema.isMaxLength(65536)),
});

/** HTML is an optional attachment; Markdown research acceptance stays authoritative. */
export const VisualReceiptSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  request_id: RequestId,
  issue_id: IssueId,
  execution_id: ExecutionId,
  generation: Count,
  input_hash: ContentHash,
  template_hash: ContentHash,
  hash: ContentHash,
  bytes: Positive.check(Schema.isLessThanOrEqualTo(8 * 1024 * 1024)),
  path: AbsolutePath,
  observed_at: Timestamp,
  source_report: Schema.optional(Schema.Struct({ report_id: ReportId, hash: ContentHash })),
});
/** Existing untagged v1 receipts are retained HTML, never reinterpreted as JSON. */
export const ReportDocumentReceiptSchema = Schema.Struct({
  ...VisualReceiptSchema.fields,
  schema_version: Schema.Literal(2),
  format: Schema.Literal("a2ui-snapshot"),
  document_id: RequestId,
  revision: ReportDocumentSchema.fields.revision,
  catalog_id: Schema.String.check(Schema.isMaxLength(1024)),
  catalog_version: Positive,
  renderer_compatibility: Schema.String.check(Schema.isMaxLength(256)),
  bytes: Positive.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
});
export const ReportArtifactReceiptSchema = Schema.Union([
  ReportDocumentReceiptSchema,
  VisualReceiptSchema,
]);
export const VisualBuildSchema = Schema.Struct({
  format: Schema.optional(Schema.Literal("a2ui-snapshot")),
  document_hash: Schema.optional(ContentHash),
  document_input: Schema.optional(ReportDocumentSchema),
  source_attachment: Schema.optional(Schema.Literals(["associated", "unavailable"])),
  producing_call: Schema.optional(ReportProducerSchema),
  request: VisualRenderRequestSchema,
  generation: Count,
  requested_by: SessionId,
  notify_session: Schema.optional(SessionId),
  deadline_at: Schema.optional(Schema.Finite),
  notices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        phase: Schema.Literals(["published", "failed"]),
        message_id: MessageId,
        text: text,
        delivered: Schema.Boolean,
        associated: Schema.optional(Schema.Boolean),
      }),
    ).check(
      Schema.isMaxLength(2),
      Schema.makeFilter(
        (ns) =>
          (new Set(ns.map((n) => n.phase)).size === ns.length &&
            new Set(ns.map((n) => n.message_id)).size === ns.length) ||
          "Duplicate artifact notice phase",
      ),
    ),
  ),
  source_report: VisualReceiptSchema.fields.source_report,
  snapshot: ReportSnapshotSchema,
  input_hash: ContentHash,
  template_hash: ContentHash,
  status: Schema.Literals(["pending", "building", "validated", "published", "failed"]),
  artifact: Schema.optional(ReportArtifactReceiptSchema),
  staging: Schema.optional(AbsolutePath),
  error: Schema.optional(text),
}).check(
  Schema.makeFilter(
    (b) =>
      ((b.status !== "building" || b.deadline_at !== undefined) &&
        (!["validated", "published"].includes(b.status) || !!b.artifact) &&
        (!b.artifact ||
          (b.artifact.request_id === b.request.request_id &&
            b.artifact.input_hash === b.input_hash &&
            b.artifact.template_hash === b.template_hash &&
            b.artifact.generation === b.generation &&
            b.artifact.issue_id === b.snapshot.issue_id &&
            b.artifact.execution_id === b.snapshot.execution_id))) ||
      "Visual artifact identity does not match its captured input",
  ),
);
export type VisualBuild = typeof VisualBuildSchema.Type;
export const VisualBuildsSchema = Schema.Array(VisualBuildSchema).check(
  Schema.isMaxLength(16),
  Schema.makeFilter(
    (builds) =>
      new Set(builds.map((b) => b.request.request_id)).size === builds.length ||
      "Duplicate visual report request",
  ),
);
export const WorkReportInputSchema = Schema.Union([
  Schema.Struct({ issue_id: IssueId, action: Schema.optional(Schema.Literal("read")) }),
  Schema.Struct({ issue_id: IssueId, action: Schema.Literal("artifacts") }),
  Schema.Struct({
    issue_id: IssueId,
    action: Schema.Literal("generate"),
    ...VisualRenderRequestSchema.fields,
  }),
]);

const {
  document_input: _documentInput,
  snapshot: _snapshot,
  staging: _staging,
  notices: _notices,
  ...visualSummaryFields
} = VisualBuildSchema.fields;
export const VisualBuildSummarySchema = Schema.Struct({
  ...visualSummaryFields,
  request: Schema.Struct({ request_id: RequestId, title: VisualRenderRequestSchema.fields.title }),
});
