import { validateSurface } from "@abracode/contracts/web/surfaces";
import { catalogId, workCatalogDocument } from "@abracode/contracts/web/catalog";
import { presentationHash } from "../../src/presentation/identity.ts";
import { NativeSessionProjection } from "../../src/opencode/agui/native-state.ts";
import { SessionMessage } from "@opencode/schema/session-message";
import { projectNativeMessage } from "../../src/opencode/agui/messages.ts";
import { HttpAgent } from "@ag-ui/client";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { SessionId, Timestamp, RepositoryId } from "@abracode/contracts/identities";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { Effect, Exit, Scope, PubSub, Stream, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { workspaceApi } from "@abracode/contracts/web/http-api";
import { workspaceServer } from "../../src/web/server.ts";
import { RequestId, ContentHash, IssueId } from "@abracode/contracts/identities";
import { WorkspaceFixture } from "../helpers/web.ts";
import { CrewError } from "../../src/domain.ts";
import { nativeRpcError, readWorkReport } from "../../src/web/native-errors.ts";

async function fixture(assets?: string, configure?: (backend: WorkspaceFixture) => void) {
  const backend = new WorkspaceFixture();
  configure?.(backend);
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend, assets }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const client = await Effect.runPromise(
    HttpApiClient.make(workspaceApi, {
      baseUrl: web.origin,
      transformClient: (client) =>
        HttpClient.mapRequest(client, HttpClientRequest.setHeader("origin", web.origin)),
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  return { ...web, backend, client, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}

test("shared HttpApiClient validates workspace reads, payloads and typed failures", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const snapshot = await Effect.runPromise(web.client.workspace.bootstrap());
  const work = snapshot.work.work[0];
  web.backend.work.overview = () =>
    Effect.succeed({ work, description: "Selected work", errors: [] });
  assert.deepEqual(
    await Effect.runPromise(web.client.work.overview({ query: { issue_id: work.issue_id } })),
    { work, description: "Selected work", errors: [] },
  );
  assert.equal(snapshot.session_id, web.backend.sessionID);
  assert.equal(snapshot.work.work[0].title, "Build a single workspace");
  const stopResponse = await fetch(
    `${web.origin}/api/copilotkit/agent/abra/stop/${web.backend.sessionID}`,
    {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(stopResponse.status, 200);
  const stopBody = (await stopResponse.json()) as { stopped?: boolean };
  assert.equal(stopBody.stopped, true);
  assert.equal(web.backend.stops, 1);
  const invalid = await fetch(`${web.origin}/api/form/reply`, {
    method: "POST",
    headers: { origin: web.origin, "content-type": "application/json" },
    body: JSON.stringify({ id: "wrong", binding: "x", answer: {}, extra: true }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(web.backend.replies, 0);
  const mismatch = await Effect.runPromise(
    web.client.work
      .report({ query: { issue_id: snapshot.work.work[0].issue_id } })
      .pipe(Effect.result),
  );
  assert.equal(mismatch._tag, "Failure");
  if (mismatch._tag === "Failure") assert.equal(mismatch.failure._tag, "WorkspaceError");
});

test("report HTTP reads return ordinary absence without hiding native integrity or ownership failures", async (t) => {
  let code = "REPORT_REQUIRED";
  let taskExists = true;
  const web = await fixture(undefined, (backend) => {
    backend.work.report = () =>
      readWorkReport(
        Effect.suspend(() =>
          code === "published"
            ? Effect.succeed({ content: "# Published report" })
            : Effect.fail(
                nativeRpcError({
                  type: code === "EXECUTION_MISSING" ? "not_found" : "resource_unavailable",
                  message: "Native report unavailable",
                  data: { code },
                }),
              ),
        ),
        Effect.suspend(() =>
          taskExists ? Effect.void : Effect.fail(new CrewError("ISSUE_MISSING", "Unknown task")),
        ),
      );
  });
  t.onTestFinished(web.close);
  const read = () =>
    Effect.runPromise(web.client.work.report({ query: { issue_id: IssueId.make("abra-web") } }));
  assert.deepEqual(await read(), { unavailable: "not_published" });
  code = "EXECUTION_MISSING";
  assert.deepEqual(await read(), { unavailable: "not_started" });
  taskExists = false;
  await assert.rejects(read(), /This task is no longer available/);
  assert.equal((await fetch(`${web.origin}/api/work/report?issue_id=abra-web`)).status, 404);
  taskExists = true;
  code = "REPORT_TAMPERED";
  const damaged = await fetch(`${web.origin}/api/work/report?issue_id=abra-web`);
  assert.equal(damaged.status, 409);
  assert.deepEqual(await damaged.json(), {
    _tag: "WorkspaceError",
    code: "REPORT_TAMPERED",
    message: "The retained report failed its integrity check and cannot be displayed.",
  });
  code = "published";
  assert.deepEqual(await read(), { content: "# Published report" });
  web.backend.work.report = () =>
    Effect.fail(nativeRpcError({ type: "rpc.method_not_found", message: "Unknown RPC method" }));
  const outdated = await fetch(`${web.origin}/api/work/report?issue_id=abra-web`);
  assert.equal(outdated.status, 503);
  const failure = await outdated.json();
  assert.equal(failure.code, "WEB_NATIVE_UPDATE_REQUIRED");
  assert.match(failure.message, /Restart the service to load the updated plugin/);
  assert.equal(web.backend.submissions, 0);
});

test("typed exact admission reads are independent of recent history and never submit input", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const original = await Effect.runPromise(
    web.backend.submit({
      request_id: "old-admission",
      text: "Preserve this input",
      delivery: "queue",
    }),
  );
  web.backend.value = {
    ...web.backend.value,
    receipts: Array.from({ length: 100 }, (_, index) => ({
      ...original,
      request_id: `later-${index}`,
      text: `Later input ${index}`,
    })),
  };
  assert.deepEqual(
    await Effect.runPromise(
      web.client.workspace.receipt({
        query: { request_id: original.request_id },
      }),
    ),
    original,
  );
  assert.equal(
    await Effect.runPromise(
      web.client.workspace.receipt({
        query: { request_id: "missing" },
      }),
    ),
    null,
  );
  assert.equal(web.backend.submissions, 1);
  for (const query of [
    "request_id=../foreign",
    "request_id=",
    "request_id=old-admission&session_id=ses_foreign",
    "request_id=old-admission&action=submit",
  ])
    assert.equal((await fetch(`${web.origin}/api/admission/receipt?${query}`)).status, 400);
  assert.equal(
    (
      await fetch(`${web.origin}/api/admission/receipt?request_id=old-admission`, {
        headers: { origin: "http://foreign.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(web.backend.submissions, 1);
});

test("snapshot saves reject invalid or executable inputs before entering the artifact owner", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let saves = 0;
  const original = web.backend.saveSurface;
  web.backend.saveSurface = (input) => {
    saves++;
    return original(input);
  };
  const valid = {
    issue_id: "abra-web",
    request_id: "snapshot-request",
    surface_id: "workView",
    revision: 1,
  };
  for (const update of [
    { revision: 0 },
    { revision: -1 },
    { surface_id: "../secret" },
    { action: "approve" },
    { document: { html: "<script>execute()</script>" } },
  ]) {
    const response = await fetch(`${web.origin}/api/report/save-surface`, {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: JSON.stringify({ ...valid, ...update }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(saves, 0);
  assert.equal(
    (
      await fetch(`${web.origin}/api/report/save-surface`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid),
      })
    ).status,
    403,
  );
  assert.equal(saves, 0);
});

test("Effect HTTP boundary rejects foreign origins, raw native routes and encoded traversal", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  for (const path of [
    "/api/session",
    "/api/server",
    "/api/auth",
    "/api/pair",
    "/api/copilotkit/threads",
    "/api/copilotkit/agent/worker/run",
  ]) {
    assert.equal((await fetch(`${web.origin}${path}`)).status, 404, path);
  }
  assert.equal(
    (await fetch(`${web.origin}/api/bootstrap`, { headers: { origin: "http://localhost:1" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(`${web.origin}/api/copilotkit/agent/abra/stop/${web.backend.sessionID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(web.backend.stops, 0);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(web.origin, { path: "/assets/%2e%2e/package.json" }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 400);
  const rebound = await new Promise<number>((resolve, reject) => {
    const req = request(
      web.origin,
      { path: "/api/bootstrap", headers: { host: "evil.local" } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(rebound, 403);
});

test("resource capability HTTP requests reject unsafe and unknown actions before backend reads", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let resolutions = 0;
  web.backend.resolve = (target) =>
    Effect.sync(() => {
      resolutions++;
      return target;
    });
  for (const target of [
    { action: "open_changes", issue_id: "abra-web", file: "../secret" },
    { action: "open_session", issue_id: "abra-web", session_id: "../foreign" },
    { action: "execute", issue_id: "abra-web" },
    { action: "open_task", issue_id: "abra-web", tool: "approve" },
  ]) {
    const response = await fetch(`${web.origin}/api/work/resolve`, {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: JSON.stringify(target),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(resolutions, 0);
  assert.equal(web.backend.reads, 0);
  assert.equal(web.backend.submissions, 0);
  const target = {
    action: "open_task" as const,
    issue_id: web.backend.value.work.work[0].issue_id,
    section: "summary" as const,
  };
  assert.deepEqual(await Effect.runPromise(web.client.work.resolve({ payload: target })), target);
  assert.equal(resolutions, 1);
  assert.equal(web.backend.submissions, 0);
});

test("typed work discovery enforces query bounds before reads and retains continuation metadata", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let reads = 0;
  web.backend.work.find = () =>
    Effect.sync(() => {
      reads++;
      return {
        entries: web.backend.value.work.work,
        total: 56,
        offset: 0,
        limit: 50,
        next_offset: 50,
        observed_at: web.backend.value.work.at,
      };
    });
  for (const query of ["limit=51", "offset=-1", "state=running", "tool=execute"]) {
    assert.equal((await fetch(`${web.origin}/api/work/find?${query}`)).status, 400);
  }
  assert.equal(reads, 0);
  const page = await Effect.runPromise(
    web.client.work.find({ query: { state: "closed", search: "result" } }),
  );
  assert.equal(page.total, 56);
  assert.equal(page.next_offset, 50);
  assert.equal(page.entries[0].issue_id, "abra-web");
  assert.equal(reads, 1);
  assert.equal(web.backend.submissions, 0);
});

test("CopilotKit v2 Fetch handler transports AG-UI and binds one native session", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const info = await (await fetch(`${web.origin}/api/copilotkit/info`)).json();
  assert.equal(info.telemetryDisabled, true);
  assert.equal(info.a2uiEnabled, false);
  const headers = {
    origin: web.origin,
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  const input = {
    threadId: web.backend.sessionID,
    runId: "run-fixture",
    messages: [{ id: "ui-1", role: "user", content: "Build a work view" }],
    tools: [],
    context: [],
    state: { workspace: { busy: false, session_id: "ignored" } },
    forwardedProps: { request_id: "stable-fixture" },
  };
  const wrong = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, threadId: "ses_worker" }),
  });
  assert.equal(wrong.status, 403);
  assert.equal(web.backend.submissions, 0);
  const response = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.match(events, /RUN_STARTED/);
  assert.match(events, /MESSAGES_SNAPSHOT/);
  assert.match(events, /RUN_FINISHED/);
  assert.equal(web.backend.submissions, 1);
  const retry = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  await retry.text();
  assert.equal(web.backend.submissions, 1);
});

test("retired HTML artifact routes are unavailable", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const query = {
    issue_id: web.backend.value.work.work[0].issue_id,
    request_id: RequestId.make("published-report"),
  };
  for (const path of ["preview", "download"]) {
    assert.equal(
      (await fetch(web.origin + "/api/report/" + path + "?" + new URLSearchParams(query))).status,
      404,
    );
  }
});

test("worker history HTTP queries are fixed, typed and reject excess capabilities before a read", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let reads = 0;
  web.backend.work["worker-history"] = () =>
    Effect.sync(() => {
      reads++;
      return {
        session_id: SessionId.make("ses_owned"),
        observed_at: Timestamp.make("2026-11-16T00:00:00Z"),
        messages: [],
      };
    });
  const base = "/api/work/worker-history?issue_id=abra-web&session_id=ses_owned";
  for (const suffix of ["&tool=stop", "&location=/private", "&cursor=" + "x".repeat(4097)]) {
    assert.equal((await fetch(web.origin + base + suffix)).status, 400);
  }
  assert.equal(reads, 0);
  const response = await fetch(web.origin + base);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, []);
  assert.equal(reads, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test("lead reads require one bounded scope and reject management capabilities before the backend", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let reads = 0;
  web.backend.work.leads = () =>
    Effect.sync(() => {
      reads++;
      return {
        repository_id: RepositoryId.make("fixture"),
        observed_at: Timestamp.make("2026-11-16T01:00:00Z"),
        entries: [],
        total: 0,
        offset: 0,
        diagnostics: [],
      };
    });
  for (const query of [
    "",
    "issue_id=abra-web&repository_id=fixture",
    "repository_id=fixture&action=accept",
    "repository_id=fixture&offset=-1",
    "repository_id=fixture&lead_id=../foreign",
  ]) {
    assert.equal((await fetch(`${web.origin}/api/work/leads?${query}`)).status, 400, query);
  }
  assert.equal(reads, 0);
  const valid = await fetch(`${web.origin}/api/work/leads?repository_id=fixture`);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).total, 0);
  assert.equal(reads, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test("explicit report exports use fixed identities and opaque preview without prompt submission", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const query = {
    issue_id: web.backend.value.work.work[0].issue_id,
    request_id: RequestId.make("exported-report"),
    hash: ContentHash.make("a".repeat(64)),
  };
  let exports = 0,
    reads = 0;
  const receipt = {
    document_hash: query.hash,
    exporter_hash: ContentHash.make("b".repeat(64)),
    hash: ContentHash.make("c".repeat(64)),
    bytes: 42,
  };
  web.backend.exportDocument = () =>
    Effect.sync(() => {
      exports++;
      return receipt;
    });
  web.backend.readExport = () =>
    Effect.sync(() => {
      reads++;
      return { ...receipt, html: "<!doctype html><p>Exported evidence</p>" };
    });
  const invalid = await fetch(`${web.origin}/api/report/export`, {
    method: "POST",
    headers: { origin: web.origin, "content-type": "application/json" },
    body: JSON.stringify({ ...query, path: "/private" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(exports, 0);
  assert.deepEqual(
    await Effect.runPromise(web.client.work.exportDocument({ payload: query })),
    receipt,
  );
  assert.equal(exports, 1);
  const url = new URLSearchParams({ ...query, exporter_hash: receipt.exporter_hash });
  const preview = await fetch(`${web.origin}/api/report/export/preview?${url}`);
  assert.match(await preview.text(), /Exported evidence/);
  assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
  assert.doesNotMatch(preview.headers.get("content-security-policy") ?? "", /allow-same-origin/);
  const download = await fetch(`${web.origin}/api/report/export/download?${url}`);
  assert.match(
    download.headers.get("content-disposition") ?? "",
    /attachment; filename="abra-report-exported-report.html"/,
  );
  assert.equal(reads, 2);
  assert.equal(exports, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test("workspace serves the exact versioned discovery documents", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const response = await fetch(web.origin + "/catalog/work/v1/catalog.json");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), workCatalogDocument);
  assert.equal((await fetch(web.origin + "/catalog/work-v5.json")).status, 404);
});

test("hashed public assets cache immutably and use package compression while private responses stay fresh", async (t) => {
  const assets = await mkdtemp(join(tmpdir(), "abra-web-assets-"));
  t.onTestFinished(() => rm(assets, { recursive: true, force: true }));
  await mkdir(join(assets, "assets"));
  const first = "export const greeting = 'hello';\n".repeat(256);
  const second = first + "export const version = 2;\n";
  await writeFile(join(assets, "index.html"), "<!doctype html><p>Current app</p>");
  await writeFile(join(assets, "assets", "app-abc12345.js"), first);
  await writeFile(join(assets, "assets", "app-def67890.js"), second);
  await writeFile(join(assets, "assets", "mutable.js"), first);
  const web = await fixture(assets);
  t.onTestFinished(web.close);
  const assetURL = web.origin + "/assets/app-abc12345.js";
  const response = await fetch(assetURL);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await response.text(), first);
  assert.equal(await (await fetch(assetURL)).text(), first);
  assert.equal(await (await fetch(web.origin + "/assets/app-def67890.js")).text(), second);
  const compressed = await new Promise<{ body: Buffer; encoding?: string; vary?: string }>(
    (resolve, reject) => {
      request(assetURL, { headers: { "accept-encoding": "gzip" } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            encoding: response.headers["content-encoding"],
            vary: response.headers.vary,
          }),
        );
        response.on("error", reject);
      })
        .on("error", reject)
        .end();
    },
  );
  assert.equal(compressed.encoding, "gzip");
  assert.match(compressed.vary ?? "", /accept-encoding/i);
  assert.equal(gunzipSync(compressed.body).toString(), first);
  assert.ok(compressed.body.length < Buffer.byteLength(first) / 2);
  for (const path of ["/", "/api/bootstrap", "/assets/mutable.js", "/assets/missing-abc12345.js"]) {
    const response = await fetch(web.origin + path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
  }
  const forbidden = await fetch(assetURL, { headers: { origin: "https://foreign.example" } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("cache-control"), "no-store");
});

test("fixed binding HTTP read validates bounded references and never admits input", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const id = web.backend.value.work.work[0]!.issue_id;
  const result = await Effect.runPromise(
    web.client.work.binding({ query: { issue_ids: [id], include_population: true } }),
  );
  assert.equal(result.work[0]!.issue_id, id);
  assert.equal(result.coverage.total, 1);
  const population = await Effect.runPromise(
    web.client.work.binding({ query: { issue_ids: [], include_population: true } }),
  );
  assert.deepEqual(population.work, result.work);
  assert.deepEqual(population.coverage.requested_ids, []);
  assert.equal(web.backend.submissions, 0);
  for (const query of [
    "issue_ids=../foreign",
    "issue_ids=abra-web&session_id=ses_foreign",
    "issue_ids=abra-web&include_population=garbage",
  ]) {
    assert.equal((await fetch(`${web.origin}/api/work/binding?${query}`)).status, 400);
  }
  const query = new URLSearchParams();
  for (let i = 0; i < 101; i++) query.append("issue_ids", `abra-${i}`);
  assert.equal((await fetch(`${web.origin}/api/work/binding?${query}`)).status, 400);
  assert.equal(web.backend.reads, 0);
});

test("standard AG-UI client runs, retries and detaches from the hosted native adapter", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const run = () =>
    new HttpAgent({
      url: `${web.origin}/api/copilotkit/agent/abra/run`,
      headers: { origin: web.origin },
      agentId: "abra",
      threadId: web.backend.sessionID,
      initialMessages: [{ id: "standard-input", role: "user", content: "Standard consumer input" }],
    });
  const first = run();
  await first.runAgent({
    tools: [],
    context: [],
    forwardedProps: { request_id: "standard-consumer" },
  });
  assert.equal(first.messages.filter((message) => message.role === "assistant").length, 1);
  const retry = run();
  await retry.runAgent({
    tools: [],
    context: [],
    forwardedProps: { request_id: "standard-consumer" },
  });
  assert.equal(web.backend.submissions, 1);
  const observe = new HttpAgent({
    url: `${web.origin}/api/copilotkit/agent/abra/connect`,
    headers: { origin: web.origin },
    agentId: "abra",
    threadId: web.backend.sessionID,
  });
  let baseline = false;
  await observe.runAgent(
    {},
    {
      onMessagesSnapshotEvent: () => {
        baseline = true;
        void observe.detachActiveRun();
      },
    },
  );
  assert.equal(baseline, true);
  assert.equal(web.backend.stops, 0);
  assert.equal(web.backend.submissions, 1);
});

test("HTTP observers reconnect during tool arguments without replay or duplicated arguments/results", async (t) => {
  const signals = await Effect.runPromise(
    PubSub.unbounded<{
      transcript: true;
      native: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope;
    }>(),
  );
  t.onTestFinished(() => Effect.runPromise(PubSub.shutdown(signals)));
  const projection = new NativeSessionProjection("ses_webfixture");
  const user = Schema.decodeSync(SessionMessage.User)({
    id: "msg_http-stream",
    type: "user",
    text: "Observe only",
    time: { created: 0 },
  });
  projection.baseline([user], true, []);
  let subscriptions = 0;
  const web = await fixture(undefined, (backend) => {
    backend.value = { ...backend.value, busy: true, messages: [projectNativeMessage(user)!] };
    Object.assign(backend, {
      nativeEvent: (event: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope) =>
        projection.apply(event),
      nativeSnapshot: () => projection.current(),
      changes: Stream.fromPubSub(signals).pipe(
        Stream.onStart(
          Effect.sync(() => {
            subscriptions++;
          }),
        ),
      ),
    });
  });
  t.onTestFinished(web.close);
  const observer = () =>
    new HttpAgent({
      url: `${web.origin}/api/copilotkit/agent/abra/connect`,
      headers: { origin: web.origin },
      agentId: "abra",
      threadId: web.backend.sessionID,
    });
  const wait = <T>(pending: Promise<T>, phase: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`HTTP observation stalled at ${phase}`)),
        5000,
      );
      pending.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const first = observer();
  let baseline!: () => void, fragment!: () => void;
  const ready = new Promise<void>((resolve) => {
    baseline = resolve;
  });
  const partial = new Promise<void>((resolve) => {
    fragment = resolve;
  });
  let parentSeen!: () => void, callSeen!: () => void;
  const parentReady = new Promise<void>((resolve) => {
    parentSeen = resolve;
  });
  const callReady = new Promise<void>((resolve) => {
    callSeen = resolve;
  });
  const observing = first.runAgent(
    {},
    {
      onMessagesSnapshotEvent: () => {
        baseline();
      },
      onTextMessageStartEvent: () => {
        parentSeen();
      },
      onToolCallStartEvent: () => {
        callSeen();
      },
      onToolCallArgsEvent: () => {
        fragment();
        void first.detachActiveRun();
      },
    },
  );
  t.onTestFinished(() => first.detachActiveRun());
  await wait(ready, "ready");
  let sequence = 0,
    counter = 0;
  const push = (type: string, data: object, ephemeral = false) =>
    Effect.runPromise(
      PubSub.publish(signals, {
        transcript: true,
        native: {
          id: `evt_http-${++counter}`,
          type,
          created: counter,
          ...(ephemeral
            ? {}
            : {
                durable: {
                  aggregateID: web.backend.sessionID,
                  seq: ++sequence,
                  version: type === "session.tool.success" ? 2 : 1,
                },
              }),
          data: { sessionID: web.backend.sessionID, ...data },
        },
      }),
    );
  const tool = { assistantMessageID: "msg_http-reply", id: "http-stream-call" };
  await push("session.step.started", {
    assistantMessageID: tool.assistantMessageID,
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    started: 1,
  });
  await wait(parentReady, "parentReady");
  await push("session.tool.input.started", { ...tool, name: "read_source" });
  await wait(callReady, "callReady");
  await push("session.tool.input.delta", { ...tool, delta: '{"path":' }, true);
  await wait(partial, "partial");
  await wait(observing, "observing");
  const second = observer();
  let resumed!: () => void, finished!: () => void;
  const restored = new Promise<void>((resolve) => {
    resumed = resolve;
  });
  const complete = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const connected = second.runAgent(
    {},
    {
      onMessagesSnapshotEvent: ({ event }) => {
        const messages = event.messages;
        const result = messages.find((message) => message.role === "tool");
        const call = messages.find(
          (message) => message.role === "assistant" && message.toolCalls?.length,
        );
        if (call) resumed();
        if (
          result &&
          call?.role === "assistant" &&
          call.toolCalls?.[0]?.metadata?.abracode_native_status === "completed"
        ) {
          finished();
          void second.detachActiveRun();
        }
      },
    },
  );
  t.onTestFinished(() => second.detachActiveRun());
  await wait(restored, "restored");
  await push("session.tool.input.delta", { ...tool, delta: '"source.ts"}' }, true);
  await push("session.tool.input.ended", { ...tool, text: '{"path":"source.ts"}' });
  await push("session.tool.called", { ...tool, input: { path: "source.ts" }, executed: true });
  await push("session.tool.success", {
    ...tool,
    content: [{ type: "text", text: "HTTP result once" }],
    executed: true,
  });
  await wait(complete, "complete");
  await wait(connected, "connected");
  const call = second.messages.find(
    (message) => message.role === "assistant" && message.toolCalls?.length,
  );
  assert.ok(call?.role === "assistant" && call.toolCalls?.[0]);
  assert.deepEqual(JSON.parse(call.toolCalls[0].function.arguments), { path: "source.ts" });
  assert.equal(second.messages.filter((message) => message.role === "tool").length, 1);
  assert.equal(subscriptions, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test(
  "diagram preparation HTTP selects exact retained sources and refuses foreign, stale and executable selectors",
  { timeout: 60000 },
  async (t) => {
    const web = await fixture();
    t.onTestFinished(web.close);
    const surface = validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "diagram-board",
        catalogId,
        components: [
          { id: "root", component: "Mermaid", title: "Observed", source: "flowchart LR\nA <--> B" },
        ],
      },
    });
    web.backend.value = {
      ...web.backend.value,
      surfaces: [
        {
          session_id: web.backend.sessionID,
          tool_call_id: "fixture",
          revision: 1,
          at: web.backend.value.at,
          surface,
          snapshot: [],
        },
      ],
    };
    for (const [owner, revision, available] of [
      [web.backend.sessionID, 1, true],
      ["ses_foreign", 1, false],
      [web.backend.sessionID, 2, false],
    ] as const) {
      const response = await fetch(
        web.origin +
          "/api/surface?" +
          new URLSearchParams({
            session_id: owner,
            revision: String(revision),
            surface_id: "diagram-board",
          }),
      );
      assert.equal(response.status, 200);
      const entry = await response.json();
      assert.equal("surface" in entry, available);
      if (available) assert.equal(entry.revision, revision);
    }
    const selection = {
      kind: "surface" as const,
      surface_id: "diagram-board",
      revision: 1,
      hash: presentationHash(surface),
    };
    const prepared = await Effect.runPromise(
      web.client.workspace.prepareDiagrams({ payload: selection }),
    );
    assert.equal(prepared.verified, true);
    assert.equal(prepared.assets[0]!.source, surface.createSurface.components[0]!.source);
    const second = await Effect.runPromise(
      web.client.workspace.prepareDiagrams({ payload: selection }),
    );
    assert.equal(second.metrics?.compilations, 0);
    for (const altered of [
      { ...selection, hash: ContentHash.make("a".repeat(64)) },
      { ...selection, revision: 2 },
      { ...selection, surface_id: "foreign" },
    ])
      assert.equal(
        (
          await Effect.runPromise(
            web.client.workspace.prepareDiagrams({ payload: altered }).pipe(Effect.result),
          )
        )._tag,
        "Failure",
      );
    const invalid = await fetch(`${web.origin}/api/diagrams/prepare`, {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: JSON.stringify({ ...selection, path: "/etc/passwd" }),
    });
    assert.equal(invalid.status, 400);
    const foreign = await fetch(`${web.origin}/api/diagrams/prepare`, {
      method: "POST",
      headers: { origin: "https://foreign.invalid", "content-type": "application/json" },
      body: JSON.stringify(selection),
    });
    assert.equal(foreign.status, 403);
    assert.equal(web.backend.submissions, 0);
  },
);
