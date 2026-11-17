import { ReviewListSchema, ReviewViewSchema, ReviewAssetDataSchema, ReviewReceiptSchema } from "@abracode/contracts/web/reviews";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { BindingReadSchema } from "@abracode/contracts/web/bindings";
import { LeadEvidencePageSchema } from "../visibility/lead-observation.ts";
import { WorkerHistoryPageSchema } from "./worker-history.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 HTTP server/router/API contracts. */
import "./telemetry.ts";
import { createServer } from "node:http";
import { join } from "node:path";
import { sourceInstallationRoot } from "../installation.ts";
import { ByteSize, Effect, Layer, Schema } from "effect";
import {
  HttpIncomingMessage,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api";
import { NodeHttpServer } from "@effect/platform-node";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import {
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  WorkerInspectionSchema,
  MessagesPageSchema,
  FeedbackPageSchema,
  ArtifactsSchema,
  DocumentArtifactSchema,
  ArtifactSummarySchema,
} from "./wire.ts";
import { AbraAgent, AbraRunner, WorkspaceFeed } from "./agent.ts";
import { workspaceApi, WorkspaceError, DecisionsSchema } from "./http-api.ts";
import { WorkPageSchema } from "../visibility/discovery-contracts.ts";
import type { WebBackend } from "./contracts.ts";

const maximumBodyBytes = 262144;
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const refused = (error: CrewError) =>
  new WorkspaceError({
    code: error.code,
    message: "Request could not be confirmed. Refresh before retrying.",
  });
const json = (value: unknown, status: number) => HttpServerResponse.jsonUnsafe(value, { status });

function workspaceHandlers(backend: WebBackend, feed: WorkspaceFeed) {
  const validated = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: Effect.Effect<S["Type"], CrewError>,
    schema: S,
  ) =>
    operation.pipe(
      Effect.flatMap((value) => decode(schema, value, "Workspace resource")),
      Effect.mapError(refused),
    );
  const operations = HttpApiBuilder.group(workspaceApi, "workspace", (handlers) =>
    handlers
      .handle("reviewList", ({query}) => validated(backend.reviews?.list(query.issue_id) ?? Effect.fail(new CrewError("REVIEW_UNAVAILABLE","Reviews are unavailable")), ReviewListSchema))
      .handle("review", ({query}) => validated(backend.reviews?.read(query) ?? Effect.fail(new CrewError("REVIEW_UNAVAILABLE","Reviews are unavailable")), ReviewViewSchema))
      .handle("reviewAsset", ({query}) => validated(backend.reviews?.asset(query) ?? Effect.fail(new CrewError("REVIEW_UNAVAILABLE","Reviews are unavailable")), ReviewAssetDataSchema))
      .handle("reviewSubmit", ({payload}) => validated(backend.reviews?.submit(payload) ?? Effect.fail(new CrewError("REVIEW_UNAVAILABLE","Reviews are unavailable")), ReviewReceiptSchema).pipe(Effect.tap(()=>feed.notify({presentations:true,admissions:true}))))
      .handle("prepareDiagrams", ({ payload }) =>
        validated(backend.prepareDiagrams(payload), DiagramPreparationSchema),
      )
      .handle("surface", ({ query }) =>
        backend.surface(query.surface_id, query.revision).pipe(Effect.mapError(refused)),
      )
      .handle("bootstrap", () => feed.baseline.pipe(Effect.mapError(refused)))
      .handle("history", ({ query }) =>
        backend.history(query.cursor).pipe(Effect.mapError(refused)),
      )
      .handle("receipt", ({ query }) =>
        backend.receipt(query.request_id).pipe(Effect.mapError(refused)),
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
      )
      .handle("stop", () =>
        backend.stop.pipe(
          Effect.tap(() => feed.refresh),
          Effect.map((stopped) => ({ stopped })),
          Effect.mapError(refused),
        ),
      ),
  );
  const work = HttpApiBuilder.group(workspaceApi, "work", (handlers) =>
    handlers
      .handle("binding", ({ query }) => validated(backend.work.binding(query), BindingReadSchema))
      .handle("find", ({ query }) => validated(backend.work["find"](query), WorkPageSchema))
      .handle("resolve", ({ payload }) => backend.resolve(payload).pipe(Effect.mapError(refused)))
      .handle("detail", ({ query }) => validated(backend.work["detail"](query), WorkDetailSchema))
      .handle("document", ({ query }) =>
        validated(backend.work["document"](query), WorkDocumentSchema),
      )
      .handle("diff", ({ query }) => validated(backend.work["diff"](query), WorkDiffSchema))
      .handle("worker", ({ query }) =>
        validated(backend.work["worker"](query), WorkerInspectionSchema),
      )
      .handle("worker-history", ({ query }) =>
        validated(backend.work["worker-history"](query), WorkerHistoryPageSchema),
      )
      .handle("leads", ({ query }) =>
        validated(backend.work["leads"](query), LeadEvidencePageSchema),
      )
      .handle("messages", ({ query }) =>
        validated(backend.work["messages"](query), MessagesPageSchema),
      )
      .handle("feedback", ({ query }) =>
        validated(backend.work["feedback"](query), FeedbackPageSchema),
      )
      .handle("report", ({ query }) => validated(backend.work["report"](query), WorkReportSchema))
      .handle("artifacts", ({ query }) =>
        validated(backend.work["artifacts"](query), ArtifactsSchema),
      )
      .handle("artifactSummary", ({ query }) =>
        validated(backend.work["artifactSummary"](query), ArtifactSummarySchema),
      )
      .handle("artifactDocument", ({ query }) =>
        validated(backend.work["artifactDocument"](query), DocumentArtifactSchema),
      )
      .handle("exportDocument", ({ payload }) =>
        backend.exportDocument(payload).pipe(Effect.mapError(refused)),
      )
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
        validated(backend.work["artifactDocument"](query), DocumentArtifactSchema).pipe(
          Effect.map((artifact) =>
            HttpApiSchema.withHeaders({
              body: artifact.json,
              headers: {
                "content-disposition": `attachment; filename="abra-report-${query.request_id}.json"`,
              },
            }),
          ),
        ),
      )
      .handle("preview", ({ query }) =>
        backend.artifact(query.issue_id, query.request_id).pipe(
          Effect.map((a) => a.html),
          Effect.mapError(refused),
        ),
      )
      .handle("download", ({ query }) =>
        backend.artifact(query.issue_id, query.request_id).pipe(
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
      .handle("decisions", ({ query }) =>
        validated(backend.work["decisions"](query), DecisionsSchema),
      ),
  );
  return HttpApiBuilder.layer(workspaceApi).pipe(Layer.provide(Layer.merge(operations, work)));
}

export interface WorkspaceServerOptions {
  port: number;
  backend: WebBackend;
  assets?: string;
}
/** Owns the loopback listener and observer fibers, never native sessions or work. */
export const workspaceServer = (options: WorkspaceServerOptions) =>
  Effect.gen(function* () {
    const feed = yield* WorkspaceFeed.make(options.backend);
    const runner = new AbraRunner(options.backend, feed);
    const runtime = new CopilotRuntime({
      agents: { abra: new AbraAgent(runner, options.backend.sessionID) },
      runner,
      a2ui: { enabled: false },
    });
    const copilot = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      activateChannels: false,
    });
    const assets = options.assets ?? join(sourceInstallationRoot(), "apps/web/dist");
    const server = yield* NodeHttpServer.make(() => createServer(), {
      port: options.port,
      host: "127.0.0.1",
      gracefulShutdownTimeout: "1 second",
    });
    if (!("port" in server.address))
      return yield* new CrewError("WEB_LISTEN", "Expected a loopback TCP listener");
    const origin = `http://127.0.0.1:${server.address.port}`;
    const copilotRoute = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, origin);
      const info = url.pathname === "/api/copilotkit/info";
      if (url.search) return json({ error: "Query options are not supported" }, 400);
      const input = request.method === "POST" ? yield* request.json : undefined;
      if (
        !info &&
        (!input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          !("threadId" in input) ||
          input.threadId !== options.backend.sessionID)
      )
        return json({ _tag: "WorkspaceForbidden", message: "Use the fixed Abra session" }, 403);
      // The request scope aborts Fetch and its AG-UI observer on disconnect. Native
      // admission masks interruption only inside its short persisted critical section.
      const abort = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (abort) => Effect.sync(() => abort.abort()),
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          copilot(
            new Request(url, {
              method: request.method,
              headers: {
                "content-type": "application/json",
                accept: request.headers.accept ?? "text/event-stream",
              },
              body: input === undefined ? undefined : JSON.stringify(input),
              signal: abort.signal,
            }),
          ),
        catch: () =>
          new WorkspaceError({
            code: "COPILOT_TRANSPORT",
            message: "Abra observation unavailable; reconnect without resubmitting",
          }),
      });
      return HttpServerResponse.fromWeb(response);
    });
    const routes = Layer.mergeAll(
      workspaceHandlers(options.backend, feed),
      HttpRouter.add(
        "GET",
        "/THIRD_PARTY_NOTICES.txt",
        HttpServerResponse.file(join(assets, "THIRD_PARTY_NOTICES.txt"), {
          contentType: "text/plain; charset=utf-8",
        }),
      ),
      HttpRouter.add("GET", "/api/copilotkit/info", copilotRoute),
      HttpRouter.add("POST", "/api/copilotkit/info", copilotRoute),
      HttpRouter.add("POST", "/api/copilotkit/agent/abra/run", copilotRoute),
      HttpRouter.add("POST", "/api/copilotkit/agent/abra/connect", copilotRoute),
      HttpRouter.add(
        "GET",
        "/",
        HttpServerResponse.file(join(assets, "index.html"), {
          contentType: "text/html; charset=utf-8",
        }).pipe(
          Effect.orElseSucceed(() =>
            json({ error: "Frontend build missing. Run pnpm web:build." }, 503),
          ),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/assets/:file",
        Effect.gen(function* () {
          const { file } = yield* HttpRouter.params;
          if (!file || !/^[a-zA-Z0-9_.-]+\.(?:js|css|svg|woff2|woff|ttf)$/.test(file))
            return json({ error: "Not found" }, 404);
          return yield* HttpServerResponse.file(join(assets, "assets", file)).pipe(
            HttpMiddleware.compression({
              algorithms: ["gzip"],
              minSize: 1024,
              levels: { gzip: 6 },
            }),
            Effect.orElseSucceed(() => json({ error: "Asset unavailable" }, 404)),
          );
        }),
      ),
    ).pipe(Layer.provide(NodeHttpServer.layerHttpServices));
    const app = yield* HttpRouter.toHttpEffect(routes);
    const guarded = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin !== undefined && request.headers.origin !== origin) ||
        ["cross-site", "same-site"].includes(request.headers["sec-fetch-site"] ?? "")
      )
        return json({ _tag: "WorkspaceForbidden", message: "Use the local AbraCode URL" }, 403);
      if (!["GET", "HEAD", "POST"].includes(request.method))
        return json({ error: "Method not allowed" }, 405);
      if (request.method === "POST" && request.headers.origin !== origin)
        return json(
          { _tag: "WorkspaceForbidden", message: "Same-origin requests are required" },
          403,
        );
      const raw = request.originalUrl.startsWith(origin + "/")
        ? request.originalUrl.slice(origin.length).split("?")[0]
        : "";
      if (
        !/^\/(?:[a-zA-Z0-9_.-]+\/?)*$/.test(raw) ||
        raw.split("/").some((part) => part === "." || part === "..")
      )
        return json({ error: "Invalid request path" }, 400);
      return yield* app;
    }).pipe(
      Effect.catchTag("WorkspaceError", (error) => Effect.succeed(json(error, 409))),
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const preview = ["/api/report/preview", "/api/report/export/preview"].includes(
            request.url.split("?")[0]!,
          );
          return HttpServerResponse.setHeaders(response, {
            ...securityHeaders,
            ...(response.status === 200 &&
            /^(?:GET|HEAD)$/.test(request.method) &&
            /^\/assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|svg|woff2?|ttf)$/.test(
              request.url.split("?")[0]!,
            )
              ? { "cache-control": "public, max-age=31536000, immutable" }
              : {}),
            ...(preview
              ? {
                  "content-security-policy":
                    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
                }
              : {}),
          });
        }),
      ),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maximumBodyBytes)),
      Effect.interruptible,
    );
    yield* server.serve(guarded).pipe(Effect.provide(NodeHttpServer.layerHttpServices));
    return { origin, url: origin };
  });
