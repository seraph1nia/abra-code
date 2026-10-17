import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture, planned } from "../fixtures.ts";
import { diagnosticText, summarizeContext } from "../../src/opencode/diagnostics.ts";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
test("workers snapshot configured defaults and role overrides independently of Abra UI choices", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.runtime.selectedModel = {
    providerID: Id.ProviderId.make("openai"),
    id: Id.ModelId.make("supervisor-model"),
    variant: Id.ModelVariant.make("medium"),
  };
  const applyModel = {
    providerID: Id.ProviderId.make("explicit"),
    id: Id.ModelId.make("apply-model"),
  };
  f.config.workers.apply = { model: applyModel };
  const e = await run(planned(f));
  const captured = e.configuration_snapshot!;
  assert.deepEqual(
    f.runtime.sessions.get(e.explore_session_id!)!.model,
    captured.workers.explore?.model,
  );
  assert.notDeepEqual(captured.workers.explore?.model, f.runtime.selectedModel);
  f.runtime.selectedModel = {
    providerID: Id.ProviderId.make("other"),
    id: Id.ModelId.make("new-default"),
  };
  f.config.workers.apply = {
    model: { providerID: Id.ProviderId.make("explicit"), id: Id.ModelId.make("apply-model") },
  };
  const pending = (await run(
    f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  )) as {
    form_id: string;
  };
  f.runtime.forms.set(Id.FormId.make(pending.form_id), "approved");
  const applied = (await run(
    f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  )) as typeof e;
  assert.deepEqual(applied.configuration_snapshot, captured);
  assert.deepEqual(f.runtime.sessions.get(applied.apply_session_id!)!.model, applyModel);
});
test("failed workers keep configured snapshots on retry and reuse their session and worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  delete e.worker_model;
  await run(f.records.save(e));
  const session = f.runtime.sessions.get(e.explore_session_id!)!;
  session.busy = false;
  session.outcome = "failed";
  session.model = {
    providerID: Id.ProviderId.make("opencode"),
    id: Id.ModelId.make("cat-jam-free"),
  };
  session.error = {
    type: "provider.auth",
    status: 403,
    message: "Free-tier authentication denied",
  };
  await run(f.controller.reconcile(Id.IssueId.make("abra-1")));
  const failed = (await run(f.records.execution(Id.IssueId.make("abra-1"))))!;
  assert.match(failed.error_or_recovery_reason!, /provider.auth \(403\).*authentication denied/);
  assert.equal(failed.worker_failure?.session_id, session.id);
  f.runtime.selectedModel = {
    providerID: Id.ProviderId.make("openai"),
    id: Id.ModelId.make("supervisor-model"),
  };
  const retried = await run(f.controller.control(Id.IssueId.make("abra-1"), "retry"));
  assert.equal(retried.explore_session_id, e.explore_session_id);
  assert.equal(retried.worktree_directory, e.worktree_directory);
  assert.deepEqual(session.model, e.configuration_snapshot?.workers.explore?.model);
  assert.equal(f.runtime.creates, 1);
});
test("Supervisor diagnostics expose assigned native errors and remain useful when a session is unavailable", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const session = f.runtime.sessions.get(e.explore_session_id!)!;
  session.busy = false;
  session.outcome = "failed";
  session.error = { type: "provider.auth", status: 403, message: "Provider rejected the worker" };
  await run(f.controller.reconcile(Id.IssueId.make("abra-1")));
  const diagnostic = await run(f.controller.diagnostics(Id.IssueId.make("abra-1")));
  assert.equal(diagnostic.sessions.length, 1);
  assert.equal(diagnostic.sessions[0].id, e.explore_session_id);
  assert.equal(diagnostic.last_worker_failure?.error.status, 403);
  await assert.rejects(
    run(f.controller.diagnostics(Id.IssueId.make("unassigned"))),
    /No execution/,
  );
  f.runtime.sessions.delete(e.explore_session_id!);
  const unavailable = await run(f.controller.diagnostics(Id.IssueId.make("abra-1")));
  assert.match(unavailable.sessions[0].diagnostic_error!, /Missing session/);
  assert.equal(unavailable.last_worker_failure?.error.message, "Provider rejected the worker");
});
test("native Supervisor model selection uses its actual assistant model rather than the global default", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const ref = { providerID: "openai", id: "supervisor-model", variant: "high" };
  const ctx = {
    session: {
      context: () =>
        domainEffect(
          Effect.sync(() => {
            return [{ type: "assistant", model: ref }];
          }),
        ),
    },
  } as unknown as Context;
  const runtime = new NativeRuntime(ctx, f.config);
  assert.deepEqual(await run(runtime.supervisorModel(Id.SessionId.make("ses-supervisor"))), ref);
});
test("native failure events retain their cause when the transcript has no error", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const session = f.runtime.sessions.get(e.explore_session_id!)!;
  session.busy = false;
  session.outcome = "failed";
  await run(
    f.controller.recordWorkerFailure(session.id, {
      type: "provider.auth",
      status: 403,
      message: "Provider rejected the request before a transcript was recorded",
    }),
  );
  await run(f.controller.reconcile(Id.IssueId.make("abra-1")));
  const diagnostic = await run(f.controller.diagnostics(Id.IssueId.make("abra-1")));
  assert.match(diagnostic.last_error!, /provider.auth \(403\).*before a transcript/);
  assert.equal(diagnostic.last_worker_failure?.error.status, 403);
  assert.equal(diagnostic.last_worker_failure?.role, "explore");
});
test("diagnostic summaries redact credentials, omit response bodies and tool inputs, and bound transcript output", () => {
  const marker = "diagnostics-fixture-secret";
  const error = {
    type: "provider.auth",
    status: 403,
    message: `Rejected Authorization: Bearer ${marker}`,
    response: { body: marker },
  };
  const messages = Array.from({ length: 30 }, (_, i) => ({
    id: `msg_${i}`,
    type: "assistant",
    time: { created: i },
    model: { providerID: "fixture", id: "fixture" },
    content: [
      { type: "text", text: "x".repeat(3000) },
      { type: "tool", name: "write", state: { status: "error", input: { apiKey: marker }, error } },
    ],
    error,
  }));
  const summary = summarizeContext(messages as Parameters<typeof summarizeContext>[0]);
  assert.equal(summary.error?.status, 403);
  assert.equal(summary.recent_messages.length, 12);
  assert.equal(summary.recent_messages[0].text!.length, 1200);
  assert.ok(!JSON.stringify(summary).includes(marker));
  assert.ok(!JSON.stringify(summary).includes("response"));
  assert.ok(!JSON.stringify(summary).includes("input"));
  assert.equal(
    diagnosticText('api_key=another-key password="another-password"'),
    'api_key=[redacted] password="[redacted]"',
  );
  const success = summarizeContext([
    ...messages,
    { id: "msg_idle", type: "idle", time: { created: 31 }, outcome: "succeeded" },
  ] as Parameters<typeof summarizeContext>[0]);
  assert.equal(
    success.error,
    undefined,
    "Old errors must not be reported as a new failure after success",
  );
});
