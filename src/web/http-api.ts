/* oxlint-disable effecttsgo/unstable-api-usage -- Shared contracts for the pinned Effect 4.1.4 HTTP API implementation. */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { SessionMessage } from "@opencode/schema/session-message";
import {
  WorkSnapshotSchema,
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
} from "./wire.ts";
import { IssueId, RelativePath, SessionId, RequestId } from "../identities.ts";
import { componentNames, catalogId } from "./surfaces.ts";

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
export const ReceiptSchema = Schema.Struct({
  request_id: Schema.String,
  message_id: SessionMessage.ID,
  text: Schema.String,
  delivery: Schema.Literals(["queue", "steer"]),
  status: Schema.Literals(["submitted", "admitted", "uncertain"]),
  at: Schema.String,
});
export type SubmissionReceipt = typeof ReceiptSchema.Type;
export const TranscriptMessageSchema = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  at: Schema.String,
  files: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        status: Schema.String,
        input: Schema.optional(Schema.String),
        result: Schema.optional(Schema.String),
      }),
    ),
  ),
});
export const SurfaceSchema = Schema.Struct({
  version: Schema.Literal("1.0"),
  createSurface: Schema.Struct({
    surfaceId: Schema.String,
    catalogId: Schema.Literal(catalogId),
    components: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        component: Schema.Literals(componentNames),
        children: Schema.optional(Schema.Array(Schema.String)),
        text: Schema.optional(Schema.String),
        issueIds: Schema.optional(Schema.Array(Schema.String)),
        issueId: Schema.optional(Schema.String),
        mode: Schema.optional(Schema.Literals(["live", "snapshot"])),
      }),
    ),
  }),
});
export const CheckpointSchema = Schema.Struct({
  active: Schema.Boolean,
  issue_id: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["plan", "merge", "decision"])),
  fingerprint: Schema.optional(Schema.String),
  identity: Schema.optional(Schema.String),
  generation: Schema.optional(Schema.Int),
  finishing_target: Schema.optional(Schema.String),
});
export const WorkspaceSnapshotSchema = Schema.Struct({
  session_id: SessionId,
  agent_id: Schema.Literal("abra"),
  at: Schema.String,
  busy: Schema.Boolean,
  outcome: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  messages: Schema.Array(TranscriptMessageSchema),
  older: Schema.optional(Schema.String),
  inbox: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String, delivery: Schema.String }),
  ),
  receipts: Schema.Array(ReceiptSchema),
  forms: Schema.Array(
    Schema.Struct({
      form: Form.Info,
      binding: Schema.String,
      active: Schema.Boolean,
      checkpoint: Schema.optional(CheckpointSchema),
    }),
  ),
  permissions: Schema.Array(Schema.Struct({ request: Permission.Request, binding: Schema.String })),
  projects: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, path: Schema.optional(Schema.String) }),
  ),
  work: WorkSnapshotSchema,
  surfaces: Schema.Array(
    Schema.Struct({
      session_id: Schema.String,
      tool_call_id: Schema.String,
      revision: Schema.Int,
      at: Schema.String,
      surface: SurfaceSchema,
      snapshot: WorkSnapshotSchema.fields.work,
    }),
  ),
});
export const HistorySchema = Schema.Struct({
  messages: Schema.Array(TranscriptMessageSchema),
  older: Schema.optional(Schema.String),
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

export const workspaceApi = HttpApi.make("abra-workspace")
  .add(
    HttpApiGroup.make("workspace").add(
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
        query: WorkQuery,
        success: ArtifactsSchema,
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
