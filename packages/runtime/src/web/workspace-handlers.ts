import { diagnosticText } from "../opencode/diagnostics.ts";
import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api";
import { CrewError } from "../domain.ts";
import { WorkspaceFeed } from "./agent.ts";
import {
  workspaceApi,
  WorkspaceError,
  WorkspaceBadRequest,
  WorkspaceUnavailable,
  WorkspaceNotFound,
} from "@abracode/contracts/web/http-api";
import type { WebBackend } from "./contracts.ts";

const resourceErrors = new Map([
  [
    "WEB_NATIVE_UPDATE_REQUIRED",
    "The running AbraCode service does not support this workspace feature yet. Restart the service to load the updated plugin.",
  ],
  ["ISSUE_MISSING", "This task is no longer available. Select another task."],
  ["EXECUTION_MISSING", "This task has not started, so execution evidence is unavailable."],
  ["REPORT_UNAVAILABLE", "The retained report is currently unavailable."],
  ["REPORT_MISSING", "The retained report could not be found."],
  ["REPORT_IDENTITY", "The retained report does not match this task and cannot be displayed."],
  ["REPORT_PATH", "The retained report cannot be read from its owned storage."],
  ["REPORT_TAMPERED", "The retained report failed its integrity check and cannot be displayed."],
]);
function refused(error: CrewError) {
  const { code, details } = error;
  const type =
    typeof details === "object" && details && "rpcType" in details ? details.rpcType : undefined;
  const safe =
    type ||
    /^(?:WEB_INPUT|WEB_CURSOR|STALE_|FORM_CONFLICT|REVIEW_|SELECTION_|MEMORY_|MEMOS_|INBOX_)/.test(
      code,
    );
  const fields = {
    code,
    message:
      resourceErrors.get(code) ??
      (safe
        ? diagnosticText(error.message)
        : "Request could not be confirmed. Refresh before retrying."),
  };
  if (
    type === "invalid_selection" ||
    ["WEB_INPUT", "WEB_CURSOR", "INVALID_SELECTION", "INVALID_ID", "INBOX_PROJECT"].includes(code)
  )
    return new WorkspaceBadRequest(fields);
  if (
    type === "not_found" ||
    [
      "REPORT_MISSING",
      "ISSUE_MISSING",
      "EXECUTION_MISSING",
      "PROJECT_MISSING",
      "NOT_FOUND",
    ].includes(code)
  )
    return new WorkspaceNotFound(fields);
  if (["REPORT_IDENTITY", "REPORT_TAMPERED", "REPORT_PATH"].includes(code))
    return new WorkspaceError(fields);
  if (
    type === "resource_unavailable" ||
    [
      "WEB_SERVICE",
      "WEB_NATIVE_UPDATE_REQUIRED",
      "WEB_OBSERVATION",
      "REPORT_UNAVAILABLE",
      "UNEXPECTED",
    ].includes(code)
  )
    return new WorkspaceUnavailable(fields);
  return new WorkspaceError(fields);
}

