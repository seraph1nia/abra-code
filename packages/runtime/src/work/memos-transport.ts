import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted } from "effect";
import { CrewError } from "../domain.ts";

type Operation = "create" | "list" | "get";
const tools = {
  create: "memo_create_memo",
  list: "memo_list_memos",
  get: "memo_get_memo",
} as const;
export class MemosTransport {
  constructor(private connection: { instance: string; token: Redacted.Redacted<string> }) {}
  private get headers() {
    return { Authorization: "Bearer " + Redacted.value(this.connection.token) };
  }
  http(path: string, query: Record<string, string> = {}) {
    return Effect.tryPromise({
      try: async (signal): Promise<unknown> => {
        const url = new URL("/api/" + path, this.connection.instance);
        url.search = new URLSearchParams(query).toString();
        const response = await fetch(url, {
          headers: this.headers,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw responseError(response.status);
        return response.json();
      },
      catch: transportError,
    });
  }
  mcp(op: Operation, args: Record<string, unknown>) {
    return Effect.tryPromise({
      try: async (signal): Promise<unknown> => {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
        const client = new Client({ name: "abracode", version: "1" });
        const transport = new StreamableHTTPClientTransport(
          new URL("/mcp", this.connection.instance),
          {
            requestInit: { headers: this.headers, redirect: "error" },
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                redirect: "error",
                signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
              }),
          },
        );
        try {
          await client.connect(transport);
          const result = await client.callTool({ name: tools[op], arguments: args }, undefined, {
            signal: deadline,
          });
          if (result.isError) {
            const first = Array.isArray(result.content) ? result.content[0] : undefined;
            const status =
              first?.type === "text" ? Number(/^([0-9]{3})\b/u.exec(first.text)?.[1]) : 0;
            throw responseError(status);
          }
          return result.structuredContent;
        } finally {
          await client.close();
        }
      },
      catch: transportError,
    });
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
