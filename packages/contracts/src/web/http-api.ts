import { PrepareDiagramSelectionSchema } from "./diagram-actions.ts";
import { AgentCatalogSchema } from "./agent-settings.ts";
import { DiagramPreparationSchema } from "../presentation/diagrams.ts";
import { BindingReadQuery, BindingReadSchema } from "./bindings.ts";
import { ReportExportSchema } from "../presentation/report-export-contract.ts";
import { LeadEvidenceQuery, LeadEvidencePageSchema } from "../visibility/lead-observation.ts";
import { WorkerHistoryQuery, WorkerHistoryPageSchema } from "./worker-history.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Shared contracts for the pinned Effect 4.1.4 HTTP API implementation. */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { ResourceSelectionSchema } from "./resources.ts";
import { WorkDiscoveryQuery, WorkPageSchema } from "../visibility/discovery-contracts.ts";
import {
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  WorkerInspectionSchema,
  MessagesPageSchema,
  FeedbackPageSchema,
  DecisionSchema,
  DeclaredWaitSchema,
  ArtifactsSchema,
  DocumentArtifactSchema,
  ArtifactSummarySchema,
} from "./wire.ts";
import { IssueId, RelativePath, SessionId, RequestId, ContentHash } from "../identities.ts";

export class WorkspaceError extends Schema.TaggedError<
  WorkspaceError,
  { readonly brand: unique symbol }
