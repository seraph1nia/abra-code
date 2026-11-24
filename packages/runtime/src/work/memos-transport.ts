/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 HTTP client service; verified by integration tests. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { CrewError } from "../domain.ts";

type Operation = "create" | "list" | "get";
const tools = {
  create: "memo_create_memo",
  list: "memo_list_memos",
  get: "memo_get_memo",
} as const;

const provideHttpClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> =>
  Effect.serviceOption(HttpClient.HttpClient).pipe(
    Effect.flatMap((service) =>
      Option.isSome(service)
        ? effect.pipe(Effect.provideService(HttpClient.HttpClient, service.value))
        : effect.pipe(
            Effect.provide(NodeHttpClient.layerFetch),
            Effect.provideService(NodeHttpClient.RequestInit, { redirect: "error" }),
          ),
    ),
  );

export class MemosTransport {
  constructor(private connection: { instance: string; token: Redacted.Redacted<string> }) {}
  private get headers() {
    return { Authorization: "Bearer " + Redacted.value(this.connection.token) };
  }
  http(path: string, query: Record<string, string> = {}): Effect.Effect<unknown, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const client = yield* HttpClient.HttpClient;
      const url = yield* Effect.try({
        try: () => new URL("/api/" + path, this.connection.instance),
        catch: transportError,
      });
      const request = HttpClientRequest.get(url, {
        headers: this.headers,
        urlParams: query,
      });
      const response = yield* client.execute(request);
      if (response.status < 200 || response.status >= 300)
        return yield* responseError(response.status);
      return yield* response.json;
    }).pipe(provideHttpClient, Effect.timeout("10 seconds"), Effect.mapError(transportError));
  }
  mcp(op: Operation, args: Record<string, unknown>): Effect.Effect<unknown, CrewError> {
    return Effect.acquireUseRelease(
      Effect.try({
        try: () => {
          const controller = new AbortController();
          const client = new Client({ name: "abracode", version: "1" });
          const transport = new StreamableHTTPClientTransport(
            new URL("/mcp", this.connection.instance),
            {
              requestInit: { headers: this.headers, redirect: "error" },
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  redirect: "error",
                  signal: init?.signal
                    ? AbortSignal.any([controller.signal, init.signal])
                    : controller.signal,
                }),
            },
          );
          return { client, transport, controller };
        },
        catch: transportError,
      }),
      ({ client, transport, controller }) =>
        Effect.tryPromise({
          try: async (signal): Promise<unknown> => {
            const onAbort = () => controller.abort();
            signal.addEventListener("abort", onAbort, { once: true });
            try {
              await client.connect(transport);
              const result = await client.callTool(
                { name: tools[op], arguments: args },
                undefined,
                { signal },
              );
              if (result.isError) {
                const first = Array.isArray(result.content) ? result.content[0] : undefined;
                const status =
                  first?.type === "text" ? Number(/^([0-9]{3})\b/u.exec(first.text)?.[1]) : 0;
                throw responseError(status);
              }
              return result.structuredContent;
            } finally {
              signal.removeEventListener("abort", onAbort);
            }
          },
          catch: transportError,
        }),
      ({ client, controller }) =>
        Effect.promise(async () => {
          controller.abort();
          await client.close().catch(() => undefined);
        }),
    ).pipe(Effect.timeout("10 seconds"), Effect.mapError(transportError));
  }
}
function responseError(status: number) {
  if (status === 401)
    return new CrewError("MEMOS_AUTH", "Memos authentication failed. Check the notebook token.");
  if (status === 403 || status === 404)
    return new CrewError("MEMOS_MISSING", "The selected thought is unavailable.");
  if (status === 409)
    return new CrewError("MEMOS_CONFLICT", "The memo identity is already in use.");
  return new CrewError(
    "MEMOS_UNAVAILABLE",
    "Memos could not complete the request. Retry the notebook connection.",
  );
}
const transportError = (error: unknown) => (error instanceof CrewError ? error : responseError(0));
