/* oxlint-disable effecttsgo/unstable-api-usage -- Exercises the pinned Effect 4 HTTP API transport. */
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { Effect, Exit, Scope } from "effect";
import { HttpApiClient } from "effect/http-api";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { workspaceApi } from "../../src/web/http-api.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { RequestId } from "../../src/identities.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

async function fixture() {
  const backend = new WorkspaceFixture();
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend }).pipe(Effect.provideService(Scope.Scope, scope)),
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
  assert.equal(snapshot.session_id, web.backend.sessionID);
  assert.equal(snapshot.work.work[0].title, "Build a single workspace");
  assert.deepEqual(await Effect.runPromise(web.client.workspace.stop({ payload: {} })), {
    stopped: true,
  });
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
      await fetch(`${web.origin}/api/abra/stop`, {
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

test("CopilotKit v2 Fetch handler transports AG-UI and binds one native session", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
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
    state: {},
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

test("retained report HTML stays behind typed reads, an opaque sandbox and attachment downloads", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const query = {
    issue_id: web.backend.value.work.work[0].issue_id,
    request_id: RequestId.make("published-report"),
  };
  const html = await Effect.runPromise(web.client.work.preview({ query }));
  assert.match(html, /Isolated report/);
  const url = new URLSearchParams(query);
  const preview = await fetch(`${web.origin}/api/report/preview?${url}`);
  const csp = preview.headers.get("content-security-policy")!;
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  const download = await fetch(`${web.origin}/api/report/download?${url}`);
  assert.match(
    download.headers.get("content-disposition")!,
    /^attachment; filename="abra-report-published-report.html"$/,
  );
  assert.equal(
    (await fetch(`${web.origin}/api/report/preview?${url}&path=/etc/passwd`)).status,
    400,
  );
});
