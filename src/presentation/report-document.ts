import { Schema } from "effect";
import {
  IssueId,
  ExecutionId,
  RequestId,
  ReportId,
  SessionId,
  MessageId,
  ContentHash,
  Timestamp,
} from "../identities.ts";
import { Count, Commit } from "../contracts.ts";
import { WorkSummarySchema } from "../visibility/work-summary.ts";
import { ReportSnapshotSchema } from "./report-evidence.ts";
import { SurfaceSchema, validateSurface } from "../web/surfaces.ts";
import { catalogId, ComponentId } from "../web/catalog.ts";

export const maximumDocumentBytes = 1024 * 1024;
export const reportRendererVersion = "abracode-react/v1";
export const reportCatalogVersion = 1;
export const ReportProducerSchema = Schema.Struct({
  session_id: SessionId,
  message_id: MessageId,
  tool_call_id: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512)),
});
export type ReportProducer = typeof ReportProducerSchema.Type;
const text = Schema.String.check(Schema.isMaxLength(16384));
const positive = Schema.Int.check(Schema.isGreaterThan(0));
const withinBytes = (value: unknown, maximum: number) =>
  new TextEncoder().encode(JSON.stringify(value)).length <= maximum;

export const FrozenReportDataSchema = Schema.Struct({
  work: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(100)),
  snapshot_work: Schema.optionalKey(Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(100))),
  evidence: Schema.optionalKey(ReportSnapshotSchema),
}).check(
  Schema.makeFilter(
    (value) => withinBytes(value, 512 * 1024) || "Captured report data exceeds 512 KiB",
  ),
);

/** The immutable document is independent of native execution/form authority. */
export const ReportDocumentSchema = Schema.Struct({
  format: Schema.Literal("a2ui-snapshot"),
  format_version: Schema.Literal(1),
  document_id: RequestId,
  revision: positive,
  title: text.check(Schema.isNonEmpty()),
  captured_at: Timestamp,
  catalog_id: Schema.Literal(catalogId),
  catalog_version: Schema.Literal(reportCatalogVersion),
  renderer_compatibility: Schema.Literal(reportRendererVersion),
  provenance: Schema.Struct({
    issue_id: IssueId,
    execution_id: ExecutionId,
    generation: Count,
    source_call: Schema.optionalKey(ReportProducerSchema),
    source_commit: Schema.optionalKey(Commit),
    source_report: Schema.optionalKey(Schema.Struct({ report_id: ReportId, hash: ContentHash })),
    source_surface: Schema.optionalKey(
      Schema.Struct({
        session_id: SessionId,
        surface_id: ComponentId,
        revision: positive,
        hash: ContentHash,
      }),
    ),
  }),
  surface: SurfaceSchema,
  data: FrozenReportDataSchema,
  limitations: Schema.Array(text).check(Schema.isMaxLength(64)),
}).check(
  Schema.makeFilter((document) => {
    if (!withinBytes(document, maximumDocumentBytes)) return "Report document exceeds 1 MiB";
    if (
      document.data.evidence &&
      (document.data.evidence.issue_id !== document.provenance.issue_id ||
        document.data.evidence.execution_id !== document.provenance.execution_id)
    )
      return "Captured report evidence belongs to another execution";
    if (
      [document.data.work, document.data.snapshot_work ?? []].some(
        (rows) => new Set(rows.map((work) => work.issue_id)).size !== rows.length,
      )
    )
      return "Repeated captured work identity";
    try {
      validateSurface(
        document.surface,
        new Set(
          [...document.data.work, ...(document.data.snapshot_work ?? [])].map(
            (work) => work.issue_id,
          ),
        ),
      );
      return true;
    } catch {
      return "Report layout references uncaptured work or an invalid component";
    }
  }),
);
export type ReportDocument = typeof ReportDocumentSchema.Type;
export function validateReportDocument(value: unknown) {
  return Schema.decodeUnknownSync(ReportDocumentSchema, {
    onExcessProperty: "error",
    reportInput: false,
  })(value);
}

/** Unsupported bytes stay intact in owned storage and remain downloadable. */
export function readReportDocument(
  json: string,
): { supported: true; document: ReportDocument } | { supported: false; reason: string } {
  if (new TextEncoder().encode(json).length > maximumDocumentBytes)
    throw new Error("Report document exceeds 1 MiB");
  const raw = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(JSON.parse(json));
  if (raw.format !== "a2ui-snapshot" || raw.format_version !== 1)
    return {
      supported: false,
      reason: "This report format version is not supported by this viewer.",
    };
  if (
    raw.catalog_id !== catalogId ||
    raw.catalog_version !== reportCatalogVersion ||
    raw.renderer_compatibility !== reportRendererVersion
  )
    return {
      supported: false,
      reason: "This report requires an unsupported catalog or renderer version.",
    };
  return { supported: true, document: validateReportDocument(raw) };
}
