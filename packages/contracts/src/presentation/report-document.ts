import { ReportProducerSchema, ReportRevisionSchema } from "../workflow/report-metadata.ts";
export { ReportProducerSchema } from "../workflow/report-metadata.ts";
import { collectDiagrams, diagramBudget } from "./diagrams.ts";
import { BindingCoverageSchema } from "../web/bindings.ts";
import { Schema } from "effect";
import {
  IssueId,
  ExecutionId,
  RequestId,
  ReportId,
  SessionId,
  ContentHash,
  Timestamp,
} from "../identities.ts";
import { Count, Commit } from "../primitives.ts";
import { WorkSummarySchema } from "../visibility/work-summary.ts";
import { ReportSnapshotSchema, LegacyReportSnapshotSchema } from "./report-evidence.ts";
import { SurfaceSchema, validateSurfaceWorkIds } from "../web/surfaces.ts";
import {
  catalogId,
  catalogV1Id,
  catalogV2Id,
  catalogV3Id,
  catalogV4Id,
  catalogIds,
  ComponentId,
} from "../web/catalog.ts";

export const maximumDocumentBytes = 1024 * 1024;
export const reportRendererVersion = "abracode-react/v5";
export const reportCatalogs = {
  [catalogV1Id]: { catalog_version: 1, renderer_compatibility: "abracode-react/v1" },
  [catalogV2Id]: { catalog_version: 2, renderer_compatibility: "abracode-react/v2" },
  [catalogV3Id]: { catalog_version: 3, renderer_compatibility: "abracode-react/v3" },
  [catalogV4Id]: { catalog_version: 4, renderer_compatibility: "abracode-react/v4" },
  [catalogId]: { catalog_version: 5, renderer_compatibility: reportRendererVersion },
} as const;
export type ReportProducer = typeof ReportProducerSchema.Type;
const text = Schema.String.check(Schema.isMaxLength(16384));
const positive = ReportRevisionSchema;
const withinBytes = (value: unknown, maximum: number) =>
  new TextEncoder().encode(JSON.stringify(value)).length <= maximum;

export const FrozenReportDataSchema = Schema.Struct({
  work: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(100)),
  snapshot_work: Schema.optionalKey(Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(100))),
  evidence: Schema.optionalKey(ReportSnapshotSchema),
  live_coverage: Schema.optionalKey(BindingCoverageSchema),
  snapshot_coverage: Schema.optionalKey(BindingCoverageSchema),
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
  catalog_id: Schema.Literals(catalogIds),
  catalog_version: Schema.Literals([1, 2, 3, 4, 5]),
  renderer_compatibility: Schema.Literals([
    "abracode-react/v1",
    "abracode-react/v2",
    "abracode-react/v3",
    "abracode-react/v4",
    reportRendererVersion,
  ]),
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
    const identity = reportCatalogs[document.catalog_id];
    if (
      document.catalog_version !== identity.catalog_version ||
      document.renderer_compatibility !== identity.renderer_compatibility ||
      document.surface.createSurface.catalogId !== document.catalog_id
    )
      return "Inconsistent report catalog/renderer identity";
    if (
      document.catalog_id === catalogV1Id &&
      document.data.evidence &&
      !Schema.is(LegacyReportSnapshotSchema)(document.data.evidence)
    )
      return "Historical report evidence exceeds its original contract";
    const budget = diagramBudget(
      collectDiagrams(document.surface.createSurface.components, document.data.evidence),
    );
    if (budget) return budget;
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
      validateSurfaceWorkIds(
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
    !catalogIds.some(
      (id) =>
        id === raw.catalog_id &&
        raw.catalog_version === reportCatalogs[id].catalog_version &&
        raw.renderer_compatibility === reportCatalogs[id].renderer_compatibility,
    )
  )
    return {
      supported: false,
      reason: "This report requires an unsupported catalog or renderer version.",
    };
  return { supported: true, document: validateReportDocument(raw) };
}