>()(
  "WorkspaceError",
  {
    code: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}
export class WorkspaceForbidden extends Schema.TaggedError<
  WorkspaceForbidden,
  { readonly brand: unique symbol }
>()(
  "WorkspaceForbidden",
  {
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}
export {
  ReceiptSchema,
  TranscriptMessageSchema,
  ReceiptQuerySchema,
  ReceiptLookupSchema,
  CheckpointSchema,
  SurfaceRecordSchema,
  WorkspaceSnapshotSchema,
} from "./workspace-wire.ts";
export { SurfaceSchema } from "./surfaces.ts";
export type { SubmissionReceipt } from "./workspace-wire.ts";
import {
  TranscriptMessageSchema,
  ReceiptQuerySchema,
  ReceiptLookupSchema,
  WorkspaceSnapshotSchema,
  PresentationPageSchema,
  SurfaceEntrySchema,
} from "./workspace-wire.ts";
import { ComponentId } from "./catalog.ts";
import { SaveSurfaceSchema, ExportDocumentSchema, ReadExportSchema } from "./report-actions.ts";
export const HistorySchema = Schema.Struct({
  messages: Schema.Array(TranscriptMessageSchema),
  older: Schema.optional(Schema.String),
  presentations: Schema.optional(PresentationPageSchema),
});
export const DecisionsSchema = Schema.Struct({
  decisions: Schema.Array(DecisionSchema),
  waits: Schema.Array(DeclaredWaitSchema),
});
const identity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
const exact = { parseOptions: { onExcessProperty: "error" as const }, reportInput: false };
export const FormReplySchema = Schema.Struct({
  id: Form.ID,
  binding: identity,
  answer: Form.Answer,
}).annotate(exact);
export const PermissionReplySchema = Schema.Struct({
  id: Permission.ID,
  binding: identity,
  decision: Permission.Reply,
}).annotate(exact);
export const WorkQuery = Schema.Struct({ issue_id: IssueId }).annotate(exact);
const error = [WorkspaceError, WorkspaceForbidden] as const;
export const ArtifactQuery = Schema.Struct({ issue_id: IssueId, request_id: RequestId }).annotate(
  exact,
);
const html = Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" }));
const documentQuery = Schema.Struct({
  issue_id: IssueId,
  request_id: RequestId,
  hash: ContentHash,
}).annotate(exact);
const documentJSON = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
);

export const workspaceApi = HttpApi.make("abra-workspace")
  .add(
    HttpApiGroup.make("workspace").add(
      HttpApiEndpoint.get("agents", "/api/settings/agents", {
        success: AgentCatalogSchema,
        error,
      }),
      HttpApiEndpoint.post("prepareDiagrams", "/api/diagrams/prepare", {
        payload: PrepareDiagramSelectionSchema,
        success: DiagramPreparationSchema,
        error,
      }),
      HttpApiEndpoint.get("surface", "/api/surface", {
        query: Schema.Struct({
          surface_id: ComponentId,
          revision: Schema.Int.check(Schema.isGreaterThan(0)),
        }),
        success: SurfaceEntrySchema,
        error,
      }),
      HttpApiEndpoint.get("bootstrap", "/api/bootstrap", {
        disableCodecs: true,
        success: WorkspaceSnapshotSchema,
        error,
      }),
      HttpApiEndpoint.get("history", "/api/history", {
        query: Schema.Struct({ cursor: identity }).annotate(exact),
        success: HistorySchema,
        error,
      }),
      HttpApiEndpoint.get("receipt", "/api/admission/receipt", {
        query: ReceiptQuerySchema,
        success: ReceiptLookupSchema,
        error,
      }),
      HttpApiEndpoint.post("replyForm", "/api/form/reply", {
        payload: FormReplySchema,
        success: Schema.Struct({ status: Schema.Literal("answered") }),
        error,
      }),
      HttpApiEndpoint.post("replyPermission", "/api/permission/reply", {
        payload: PermissionReplySchema,
        success: Schema.Struct({ status: Schema.Literal("answered") }),
        error,
      }),
      HttpApiEndpoint.post("stop", "/api/abra/stop", {
        payload: Schema.Struct({}).annotate(exact),
        success: Schema.Struct({ stopped: Schema.Boolean }),
        error,
      }),
    ),
    HttpApiGroup.make("work").add(
      HttpApiEndpoint.get("binding", "/api/work/binding", {
        query: BindingReadQuery,
        success: BindingReadSchema,
        error,
      }),
      HttpApiEndpoint.get("find", "/api/work/find", {
        query: WorkDiscoveryQuery,
        success: WorkPageSchema,
        error,
      }),
      HttpApiEndpoint.post("resolve", "/api/work/resolve", {
        payload: ResourceSelectionSchema,
        success: ResourceSelectionSchema,
        error,
      }),
      HttpApiEndpoint.get("detail", "/api/work/detail", {
        query: WorkQuery,
        success: WorkDetailSchema,
        error,
      }),
      HttpApiEndpoint.get("document", "/api/work/document", {
        query: Schema.Struct({ issue_id: IssueId, path: RelativePath }).annotate(exact),
        success: WorkDocumentSchema,
        error,
      }),
      HttpApiEndpoint.get("diff", "/api/work/diff", {
        query: Schema.Struct({
          issue_id: IssueId,
          file: Schema.optional(RelativePath),
          scope: Schema.optional(Schema.Literals(["all", "uncommitted"])),
        }).annotate(exact),
        success: WorkDiffSchema,
        error,
      }),
      HttpApiEndpoint.get("worker", "/api/work/worker", {
        query: Schema.Struct({ issue_id: IssueId, session_id: SessionId }).annotate(exact),
        success: WorkerInspectionSchema,
        error,
      }),
      HttpApiEndpoint.get("worker-history", "/api/work/worker-history", {
        query: WorkerHistoryQuery.annotate(exact),
        success: WorkerHistoryPageSchema,
        error,
      }),
      HttpApiEndpoint.get("leads", "/api/work/leads", {
        query: LeadEvidenceQuery.annotate(exact),
        success: LeadEvidencePageSchema,
        error,
      }),
      HttpApiEndpoint.get("messages", "/api/work/messages", {
        query: Schema.Struct({
          issue_id: IssueId,
          offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        }).annotate(exact),
        success: MessagesPageSchema,
        error,
      }),
      HttpApiEndpoint.get("feedback", "/api/work/feedback", {
        query: Schema.Struct({
          issue_id: IssueId,
          page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        }).annotate(exact),
        success: FeedbackPageSchema,
        error,
      }),
      HttpApiEndpoint.get("report", "/api/work/report", {
        query: WorkQuery,
        success: WorkReportSchema,
        error,
      }),
      HttpApiEndpoint.get("artifacts", "/api/work/artifacts", {
        query: Schema.Struct({
          issue_id: IssueId,
          offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        }).annotate(exact),
        success: ArtifactsSchema,
        error,
      }),
      HttpApiEndpoint.get("artifactSummary", "/api/work/artifact-summary", {
        query: documentQuery,
        success: ArtifactSummarySchema,
        error,
      }),
      HttpApiEndpoint.get("artifactDocument", "/api/work/artifact-document", {
        query: documentQuery,
        success: DocumentArtifactSchema,
        error,
      }),
      HttpApiEndpoint.post("exportDocument", "/api/report/export", {
        payload: ExportDocumentSchema,
        success: ReportExportSchema,
        error,
      }),
      HttpApiEndpoint.get("exportPreview", "/api/report/export/preview", {
        query: ReadExportSchema,
        success: html,
        error,
      }),
      HttpApiEndpoint.get("exportDownload", "/api/report/export/download", {
        query: ReadExportSchema,
        success: HttpApiSchema.WithHeaders(html, { "content-disposition": Schema.String }),
        error,
      }),
      HttpApiEndpoint.post("saveSurface", "/api/report/save-surface", {
        payload: SaveSurfaceSchema,
        success: ArtifactSummarySchema,
        error,
      }),
      HttpApiEndpoint.get("downloadDocument", "/api/report/document/download", {
        query: documentQuery,
        success: HttpApiSchema.WithHeaders(documentJSON, { "content-disposition": Schema.String }),
        error,
      }),
      HttpApiEndpoint.get("preview", "/api/report/preview", {
        query: ArtifactQuery,
        success: html,
        error,
      }),
      HttpApiEndpoint.get("download", "/api/report/download", {
        query: ArtifactQuery,
        success: HttpApiSchema.WithHeaders(html, { "content-disposition": Schema.String }),
        error,
      }),
      HttpApiEndpoint.get("decisions", "/api/work/decisions", {
        query: WorkQuery,
        success: DecisionsSchema,
        error,
      }),
    ),
  )
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error", reportInput: false })
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", reportInput: false });

/** Fixed retained-work reads. Types follow the HTTP owner, including decoded numeric queries. */
export type WorkReadName =
  | "binding"
  | "find"
  | "leads"
  | "detail"
  | "document"
  | "diff"
  | "worker"
  | "worker-history"
  | "messages"
  | "feedback"
  | "report"
  | "decisions"
  | "artifacts"
  | "artifactDocument"
  | "artifactSummary";
type WorkEndpoints = typeof workspaceApi.groups.work.endpoints;
export type WorkReadInput<K extends WorkReadName> = WorkEndpoints[K]["~Query"]["Type"];
export type WorkReadOutput<K extends WorkReadName> = WorkEndpoints[K]["~Success"]["Type"];
