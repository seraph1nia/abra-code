import { Effect, Fiber } from "effect";
import { createServer, request, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { type Endpoint } from "@opencode/client/effect/service";
import { CrewError } from "../domain.ts";
import { WebForms } from "./forms.ts";

export interface WebProxyOptions {
  port: number;
  sessionID: string;
  discover: Effect.Effect<Endpoint | undefined, CrewError>;
}

/** The web client keys HTTP servers by origin, encoded as unpadded base64url. */
export const abraSessionPath = (origin: string, sessionID: string) =>
  `/server/${Buffer.from(origin).toString("base64url")}/session/${encodeURIComponent(sessionID)}`;

const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function headers(input: IncomingHttpHeaders, response = false, upgrade = false) {
  const omitted = new Set([
    ...hopHeaders,
    ...(input.connection ?? "").toLowerCase().split(/\s*,\s*/),
  ]);
  const output: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      omitted.has(key) ||
      key === "authorization" ||
      key === "cookie" ||
      key === "host" ||
      key === "forwarded" ||
      key.startsWith("x-forwarded-") ||
      (response &&
        (key === "set-cookie" || key === "www-authenticate" || key.startsWith("access-control-")))
    )
      continue;
    output[key] = value;
  }
  if (upgrade) {
    output.connection = "Upgrade";
    output.upgrade = input.upgrade;
  }
  return output;
}

