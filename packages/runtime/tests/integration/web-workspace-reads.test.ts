import { SessionId, Timestamp, RepositoryId } from "@abracode/contracts/identities";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { IssueId } from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { nativeRpcError, readWorkReport } from "../../src/web/native-errors.ts";
import { fixture } from "../helpers/workspace-http.ts";
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
