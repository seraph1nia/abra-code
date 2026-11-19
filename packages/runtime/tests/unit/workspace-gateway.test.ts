import assert from "node:assert/strict";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import type { Context } from "@opencode/plugin/effect/plugin";
import { NativeSessionReader } from "../../src/opencode/agui/source.ts";
import { catalogId, validateSurface } from "../../src/web/surfaces.ts";
import { SurfacePublications } from "../../src/web/surface-publications.ts";
import { MessageId, StoragePrefix, StorageKey } from "../../src/identities.ts";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { registerWebGateway } from "../../src/web/gateway.ts";
import { Reviews } from "../../src/web/reviews.ts";
import { CrewError } from "../../src/domain.ts";
import { AbsolutePath, AgentId } from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { WorkspaceFixture } from "../helpers/web.ts";
import { run } from "../effects.ts";

async function registeredGateway(f: Effect.Success<typeof fixture>, workspace: WorkspaceFixture) {
  const id = workspace.sessionID;
  const handlers: Record<
    string,
    (input: unknown, context: unknown) => Effect.Effect<unknown, CrewError>
  > = {};
  const reads: string[] = [];
  const ctx = {
    storage: {
      get: (key: StorageKey) => f.records.store.get(key),
      scan: ({ prefix }: { prefix: string }) =>
        Effect.sync(() => {
          reads.push(prefix);
          return prefix;
        }).pipe(
          Effect.flatMap((key) => f.records.store.entries(StoragePrefix.make(key))),
          Effect.map((entries) => ({ entries })),
        ),
    },
    rpc: {
      register: (_: unknown, methods: typeof handlers) =>
        Effect.sync(() => Object.assign(handlers, methods)),
    },
  } as unknown as Context;
  const sessions = vi.spyOn(f.controller.queries, "session").mockImplementation(() =>
    Effect.succeed({
      id,
      agent: AgentId.make("abra"),
      busy: false,
      directory: f.config.home,
      metadata: { abracode_supervisor_home: f.config.home },
    }),
  );
  const assignments = vi.spyOn(f.controller.queries, "assignment");
  const scans = vi.spyOn(f.records, "executionScan");
  const reviews = new Reviews(f.records.store, f.locks, () =>
    Effect.fail(new CrewError("TEST", "Unexpected source read")),
  );
  await run(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- The native registration API exposes an unknown error channel.
    registerWebGateway(
      ctx,
      f.config,
      f.controller,
      reviews,
      Effect.succeed({ agents: [] }),
      (e) => e,
    ).pipe(Effect.mapError(CrewError.from)),
  );
  const dispatch = Object.fromEntries(
    Object.keys(handlers).map((name) => [
      name,
      (input: unknown) =>
        handlers[name]!(input, {
          error: (kind: string, message: string, data: { code: string }) =>
            new CrewError(data.code, message, kind),
        }),
    ]),
  );
  return { id, dispatch, reviews, sessions, assignments, scans, reads };
}

