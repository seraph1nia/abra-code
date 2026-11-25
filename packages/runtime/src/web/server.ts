import { workCatalogDocument } from "@abracode/contracts/web/catalog";
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
import { NodeHttpServer } from "@effect/platform-node";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { CrewError } from "../domain.ts";
import { AbraAgent, AbraRunner, WorkspaceFeed } from "./agent.ts";
import { WorkspaceUnavailable } from "@abracode/contracts/web/http-api";
import type { WebBackend } from "./contracts.ts";
import { workspaceHandlers } from "./workspace-handlers.ts";
const maximumBodyBytes = 262144;
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; media-src 'self' https: http: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const json = (value: unknown, status: number) => HttpServerResponse.jsonUnsafe(value, { status });

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
            new WorkspaceUnavailable({
              code: "COPILOT_TRANSPORT",
              message: "Abra observation unavailable; reconnect without resubmitting",
            }),
        ),
      );
      const response = yield* Effect.tryPromise({
        try: () => copilot(webRequest),
        catch: () =>
          new WorkspaceUnavailable({
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
      HttpRouter.add(
        "GET",
        "/catalog/work/v1/catalog.json",
        Effect.sync(() => json(workCatalogDocument, 200)),
      ),
      HttpRouter.add(
        "GET",
        "/THIRD_PARTY_NOTICES.txt",
        HttpServerResponse.file(join(assets, "THIRD_PARTY_NOTICES.txt"), {
          contentType: "text/plain; charset=utf-8",
        }),
      ),
      HttpRouter.add("GET", "/api/copilotkit/info", copilotRoute),
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
      Effect.catchTag("WorkspaceUnavailable", (error) => Effect.succeed(json(error, 503))),
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const preview = request.url.split("?")[0] === "/api/report/export/preview";
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
