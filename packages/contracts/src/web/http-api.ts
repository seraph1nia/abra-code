import { DiffScopeSchema } from "../visibility/document-contracts.ts";
import { FeedbackQuery } from "../workflow/feedback-contracts.ts";
import {
  ScopedMemorySearch,
  ScopedMemoryRead,
  MemoryPage,
  MemoryBody,
  MemoryPublication,
  MemoryReference,
} from "../visibility/memory.ts";
import { PublicationPage, PublicationQuery } from "../presentation/contracts.ts";
import {
  WorkQuery,
  WorkDocumentQuery,
  WorkWorkerQuery,
  WorkPageQuery,
  EvidenceSearch,
  EvidenceSearchPage,
  SessionQuery,
  SessionPage,
} from "../visibility/discovery-contracts.ts";
import { ThoughtWorkQuery, ThoughtWorkPage } from "../visibility/thoughts.ts";
import {
  ThoughtQuery,
  ThoughtPage,
  ThoughtReference,
  ThoughtDetail,
} from "../visibility/thoughts.ts";
import { InboxQuery, InboxPage, InboxTarget, InboxDetail } from "../visibility/github-inbox.ts";
import { EvidenceDataSchema, EvidenceQuerySchema } from "./worker-evidence.ts";
import { VerificationViewSchema } from "./verification.ts";
import { PrepareDiagramSelectionSchema } from "./diagram-actions.ts";
import { AgentCatalogSchema } from "./agent-settings.ts";
import { DiagramPreparationSchema } from "../presentation/diagrams.ts";
import { BindingReadQuery, BindingReadSchema } from "./bindings.ts";
import { ReportExportSchema } from "../presentation/report-export-contract.ts";
import { LeadEvidenceQuery, LeadEvidencePageSchema } from "../visibility/lead-observation.ts";
import { WorkerHistoryQuery, WorkerHistoryPageSchema } from "./worker-history.ts";
import { Effect, Schema, Struct } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { ResourceSelectionSchema } from "./resources.ts";
import { WorkDiscoveryQuery, WorkPageSchema } from "../visibility/discovery-contracts.ts";
import {
  WorkOverviewSchema,
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
import { RelativePath, SessionId } from "../identities.ts";
import { exactParseOptions as exact } from "../primitives.ts";

const errorFields = { code: Schema.String, message: Schema.String };
export class WorkspaceError extends Schema.TaggedError<
  WorkspaceError,
  { readonly brand: unique symbol }
>()("WorkspaceError", errorFields, { httpApiStatus: 409 }) {}
export class WorkspaceUnavailable extends Schema.TaggedError<
  WorkspaceUnavailable,
  { readonly brand: unique symbol }
>()("WorkspaceUnavailable", errorFields, { httpApiStatus: 503 }) {}
export class WorkspaceNotFound extends Schema.TaggedError<
  WorkspaceNotFound,
  { readonly brand: unique symbol }
>()("WorkspaceNotFound", errorFields, { httpApiStatus: 404 }) {}
export class WorkspaceBadRequest extends Schema.TaggedError<
  WorkspaceBadRequest,
  { readonly brand: unique symbol }
>()("WorkspaceBadRequest", errorFields, { httpApiStatus: 400 }) {}
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
  ReceiptSchema,
  SubmissionSchema,
  WorkspaceSnapshotSchema,
  ProjectsSchema,
  PresentationPageSchema,
  SurfaceEntrySchema,
} from "./workspace-wire.ts";
import {
  ReviewSelectionSchema,
  ReviewViewSchema,
  ReviewListQuerySchema,
  ReviewListSchema,
  ReviewAssetQuerySchema,
  ReviewAssetDataSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  ReviewResponseQuerySchema,
  ReviewReceiptLookupSchema,
} from "./reviews.ts";
import { SurfaceId } from "./catalog.ts";
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
export { WorkQuery } from "../visibility/discovery-contracts.ts";
const error = [
  WorkspaceBadRequest,
  WorkspaceNotFound,
  WorkspaceUnavailable,
  WorkspaceError,
  WorkspaceForbidden,
] as const;
function apiGet<
  const Name extends string,
  const Path extends `/${string}`,
  S extends Schema.Top,
  Q extends Schema.Top = never,
>(name: Name, path: Path, options: { success: S; query?: Q }) {
  return HttpApiEndpoint.get(name, path, { ...options, error });
}
function apiPost<
  const Name extends string,
  const Path extends `/${string}`,
  S extends Schema.Top,
  P extends Schema.Top,