/** Owns only its listener and transports; native service lifetime stays with OpenCode. */
export const webProxy = (options: WebProxyOptions) =>
  Effect.gen(function* () {
    const run = Effect.runForkWith(yield* Effect.context<never>());
    let origin = "";
    const sockets = new Set<Duplex>();
    const operations = new Set<() => void>();
    const server = createServer();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });

    const dispatch = (
      req: import("node:http").IncomingMessage,
      downstream: ServerResponse | Duplex,
      head?: Buffer,
    ) => {
      const upgrade = head !== undefined;
      const fail = (status: number, message: string) => {
        if (downstream.destroyed) return;
        if ("writeHead" in downstream) {
          if (downstream.headersSent) return downstream.destroy();
          downstream.writeHead(status, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          });
          downstream.end(message);
        } else
          downstream.end(
            `HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
      };
      // Exact Host also prevents DNS rebinding. Local pages on other ports are different origins.
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"] as string) ||
        (upgrade && req.headers.origin !== origin)
      )
        return fail(403, "Use the local AbraCode URL.");
      if (!req.url?.startsWith("/") || req.url.startsWith("//"))
        return fail(400, "Invalid request path.");
      const url = URL.parse(req.url, origin);
      if (!url || url.origin !== origin) return fail(400, "Invalid request path.");
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "");
      } catch {
        return fail(400, "Invalid request path.");
      }
      // Pairing is unnecessary on this origin and would disclose a transferable native credential.
      if (pathname === "/api/pair" || pathname.startsWith("/auth/")) return fail(404, "Not found.");
      if (url.pathname === "/" && !upgrade && (req.method === "GET" || req.method === "HEAD")) {
        (downstream as ServerResponse).writeHead(302, {
          location: abraSessionPath(origin, options.sessionID),
          "cache-control": "no-store",
        });
        return downstream.end();
      }

      const fiber = run(
        options.discover.pipe(
          Effect.match({
            onFailure: () =>
              fail(502, "AbraCode service unavailable. Reload after restarting the service."),
            onSuccess: (endpoint) => {
              if (downstream.destroyed) return;
              if (!endpoint)
                return fail(
                  502,
                  "AbraCode service unavailable. Reload after restarting the service.",
                );
              const target = URL.parse(endpoint.url);
              if (
                !target ||
                target.protocol !== "http:" ||
                !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
                target.username ||
                target.password
              )
                return fail(502, "Expected this installation's local OpenCode service.");
              const upstreamHeaders = headers(req.headers, false, upgrade);
              const forms =
                req.method === "GET" &&
                /^\/api\/(?:session\/[^/]+\/)?form(?:\/[^/]+)?$/.test(url.pathname);
              if (forms) upstreamHeaders["accept-encoding"] = "identity";
              upstreamHeaders.host = target.host;
              if (endpoint.auth)
                upstreamHeaders.authorization = `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}`;
              const upstream = request(target, {
                method: req.method,
                path: req.url,
                headers: upstreamHeaders,
              });
              const cancel = () => upstream.destroy();
              operations.add(cancel);
              upstream.once("close", () => operations.delete(cancel));
              downstream.once("close", cancel);
              upstream.once("error", () =>
                fail(
                  502,
                  "AbraCode connection lost. Check the conversation before submitting again.",
                ),
              );
              upstream.on("response", (response) => {
                if (upgrade) {
                  response.resume();
                  return fail(response.statusCode ?? 502, "WebSocket connection refused.");
                }
                const out = headers(response.headers, true);
                const projectForms =
                  forms &&
                  response.statusCode === 200 &&
                  response.headers["content-type"]?.includes("application/json");
                if (projectForms) {
                  delete out["content-length"];
                  delete out.etag;
                }
                if (out.location) {
                  const location = URL.parse(out.location, target);
                  if (location?.origin === target.origin)
                    out.location = `${origin}${location.pathname}${location.search}${location.hash}`;
                }
                (downstream as ServerResponse).writeHead(response.statusCode ?? 502, out);
                response.once("error", () => downstream.destroy());
                if (projectForms) {
                  const projection = new WebForms();
                  projection.once("error", () => {
                    response.destroy();
                    downstream.destroy();
                  });
                  response.pipe(projection);
                  projection.pipe(downstream);
                } else response.pipe(downstream);
              });
              upstream.on("upgrade", (response, socket, upstreamHead) => {
                if (!upgrade || response.statusCode !== 101) {
                  socket.destroy();
                  return fail(502, "WebSocket connection refused.");
                }
                sockets.add(socket);
                socket.once("close", () => {
                  sockets.delete(socket);
                  downstream.destroy();
                });
                downstream.once("close", () => socket.destroy());
                socket.once("error", () => downstream.destroy());
                downstream.once("error", () => socket.destroy());
                const out = headers(response.headers, true, true);
                const lines = Object.entries(out).flatMap(([key, value]) =>
                  (Array.isArray(value) ? value : [value])
                    .filter((v) => v !== undefined)
                    .map((v) => `${key}: ${v}`),
                );
                downstream.write(
                  `HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`,
                );
                if (upstreamHead.length) downstream.write(upstreamHead);
                if (head?.length) socket.write(head);
                socket.pipe(downstream);
                (downstream as Duplex).pipe(socket);
              });
              req.once("aborted", cancel);
              req.once("error", cancel);
              if (upgrade) upstream.end();
              else req.pipe(upstream);
            },
          }),
        ),
      );
      const interrupt = () => {
        run(Fiber.interrupt(fiber));
      };
      operations.add(interrupt);
      fiber.addObserver(() => operations.delete(interrupt));
      downstream.once("close", interrupt);
    };
    server.on("request", (req, res) => dispatch(req, res));
    server.on("upgrade", (req, socket, head) => dispatch(req, socket, head));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        server.close();
        for (const cancel of operations) cancel();
        for (const socket of sockets) socket.destroy();
      }),
    );
    yield* Effect.callback<void, CrewError>((resume) => {
      server.once("error", () =>
        resume(
          Effect.fail(
            new CrewError(
              "WEB_LISTEN",
              "Cannot listen on the selected localhost port. Choose another with --port.",
            ),
          ),
        ),
      );
      server.listen(options.port, "127.0.0.1", () => resume(Effect.void));
    });
    const address = server.address() as import("node:net").AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    return { origin, url: origin + abraSessionPath(origin, options.sessionID) };
  });
