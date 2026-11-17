import {
  EvidenceReferenceSchema,
  VisualRenderRequestSchema,
  visualBuildFields,
} from "./report-metadata.ts";
export {
  EvidenceReferenceSchema,
  VisualRenderRequestSchema,
  VisualReceiptSchema,
  ReportDocumentReceiptSchema,
  ReportArtifactReceiptSchema,
  VisualBuildSummarySchema,
} from "./report-metadata.ts";
import { ReportSnapshotSchema } from "../presentation/report-evidence.ts";
import { ReportDocumentSchema } from "../presentation/report-document.ts";
import {
  MessageId,
  ReportId,
  IssueId,
  ExecutionId,
  SessionId,
  Fingerprint,
  ContentHash,
  AbsolutePath,
} from "../identities.ts";
import { Schema } from "effect";
import { NonEmpty, Commit, Count, Positive } from "../primitives.ts";
const text = NonEmpty.check(Schema.isMaxLength(16384));
const strings = Schema.Array(text).check(Schema.isMaxLength(64));
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

export const VisualBuildSchema = Schema.Struct({
  ...visualBuildFields,
  document_input: Schema.optional(ReportDocumentSchema),
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
  snapshot: ReportSnapshotSchema,
  staging: Schema.optional(AbsolutePath),
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
