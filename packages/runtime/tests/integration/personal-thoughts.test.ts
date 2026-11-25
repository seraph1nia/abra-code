import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { SqliteWorkGraph } from "../../src/work/graph.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "../../src/config/load.ts";
import { PersonalThoughts } from "../../src/work/thoughts.ts";
import { AbsolutePath, RequestId } from "@abracode/contracts/identities";
import { AgentMemory } from "../../src/memory/service.ts";
import { run } from "../effects.ts";

async function notebook(cleanup: (f: () => Promise<void>) => void) {
  const root = await mkdtemp(join(tmpdir(), "abra-thoughts-"));
  cleanup(() => rm(root, { recursive: true, force: true }));
  const state = {
    owner: "users/me",
    fail: false,
    visibility: "PRIVATE",
    text: 'literal "quoted"_%',
    space: "",
    loseCreate: false,
    refuseCreate: false,
    missingStatus: 404,
    createAttempts: [] as string[],
    deleted: false,
    beforeDetail: undefined as (() => Promise<void>) | undefined,
  };
  const calls: { path: string; filter: string; order: string }[] = [];
  const row = (id: string, content = state.text) => ({
    creator: "users/me",
    visibility: state.visibility,
    name: "memos/" + id,
    state: "NORMAL",
    createTime: "2026-01-01T10:00:00Z",
    updateTime: "2026-01-01T10:00:00Z",
    tags: ['a"b'],
    content,
    snippet: "same",
    ...(state.space ? { space: state.space } : {}),
  });
  const stored = new Map<string, string>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (state.fail || req.headers.authorization !== "Bearer test-token") {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    if (url.pathname === "/api/auth/me") {
      res.end(JSON.stringify({ user: { name: state.owner } }));
      return;
    }
    const mcp = url.pathname === "/mcp";
    let args = Object.fromEntries(url.searchParams);
    let id: number | undefined;
    let op = url.pathname === "/api/memos" ? "list" : "get";
    if (mcp) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body || "{}");
      id = message.id;
      if (message.method === "initialize") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "memos", version: "26.11.1" },
            },
          }),
        );
        return;
      }
      if (message.method !== "tools/call") {
        res.writeHead(202);
        res.end();
        return;
      }
      args = message.params.arguments;
      op = (
        { memo_get_memo: "get", memo_list_memos: "list", memo_create_memo: "create" } as Record<
          string,
          string
        >
      )[message.params.name]!;
      if (op === "create") {
        const { memoId, body: input } = message.params.arguments;
        state.createAttempts.push(memoId);
        if (state.refuseCreate || stored.has(memoId)) {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [
                  { type: "text", text: state.refuseCreate ? "429 Rate Limited" : "409 Conflict" },
                ],
              },
            }),
          );
          return;
        }
        stored.set(memoId, input.content);
        if (state.loseCreate) {
          req.socket.destroy();
          return;
        }
      }
    }
    const uid = args.memo ?? args.memoId ?? url.pathname.split("/").at(-1)!;
    if (op === "get" && (state.deleted || (uid.length === 36 && !stored.has(uid)))) {
      if (mcp)
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: String(state.missingStatus) }],
            },
          }),
        );
      else {
        res.writeHead(state.missingStatus);
        res.end("{}");
      }
      return;
    }
    if (op === "get") await state.beforeDetail?.();
    const result =
      op === "list"
        ? {
            memos: args.pageToken ? [row("a")] : [row("c"), row("b")],
            nextPageToken: args.pageToken ? "" : "page2",
          }
        : row(uid, stored.get(uid));
    if (op === "list")
      calls.push({ path: url.pathname, filter: args.filter!, order: args.orderBy! });
    res.end(
      JSON.stringify(
        mcp ? { jsonrpc: "2.0", id, result: { content: [], structuredContent: result } } : result,
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { memos } = await run(
    resolveConfig(
      root,
      join(root, "abracode.yaml"),
      `
version: 1
models: {default: {providerID: example, id: basic}}
memos: {instance: http://127.0.0.1:${address.port}, token: test-token}
`,
    ),
  );
  const config = { memos };
  const scope = Scope.makeUnsafe();
  cleanup(() => run(Scope.close(scope, Exit.void)));
  const graph = await run(
    SqliteWorkGraph.open(":memory:").pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return { root, config, state, stored, calls, service: new PersonalThoughts(config, graph) };
}

test("direct and MCP thoughts share literal filters, tied ordering, scoped pages and selection checks", async (t) => {
  const f = await notebook((fn) => t.onTestFinished(fn));
  const query = { text: f.state.text, tag: 'a"b', from: "2026-01-01", until: "2026-01-02" };
  const first = await run(f.service.list(query, "http"));
  assert.deepEqual(await run(f.service.list(query, "mcp")), first);
  assert.equal(f.calls[0]!.filter, f.calls[1]!.filter);
  assert.ok(f.calls[0]!.filter.includes("content.contains(" + JSON.stringify(query.text) + ")"));
  assert.ok(f.calls[0]!.filter.includes(JSON.stringify(query.tag) + " in tags"));
  assert.ok(f.calls[0]!.filter.includes("space == null"));
  assert.equal(f.calls[0]!.order, "create_time desc, name desc");
  const next = { ...query, cursor: first.next_cursor };
  const second = await run(f.service.list(next, "http"));
  assert.deepEqual(await run(f.service.list(next, "mcp")), second);
  assert.equal(second.entries[0]!.reference.name, "memos/a");
  const ref = first.entries[1]!.reference;
  const detail = await run(f.service.get(ref, "http"));
  assert.deepEqual(await run(f.service.get(ref, "mcp")), detail);
  assert.equal(detail.content, query.text);
  await assert.rejects(run(f.service.list({ ...next, tag: "other" }, "mcp")), /Restart the search/);
  await assert.rejects(run(f.service.list({ from: "2026-02-30" }, "http")), /valid UTC/);
  f.state.deleted = true;
  await assert.rejects(run(f.service.get(ref, "http")), /unavailable/);
  await assert.rejects(run(f.service.get(ref, "mcp")), /unavailable/);
  f.state.deleted = false;
  f.state.text = "replacement";
  await assert.rejects(run(f.service.get(ref, "http")), /reselect/);
  f.state.visibility = "PUBLIC";
  await assert.rejects(run(f.service.get(ref, "mcp")), /unavailable/);
  f.state.visibility = "PRIVATE";
  f.state.space = "spaces/shared";
  await assert.rejects(run(f.service.get(ref, "http")), /unavailable/);
  f.state.owner = "users/other";
  await assert.rejects(run(f.service.get(ref, "mcp")), /unavailable/);
  await assert.rejects(run(f.service.list(next, "http")), /Restart the search/);
  f.state.fail = true;
  await assert.rejects(run(f.service.list({}, "http")), /authentication/);
});

test("publishing a Thought validates the live private selection before contacting Basic Memory", async (t) => {
  const f = await notebook((fn) => t.onTestFinished(fn));
  const directory = join(f.root, "memory");
  const config = await run(
    resolveConfig(
      join(f.root, "app"),
      join(f.root, "abracode.yaml"),
      `version: 1\nmodels: {default: {providerID: fixture, id: fixture}}\nmemory: ${JSON.stringify({ enabled: true, directory, executable: "/missing/bm" })}`,
    ),
  );
  const memory = new AgentMemory(config, { projects: Effect.succeed([]) }, f.service);
  t.onTestFinished(() => run(memory.close));
  f.state.text = "One sentence. Another sentence.";
  const reference = (await run(f.service.list({}, "http"))).entries[0]!.reference;
  const publish = (content = "One sentence.") =>
    run(
      memory.publish({
        request_id: RequestId.make("validation"),
        destination: { kind: "shared" },
        source: { kind: "thought", reference },
        content,
      }),
    );
  await assert.rejects(publish("Paraphrase."), /exact wording/);
  f.state.text += " Updated.";
  await assert.rejects(publish(), /reselect/);
  f.state.text = "One sentence. Another sentence.";
  f.state.deleted = true;
  await assert.rejects(publish(), /unavailable/);
  f.state.deleted = false;
  f.state.owner = "users/other";
  await assert.rejects(publish(), /unavailable/);
  assert.deepEqual(await readdir(join(directory, "vault")), []);
});

test("durable save reservations reconcile concurrent writes and lost responses without changing the wording", async (t) => {
  const f = await notebook((fn) => t.onTestFinished(fn));
  const { RequestId } = await import("@abracode/contracts/identities");
  const path = AbsolutePath.make(join(f.root, "graph.sqlite"));
  const input = { request_id: RequestId.make("trip-1"), content: "  first\nsecond\r\n" };
  const save = (request = input) =>
    run(
      Effect.flatMap(SqliteWorkGraph.open(path), (graph) =>
        new PersonalThoughts(f.config, graph).save(request),
      ),
    );
  f.state.loseCreate = true;
  const concurrent = await Promise.allSettled([save(), save()]);
  assert.ok(concurrent.some((r) => r.status === "fulfilled"));
  const ref = await save();
  assert.equal(f.stored.size, 1);
  assert.equal(f.stored.get(ref.name.slice(6)), input.content);
  await assert.rejects(save({ ...input, content: "something else" }), /different wording/);
  const another = await save({ ...input, request_id: RequestId.make("trip-2") });
  assert.notEqual(ref.name, another.name);
  f.stored.set(ref.name.slice(6), "external edit");
  await assert.rejects(save(), /differs/);
  assert.equal(f.stored.size, 2);
});

test("a refused save retries after verified absence and an uncertain save preserves deletion", async (t) => {
  const f = await notebook((fn) => t.onTestFinished(fn));
  const path = AbsolutePath.make(join(f.root, "retry.sqlite"));
  const save = (id: string) =>
    run(
      Effect.flatMap(SqliteWorkGraph.open(path), (graph) =>
        new PersonalThoughts(f.config, graph).save({
          request_id: RequestId.make(id),
          content: "original",
        }),
      ),
    );
  f.state.refuseCreate = true;
  await assert.rejects(save("refused"), { code: "MEMOS_UNRESOLVED" });
  f.state.refuseCreate = false;
  f.state.missingStatus = 403;
  await assert.rejects(save("refused"), { code: "MEMOS_UNRESOLVED" });
  assert.equal(f.state.createAttempts.length, 1);
  f.state.missingStatus = 404;
  const ref = await save("refused");
  assert.deepEqual(f.state.createAttempts, Array(2).fill(ref.name.slice(6)));
  f.state.loseCreate = true;
  f.state.deleted = true;
  await assert.rejects(save("uncertain"), { code: "MEMOS_UNRESOLVED" });
  const submitted = f.state.createAttempts.at(-1)!;
  assert.equal(f.stored.delete(submitted), true);
  await assert.rejects(save("uncertain"), { code: "MEMOS_UNRESOLVED" });
  assert.equal(f.state.createAttempts.length, 3);
  assert.equal(f.stored.has(submitted), false);
});

test("ordinary intake keeps only the accepted excerpt and replays after an external edit and database restart", async (t) => {
  const f = await notebook((fn) => t.onTestFinished(fn));
  const { fixture } = await import("../fixtures.ts");
  const { WorkIntake } = await import("../../src/work/intake.ts");
  const { RepositoryId, SessionId, RequestId } = await import("@abracode/contracts/identities");
  const app = await run(fixture);
  t.onTestFinished(() => run(app.close()));
  f.state.text = "private context\naccepted words";
  const ref = (await run(f.service.list({}, "http"))).entries[0]!.reference;
  const request = {
    repository_id: RepositoryId.make("frontend"),
    title: "Create view",
    description: "Build weekly planning",
    request_id: RequestId.make("weekly"),
    thought_source: { reference: ref, excerpt: "accepted words" },
  };
  Object.assign(app.config, f.config);
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  f.state.beforeDetail = () =>
    run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const saving = yield* app.controller
          .createWork(request, SessionId.make("ses_supervisor"))
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* app.records
          .coordinateCommit(() => Effect.void)
          .pipe(Effect.timeout("1 second"), Effect.ensuring(Deferred.succeed(release, undefined)));
        yield* Fiber.join(saving);
      }),
    ),
  );
  f.state.beforeDetail = undefined;
  const path = AbsolutePath.make(join(f.root, "intake.sqlite"));
  const submit = (input = request) =>
    run(
      Effect.flatMap(SqliteWorkGraph.open(path), (graph) =>
        new WorkIntake(graph, app.records, "full-openspec", { ...app.config, ...f.config })
          .prepareIntake(input, SessionId.make("ses_supervisor"))
          .pipe(Effect.flatMap((request) => graph.create(request))),
      ),
    );
  await assert.rejects(
    submit({ ...request, repository_id: RepositoryId.make("unknown") }),
    /Register the repository/,
  );
  await assert.rejects(
    submit({ ...request, thought_source: { ...request.thought_source, excerpt: "not present" } }),
    /exact wording/,
  );
  const created = await submit();
  f.state.text = "changed";
  const replay = await submit();
  assert.equal(replay.id, created.id);
  assert.deepEqual(replay.thought_source, request.thought_source);
  assert.ok(!JSON.stringify(replay).includes("private context"));
  await assert.rejects(submit({ ...request, description: "other goal" }), /different goal/);
  await assert.rejects(submit({ ...request, request_id: RequestId.make("different") }), /reselect/);
});
