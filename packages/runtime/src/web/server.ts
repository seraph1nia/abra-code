import { catalogIds, workCatalogs } from "@abracode/contracts/web/catalog";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 HTTP server/router/API contracts. */
import "./telemetry.ts";
import { createServer } from "node:http";
import { join } from "node:path";
import { sourceInstallationRoot } from "../installation.ts";
import { ByteSize, Effect, Layer } from "effect";
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
import { AbraAgent, AbraRunner, WorkspaceFeed } from "./agent.ts";
import { workspaceApi, WorkspaceError } from "@abracode/contracts/web/http-api";
import type { WebBackend } from "./contracts.ts";

const maximumBodyBytes = 262144;
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; media-src 'self' https: http: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
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
const refused = (error: CrewError) =>
  new WorkspaceError({
    code: error.code,
    message:
      error.code === "REVIEW_STALE" ||
      error.code === "REVIEW_REFUSED" ||
      error.code.startsWith("SELECTION_") ||
      error.code.startsWith("MEMORY_") ||
      error.code.startsWith("MEMOS_")
        ? error.message
        : (resourceErrors.get(error.code) ??
          "Request could not be confirmed. Refresh before retrying."),
  });
const json = (value: unknown, status: number) => HttpServerResponse.jsonUnsafe(value, { status });

function workspaceHandlers(backend: WebBackend, feed: WorkspaceFeed) {
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
    const forbiddenSession = () =>
      Response.json(
        { _tag: "WorkspaceForbidden", message: "Use the fixed Abra session" },
        { status: 403 },
      );
    const copilot = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      activateChannels: false,
      hooks: {
        onBeforeHandler: async ({ request, route }) => {
          if (route.method === "info") return;
          if (route.method === "agent/stop") {
            if (route.agentId !== "abra" || route.threadId !== options.backend.sessionID)
              throw forbiddenSession();
            return;
          }
          if (route.method === "agent/run" || route.method === "agent/connect") {
            let input: unknown;
            try {
              input = await request.clone().json();
            } catch {
              input = undefined;
            }
            if (
              route.agentId !== "abra" ||
              !input ||
              typeof input !== "object" ||
              Array.isArray(input) ||
              !("threadId" in input) ||
              input.threadId !== options.backend.sessionID
            )
              throw forbiddenSession();
            return;
          }
          throw Response.json({ error: "Not found" }, { status: 404 });
        },
      },
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
      if (url.search) return json({ error: "Query options are not supported" }, 400);
      // The request scope aborts Fetch and its AG-UI observer on disconnect. Native
      // admission masks interruption only inside its short persisted critical section.
      const abort = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (abort) => Effect.sync(() => abort.abort()),
      );
      const webRequest = yield* HttpServerRequest.toWeb(request, { signal: abort.signal }).pipe(
        Effect.mapError(
          () =>
            new WorkspaceError({
              code: "COPILOT_TRANSPORT",
              message: "Abra observation unavailable; reconnect without resubmitting",
            }),
        ),
      );
      const response = yield* Effect.tryPromise({
        try: () => copilot(webRequest),
        catch: () =>
          new WorkspaceError({
            code: "COPILOT_TRANSPORT",
            message: "Abra observation unavailable; reconnect without resubmitting",
          }),
      });
      return HttpServerResponse.fromWeb(response);
    });
    const frontend = HttpServerResponse.file(join(assets, "index.html"), {
      contentType: "text/html; charset=utf-8",
    }).pipe(
      Effect.orElseSucceed(() =>
        json({ error: "Frontend build missing. Run pnpm web:build." }, 503),
      ),
    );
    const spaFallback = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const pathname = request.url.split("?")[0] ?? "/";
      if (
        pathname === "/api" ||
        pathname.startsWith("/api/") ||
        pathname === "/assets" ||
        pathname.startsWith("/assets/") ||
        pathname === "/catalog" ||
        pathname.startsWith("/catalog/")
      )
        return json({ error: "Not found" }, 404);
      return yield* frontend;
    });
    const routes = Layer.mergeAll(
      workspaceHandlers(options.backend, feed),
      ...catalogIds.map((id, index) =>
        HttpRouter.add(
          "GET",
          `/catalog/work-v${index + 1}.json`,
          Effect.sync(() => json(workCatalogs[id], 200)),
        ),
      ),
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
      HttpRouter.add("POST", "/api/copilotkit/agent/abra/stop/:threadId", copilotRoute),
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
      HttpRouter.add("GET", "/", frontend),
      HttpRouter.add("GET", "/*", spaFallback),
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
                    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
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