export function workspaceHandlers(backend: WebBackend, feed: WorkspaceFeed) {
  const handle = <A>(operation: Effect.Effect<A, CrewError>) =>
    operation.pipe(Effect.mapError(refused));
  const workRead =
    <I, A>(read: (query: I) => Effect.Effect<A, CrewError>) =>
    ({ query }: { query: I }) =>
      handle(read(query));
  const operations = HttpApiBuilder.group(workspaceApi, "workspace", (handlers) =>
    handlers
      .handle("memorySearch", ({ query }) => handle(backend.memorySearch(query)))
      .handle("memoryRead", ({ payload }) => handle(backend.memoryRead(payload)))
      .handle("memoryEnabled", () => handle(backend.memoryEnabled))
      .handle("memoryPublish", ({ payload }) => handle(backend.memoryPublish(payload)))
      .handle("agents", () => handle(backend.agents))
      .handle("repositories", () => handle(backend.repositories))
      .handle("prepareDiagrams", ({ payload }) => handle(backend.prepareDiagrams(payload)))
      .handle("publications", ({ query }) => handle(backend.publications(query)))
      .handle("surface", ({ query }) =>
        query.session_id !== undefined && query.session_id !== backend.sessionID
          ? Effect.succeed({
              surface_id: query.surface_id,
              unavailable: "This view belongs to another Abra conversation.",
            })
          : handle(backend.surface(query.surface_id, query.revision)),
      )
      .handle("bootstrap", () => handle(feed.baseline))
      .handle("history", ({ query }) => handle(backend.history(query.cursor)))
      .handle("receipt", ({ query }) => handle(backend.receipt(query.request_id)))
      .handle("submit", ({ payload }) =>
        backend.submit(payload).pipe(
          Effect.tap(() => feed.notify({ admissions: true, transcript: true })),
          Effect.mapError(refused),
        ),
      )
      .handle("replyForm", ({ payload }) =>
        backend
          .replyForm(payload)
          .pipe(
            Effect.andThen(feed.notify({ attention: true })),
            Effect.as({ status: "answered" as const }),
            Effect.mapError(refused),
          ),
      )
      .handle("replyPermission", ({ payload }) =>
        backend
          .replyPermission(payload)
          .pipe(
            Effect.andThen(feed.notify({ attention: true })),
            Effect.as({ status: "answered" as const }),
            Effect.mapError(refused),
          ),
      ),
  );
  const work = HttpApiBuilder.group(workspaceApi, "work", (handlers) =>
    handlers
      .handle(
        "evidenceSearch",
        workRead((q) => backend.work.evidenceSearch(q)),
      )
      .handle(
        "sessions",
        workRead((q) => backend.work.sessions(q)),
      )
      .handle(
        "thoughtWork",
        workRead((q) => backend.work.thoughtWork(q)),
      )
      .handle(
        "thoughtList",
        workRead((q) => backend.work.thoughtList(q)),
      )
      .handle(
        "thoughtDetail",
        workRead((q) => backend.work.thoughtDetail(q)),
      )
      .handle(
        "githubInbox",
        workRead((q) => backend.work.githubInbox(q)),
      )
      .handle(
        "githubItem",
        workRead((q) => backend.work.githubItem(q)),
      )
      .handle(
        "binding",
        workRead((q) => backend.work.binding(q)),
      )
      .handle(
        "find",
        workRead((q) => backend.work.find(q)),
      )
      .handle("resolve", ({ payload }) => handle(backend.resolve(payload)))
      .handle(
        "evidence",
        workRead((q) => backend.work.evidence(q)),
      )
      .handle(
        "verification",
        workRead((q) => backend.work.verification(q)),
      )
      .handle(
        "overview",
        workRead((q) => backend.work.overview(q)),
      )
      .handle(
        "detail",
        workRead((q) => backend.work.detail(q)),
      )
      .handle(
        "document",
        workRead((q) => backend.work.document(q)),
      )
      .handle(
        "diff",
        workRead((q) => backend.work.diff(q)),
      )
      .handle(
        "worker",
        workRead((q) => backend.work.worker(q)),
      )
      .handle(
        "worker-history",
        workRead((q) => backend.work["worker-history"](q)),
      )
      .handle(
        "leads",
        workRead((q) => backend.work.leads(q)),
      )
      .handle(
        "messages",
        workRead((q) => backend.work.messages(q)),
      )
      .handle(
        "feedback",
        workRead((q) => backend.work.feedback(q)),
      )
      .handle(
        "report",
        workRead((q) => backend.work.report(q)),
      )
      .handle(
        "artifacts",
        workRead((q) => backend.work.artifacts(q)),
      )
      .handle(
        "artifactSummary",
        workRead((q) => backend.work.artifactSummary(q)),
      )
      .handle(
        "artifactDocument",
        workRead((q) => backend.work.artifactDocument(q)),
      )
      .handle("exportDocument", ({ payload }) => handle(backend.exportDocument(payload)))
      .handle("exportPreview", ({ query }) =>
        backend.readExport(query).pipe(
          Effect.map((a) => a.html),
          Effect.mapError(refused),
        ),
      )
      .handle("exportDownload", ({ query }) =>
        backend.readExport(query).pipe(
          Effect.map((a) =>
            HttpApiSchema.withHeaders({
              body: a.html,
              headers: {
                "content-disposition": `attachment; filename="abra-report-${query.request_id}.html"`,
              },
            }),
          ),
          Effect.mapError(refused),
        ),
      )
      .handle("saveSurface", ({ payload }) =>
        backend.saveSurface(payload).pipe(
          Effect.tap(() => feed.notify({ presentations: true })),
          Effect.mapError(refused),
        ),
      )
      .handle("downloadDocument", ({ query }) =>
        backend.work.artifactDocument(query).pipe(
          Effect.map((artifact) =>
            HttpApiSchema.withHeaders({
              body: artifact.json,
              headers: {
                "content-disposition": `attachment; filename="abra-report-${query.request_id}.json"`,
              },
            }),
          ),
          Effect.mapError(refused),
        ),
      )
      .handle(
        "decisions",
        workRead((q) => backend.work.decisions(q)),
      ),
  );
  const reviewUnavailable = () =>
    Effect.fail(new CrewError("REVIEW_UNAVAILABLE", "Reviews are unavailable"));
  const reviews = HttpApiBuilder.group(workspaceApi, "reviews", (handlers) =>
    handlers
      .handle("reviewReceipt", ({ query }) =>
        handle(backend.reviews?.receipt(query) ?? reviewUnavailable()),
      )
      .handle("reviewList", ({ query }) =>
        handle(backend.reviews?.list(query.issue_id) ?? reviewUnavailable()),
      )
      .handle("review", ({ query }) => handle(backend.reviews?.read(query) ?? reviewUnavailable()))
      .handle("reviewAsset", ({ query }) =>
        handle(backend.reviews?.asset(query) ?? reviewUnavailable()),
      )
      .handle("reviewSubmit", ({ payload }) =>
        handle(backend.reviews?.submit(payload) ?? reviewUnavailable()).pipe(
          Effect.tap(() => feed.notify({ presentations: true, admissions: true })),
        ),
      ),
  );
  return HttpApiBuilder.layer(workspaceApi).pipe(
    Layer.provide(Layer.mergeAll(operations, work, reviews)),
  );
}
