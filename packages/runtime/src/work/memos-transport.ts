import { WorkGraphError } from "../errors.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted } from "effect";
import { FetchHttpClient, type HttpClient, HttpClientRequest } from "effect/http";
import { CrewError } from "../domain.ts";

type Operation = "create" | "list" | "get";
const tools = {
  create: "memo_create_memo",
  list: "memo_list_memos",
  get: "memo_get_memo",
} as const;

export class MemosTransport {
  constructor(
    private connection: { instance: string; token: Redacted.Redacted<string> },
    private client: HttpClient.HttpClient,
  ) {}
  private get headers() {
    return { Authorization: "Bearer " + Redacted.value(this.connection.token) };
  }
  http(path: string, query: Record<string, string> = {}) {
    return Effect.gen({ self: this }, function* () {
      const url = yield* Effect.try({
        try: () => new URL("/api/" + path, this.connection.instance),
        catch: transportError,
      });
      const request = HttpClientRequest.get(url, {
        headers: this.headers,
        urlParams: query,
      });
      const response = yield* this.client.execute(request);
      if (response.status < 200 || response.status >= 300)
        return yield* responseError(response.status);
      return yield* response.json;
    }).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.timeout("10 seconds"),
      Effect.mapError(transportError),
    );
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
              try {
                await client.connect(transport);
              } catch (error) {
                if (op === "create")
                  throw new WorkGraphError(
                    "MEMOS_CREATE_UNSUBMITTED",
                    "Could not connect to submit the memo.",
                  );
                throw error;
              }
              const result = await client.callTool(
                { name: tools[op], arguments: args },
                undefined,
                { signal },
              );
              if (result.isError) {
                const first = Array.isArray(result.content) ? result.content[0] : undefined;
                const status =
                  first?.type === "text" ? Number(/^([0-9]{3})\b/u.exec(first.text)?.[1]) : 0;
                if (op === "create" && [400, 401, 403, 404, 422, 429].includes(status))
                  throw new WorkGraphError(
                    "MEMOS_CREATE_REFUSED",
                    "Memos refused the create request.",
                  );
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
    return new WorkGraphError(
      "MEMOS_AUTH",
      "Memos authentication failed. Check the notebook token.",
    );
  if (status === 403 || status === 404)
    return new WorkGraphError("MEMOS_MISSING", "The selected thought is unavailable.", status);
  if (status === 409)
    return new WorkGraphError("MEMOS_CONFLICT", "The memo identity is already in use.");
  return new WorkGraphError(
    "MEMOS_UNAVAILABLE",
    "Memos could not complete the request. Retry the notebook connection.",
  );
}
const transportError = (error: unknown) => (error instanceof CrewError ? error : responseError(0));