test("fallback, receipt-only and empty refreshes bound supervisor discovery to requested sections", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const workspace = new WorkspaceFixture();
  const { id, dispatch, sessions, assignments, scans, reads } = await registeredGateway(
    f,
    workspace,
  );
  const reader = vi.spyOn(NativeSessionReader.prototype, "read").mockReturnValue(
    Effect.succeed({
      client: {
        session: { form: { list: () => Effect.succeed([]) } },
        permission: { list: () => Effect.succeed([]) },
        rpc: (definition: { id: string }) =>
          definition.id === "abracode-web"
            ? dispatch
            : { snapshot: () => Effect.succeed(workspace.value.work) },
      },
      session: {},
      messages: [],
      inbox: [],
      busy: false,
      page: { data: [], cursor: {} },
    } as unknown as Effect.Success<ReturnType<NativeSessionReader["read"]>>),
  );
  t.onTestFinished(() => reader.mockRestore());
  const backend = new NativeWebBackend(AbsolutePath.make(f.config.home), id, Effect.undefined);
  for (const [scope, count] of [
    [{ all: true }, 1],
    [{ admissions: true }, 1],
    [{}, 0],
  ] as const) {
    sessions.mockClear();
    assignments.mockClear();
    scans.mockClear();
    reads.length = 0;
    const value = await run(backend.observe(scope));
    assert.equal(value.session_id, id);
    assert.deepEqual(
      [sessions.mock.calls.length, assignments.mock.calls.length, scans.mock.calls.length],
      [count, count, count],
    );
    if (!("all" in scope)) assert.deepEqual(reads, count ? [`web/receipt/${id}/`] : []);
  }
  const layouts = new SurfacePublications(f.records.store, f.locks);
  const layout = validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: "board",
      catalogId,
      components: [{ id: "root", component: "Text", text: "Committed" }],
    },
  });
  const source = {
    session_id: id,
    message_id: MessageId.make("msg_first"),
    call_id: "call",
    surface: layout,
  };
  await run(layouts.publish(source, Effect.succeed(workspace.value.work)));
  const headKey = StorageKey.make(`web/surface-head/${id}/board`);
  const set = f.records.store.set.bind(f.records.store);
  const suspended = vi
    .spyOn(f.records.store, "set")
    .mockImplementation((key, value) =>
      key === headKey && !(value && typeof value === "object" && "pending" in value)
        ? Effect.fail(new CrewError("TEST", "Stopped before head commit"))
        : set(key, value),
    );
  const second = MessageId.make("msg_second");
  await assert.rejects(
    run(layouts.publish({ ...source, message_id: second }, Effect.succeed(workspace.value.work))),
    /before head commit/,
  );
  suspended.mockRestore();
  await run(set(StorageKey.make(`web/surface/${id}/corrupt`), {}));
  await run(set(StorageKey.make(`web/surface-head/${id}/corrupt`), { schema_version: 99 }));
  const view = await run(backend.observe({ presentations: true }));
  assert.deepEqual(
    view.surfaces.map((row) => ("revision" in row ? row.revision : "unavailable")),
    [1, "unavailable"],
  );
  const attachments = await run(dispatch.presentations!({ session_id: id, message_ids: [second] }));
  assert.deepEqual(attachments, { entries: [], diagnostics: [], truncated: false });
  const unavailable = await run(
    dispatch.surface!({ session_id: id, surface_id: "board", revision: 2 }),
  );
  assert.ok(unavailable && typeof unavailable === "object" && "unavailable" in unavailable);
  sessions.mockImplementation(() => Effect.fail(new CrewError("STALE", "Session changed")));
  await assert.rejects(run(backend.observe({ admissions: true })), /Session changed/);
  await assert.rejects(run(dispatch.submit!({ session_id: id })), /Session changed/);
});

test("registered review handlers authorize before calling the owner and preserve RPC refusals", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id, dispatch, reviews, sessions } = await registeredGateway(f, new WorkspaceFixture());
  const input = { session_id: id };
  assert.deepEqual(await run(dispatch.reviewList!(input)), await run(reviews.list(id)));

  const methods = [
    ["reviewReceipt", "receipt"],
    ["reviewList", "list"],
    ["review", "read"],
    ["reviewAsset", "asset"],
    ["reviewSubmit", "submit"],
  ] as const;
  const error = new CrewError("REVIEW_REFUSED", "Revision changed");
  const owners = methods.map(([handler, method]) => ({
    handler,
    owner: vi.spyOn(reviews, method).mockReturnValue(Effect.fail(error)),
  }));

  for (const { handler, owner } of owners) {
    sessions.mockReturnValueOnce(
      Effect.succeed({
        id,
        agent: AgentId.make("apply"),
        directory: f.config.home,
        busy: false,
      }),
    );
    await assert.rejects(run(dispatch[handler]!(input)), {
      details: "refused",
      code: "ABRA_REQUIRED",
      message: "Use the single central Abra session",
    });
    assert.equal(owner.mock.calls.length, 0);
  }
  for (const { handler, owner } of owners) {
    await assert.rejects(run(dispatch[handler]!(input)), {
      details: "refused",
      code: error.code,
      message: error.message,
    });
    assert.equal(owner.mock.calls.length, 1);
  }
});