>(name: Name, path: Path, options: { success: S; payload: P }) {
  return HttpApiEndpoint.post(name, path, { ...options, error });
}
const html = Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" }));
const documentJSON = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "application/json; charset=utf-8" }),
);

export const reviewGroup = HttpApiGroup.make("reviews").add(
  apiGet("reviewReceipt", "/api/review/receipt", {
    query: ReviewResponseQuerySchema,
    success: ReviewReceiptLookupSchema,
  }),
  apiGet("reviewList", "/api/reviews", {
    query: ReviewListQuerySchema,
    success: ReviewListSchema,
  }),
  apiGet("review", "/api/review", {
    query: ReviewSelectionSchema,
    success: ReviewViewSchema,
  }),
  apiGet("reviewAsset", "/api/review/asset", {
    query: ReviewAssetQuerySchema,
    success: ReviewAssetDataSchema,
  }),
  apiPost("reviewSubmit", "/api/review/submit", {
    payload: ReviewSubmitSchema,
    success: ReviewReceiptSchema,
  }),
);

export const workspaceApi = HttpApi.make("abra-workspace")
  .add(
    HttpApiGroup.make("workspace").add(
      apiGet("agents", "/api/settings/agents", {
        success: AgentCatalogSchema,
      }),
      apiGet("repositories", "/api/settings/repositories", {
        success: ProjectsSchema,
      }),
      apiPost("prepareDiagrams", "/api/diagrams/prepare", {
        payload: PrepareDiagramSelectionSchema,
        success: DiagramPreparationSchema,
      }),
      apiGet("publications", "/api/search/publications", {
        query: PublicationQuery.annotate(exact),
        success: PublicationPage,
      }),
      apiGet("surface", "/api/surface", {
        query: Schema.Struct({
          session_id: Schema.optionalKey(SessionId),
          surface_id: SurfaceId,
          revision: Schema.Int.check(Schema.isGreaterThan(0)),
        }),
        success: SurfaceEntrySchema,
      }),
      HttpApiEndpoint.get("bootstrap", "/api/bootstrap", {
        error,
        disableCodecs: true,
        success: WorkspaceSnapshotSchema,
      }),
      apiGet("history", "/api/history", {
        query: Schema.Struct({ cursor: identity }).annotate(exact),
        success: HistorySchema,
      }),
      apiGet("receipt", "/api/admission/receipt", {
        query: ReceiptQuerySchema,
        success: ReceiptLookupSchema,
      }),
      apiPost("submit", "/api/abra/submit", {
        payload: SubmissionSchema.annotate(exact),
        success: ReceiptSchema,
      }),
      apiPost("replyForm", "/api/form/reply", {
        payload: FormReplySchema,
        success: Schema.Struct({ status: Schema.Literal("answered") }),
      }),
      apiPost("replyPermission", "/api/permission/reply", {
        payload: PermissionReplySchema,
        success: Schema.Struct({ status: Schema.Literal("answered") }),
      }),
      apiGet("memorySearch", "/api/memory/search", {
        query: ScopedMemorySearch.annotate(exact),
        success: MemoryPage,
      }),
      apiPost("memoryRead", "/api/memory/read", {
        payload: ScopedMemoryRead.annotate(exact),
        success: MemoryBody,
      }),
      apiPost("memoryPublish", "/api/memory/publish", {
        payload: MemoryPublication.annotate(exact),
        success: MemoryReference,
      }),
      apiGet("memoryEnabled", "/api/memory/enabled", {
        success: Schema.Boolean,
      }),
    ),
    HttpApiGroup.make("work")
      .add(
        apiGet("binding", "/binding", {
          // URL search parameters omit empty arrays on an all-work read.
          query: Schema.Struct({
            ...BindingReadQuery.fields,
            issue_ids: BindingReadQuery.fields.issue_ids.pipe(
              Schema.withDecodingDefaultKey(Effect.succeed([])),
            ),
          }).annotate(exact),
          success: BindingReadSchema,
        }),
        apiGet("evidenceSearch", "/search/evidence", {
          query: EvidenceSearch.annotate(exact),
          success: EvidenceSearchPage,
        }),
        apiGet("sessions", "/sessions", {
          query: SessionQuery.annotate(exact),
          success: SessionPage,
        }),
        apiGet("githubInbox", "/github", {
          query: InboxQuery,
          success: InboxPage,
        }),
        apiGet("githubItem", "/github/item", {
          query: InboxTarget,
          success: InboxDetail,
        }),
        apiGet("find", "/find", {
          query: WorkDiscoveryQuery,
          success: WorkPageSchema,
        }),
        apiPost("resolve", "/resolve", {
          payload: ResourceSelectionSchema,
          success: ResourceSelectionSchema,
        }),
        apiGet("evidence", "/evidence", {
          query: EvidenceQuerySchema,
          success: EvidenceDataSchema,
        }),
        apiGet("verification", "/verification", {
          query: WorkQuery,
          success: VerificationViewSchema,
        }),
        apiGet("overview", "/overview", {
          query: WorkQuery,
          success: WorkOverviewSchema,
        }),
        apiGet("detail", "/detail", {
          query: WorkQuery,
          success: WorkDetailSchema,
        }),
        apiGet("document", "/document", {
          query: WorkDocumentQuery,
          success: WorkDocumentSchema,
        }),
        apiGet("diff", "/diff", {
          query: Schema.Struct({
            ...WorkQuery.fields,
            file: Schema.optional(RelativePath),
            scope: Schema.optional(DiffScopeSchema),
          }).annotate(exact),
          success: WorkDiffSchema,
        }),
        apiGet("worker", "/worker", {
          query: WorkWorkerQuery,
          success: WorkerInspectionSchema,
        }),
        apiGet("worker-history", "/worker-history", {
          query: WorkerHistoryQuery.annotate(exact),
          success: WorkerHistoryPageSchema,
        }),
        apiGet("leads", "/leads", {
          query: LeadEvidenceQuery.annotate(exact),
          success: LeadEvidencePageSchema,
        }),
        apiGet("messages", "/messages", {
          query: WorkPageQuery,
          success: MessagesPageSchema,
        }),
        apiGet("feedback", "/feedback", {
          query: FeedbackQuery,
          success: FeedbackPageSchema,
        }),
        apiGet("report", "/report", {
          query: WorkQuery,
          success: WorkReportSchema,
        }),
        apiGet("artifacts", "/artifacts", {
          query: WorkPageQuery,
          success: ArtifactsSchema,
        }),
        apiGet("artifactSummary", "/artifact-summary", {
          query: ExportDocumentSchema,
          success: ArtifactSummarySchema,
        }),
        apiGet("artifactDocument", "/artifact-document", {
          query: ExportDocumentSchema,
          success: DocumentArtifactSchema,
        }),
        apiGet("decisions", "/decisions", {
          query: WorkQuery,
          success: DecisionsSchema,
        }),
      )
      .prefix("/api/work")
      .add(
        apiGet("thoughtWork", "/api/thoughts/work", {
          query: ThoughtWorkQuery.annotate(exact),
          success: ThoughtWorkPage,
        }),
        apiGet("thoughtList", "/api/thoughts", {
          query: ThoughtQuery.annotate(exact),
          success: ThoughtPage,
        }),
        apiGet("thoughtDetail", "/api/thoughts/detail", {
          query: ThoughtReference.annotate(exact),
          success: ThoughtDetail,
        }),
        apiPost("exportDocument", "/api/report/export", {
          payload: ExportDocumentSchema,
          success: ReportExportSchema,
        }),
        apiGet("exportPreview", "/api/report/export/preview", {
          query: ReadExportSchema,
          success: html,
        }),
        apiGet("exportDownload", "/api/report/export/download", {
          query: ReadExportSchema,
          success: HttpApiSchema.WithHeaders(html, { "content-disposition": Schema.String }),
        }),
        apiPost("saveSurface", "/api/report/save-surface", {
          payload: SaveSurfaceSchema,
          success: ArtifactSummarySchema,
        }),
        apiGet("downloadDocument", "/api/report/document/download", {
          query: ExportDocumentSchema,
          success: HttpApiSchema.WithHeaders(documentJSON, {
            "content-disposition": Schema.String,
          }),
        }),
      ),
    reviewGroup,
  )
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error", reportInput: false })
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", reportInput: false });

/** Fixed retained-work reads. Types follow the HTTP owner, including decoded numeric queries. */
export const workReadEndpoints = Struct.omit(workspaceApi.groups.work.endpoints, [
  "exportDocument",
  "resolve",
  "exportPreview",
  "exportDownload",
  "saveSurface",
  "downloadDocument",
]);
type WorkEndpoints = typeof workReadEndpoints;
export type WorkReadName = keyof WorkEndpoints;
export type WorkReadInput<K extends WorkReadName> = WorkEndpoints[K]["~Query"]["Type"];
export type WorkReadOutput<K extends WorkReadName> = WorkEndpoints[K]["~Success"]["Type"];
