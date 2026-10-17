import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";

test("busy polls don't reset progress; one stall prompt is retained across restart until handled", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.config.progress_timeout_ms = {
    explore: 1000,
    apply: 2000,
    review: 1000,
    research: 1000,
    operation: 1000,
  };
  f.runtime.sessions.set(Id.SessionId.make("ses_supervisor"), {
    id: Id.SessionId.make("ses_supervisor"),
    directory: f.config.home,
    busy: false,
  });
  const e = await call(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const count = f.runtime.prompts;
  await call(clock.setTime(900));
  await call(f.controller.supervise());
  assert.equal(f.runtime.prompts, count);
  await call(clock.setTime(1100));
  await call(f.controller.supervise());
  const incident = (await run(f.controller.get(e.issue_id))).attention![0];
  assert.equal(incident.status, "admitted");
  assert.equal(f.runtime.prompts, count + 1);
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  const uncertain = await run(c.get(e.issue_id));
  uncertain.attention = uncertain.attention!.map((a) =>
    a.id === incident.id ? { ...a, status: "uncertain" } : a,
  );
  await run(f.records.save(uncertain));
  await call(clock.setTime(9000));
  await call(c.supervise());
  assert.equal(f.runtime.prompts, count + 1);
  assert.equal((await run(c.get(e.issue_id))).attention![0].prompt_id, incident.prompt_id);
  await run(
    c.attentionDisposition(
      e.issue_id,
      incident.id,
      0,
      "handled",
      "Inspected worker; waiting for provider output",
    ),
  );
  await call(c.supervise());
  assert.equal(f.runtime.prompts, count + 1);
  await call(c.workerProgress(e.explore_session_id!, 0, "New work completed"));
  await call(clock.setTime(11001));
  await call(c.supervise());
  assert.equal((await run(c.get(e.issue_id))).attention![1].status, "exhausted");
  assert.equal(f.runtime.prompts, count + 1);
});

test("meaningful native activity advances once; command deadlines and valid waits suppress stalls, expiry surfaces owner", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  f.work.add(Id.IssueId.make("dep"), Id.RepositoryId.make("frontend"));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.config.progress_timeout_ms = {
    explore: 1000,
    apply: 1000,
    review: 1000,
    research: 1000,
    operation: 1000,
  };
  const e = await call(f.controller.start(Id.IssueId.make("abra-1")));
  f.runtime.sessions.get(e.explore_session_id!)!.activity = {
    identity: Id.ActivityId.make("native-message-tool-success"),
    at: 500,
    summary: "Read source",
  };
  await call(clock.setTime(500));
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).progress!.at, 500);
  await call(clock.setTime(900));
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).progress!.at, 500);
  const current = await run(f.controller.get(e.issue_id));
  current.command_wait = {
    operation_id: Id.OperationId.make("check"),
    command: "long check",
    started_at: 500,
    deadline_at: 10000,
  };
  await run(f.records.save(current));
  await call(clock.setTime(2000));
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).attention, undefined);
  delete current.command_wait;
  await run(f.records.save(current));
  await call(
    f.controller.workerWait(e.explore_session_id!, {
      key: Id.ObligationKey.make("dependency"),
      generation: 0,
      kind: "dependency",
      reference: Id.IssueId.make("dep"),
      condition: "Await deployment",
      owner: "deploy owner",
      expires_in_ms: 1000,
    }),
  );
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).attention, undefined);
  await call(clock.setTime(3001));
  await call(f.controller.supervise());
  const a = (await run(f.controller.get(e.issue_id))).attention![0];
  assert.equal(a.code, "wait_expired");
  assert.match(a.evidence, /deploy owner/);
  assert.equal(a.status, "unavailable");
});

test("lost admission reuses retained prompt; unavailable provider doesn't loop and pause suppresses retry", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  f.runtime.sessions.set(Id.SessionId.make("ses_supervisor"), {
    id: Id.SessionId.make("ses_supervisor"),
    directory: f.config.home,
    busy: false,
  });
  const e = await call(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const prompt = f.runtime.prompt.bind(f.runtime);
  const ids: string[] = [];
  f.runtime.prompt = (session, text, id) =>
    Effect.gen(function* () {
      ids.push(id);
      yield* prompt(session, text, id);
      return yield* new CrewError("LOST", "Provider response lost");
    });
  await call(clock.setTime(10));
  await call(f.controller.supervise());
  const a = (await run(f.controller.get(e.issue_id))).attention![0];
  assert.equal(a.status, "unavailable");
  await call(f.controller.supervise());
  assert.equal(ids.length, 1);
  f.runtime.prompt = prompt;
  await run(
    f.controller.attentionDisposition(e.issue_id, a.id, 0, "retry", "Provider connection restored"),
  );
  assert.equal((await run(f.controller.get(e.issue_id))).attention![0].prompt_id, ids[0]);
  await run(f.controller.control(e.issue_id, "pause"));
  await call(clock.setTime(10000));
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).current_phase, "interrupted");
  await assert.rejects(
    run(f.controller.attentionDisposition(e.issue_id, a.id, 0, "retry", "retry")),
    /generation/,
  );
});

test("attention admission reserves a global slot until a retained disposition releases it", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  f.work.add(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"));
  f.runtime.sessions.set(Id.SessionId.make("ses_supervisor"), {
    id: Id.SessionId.make("ses_supervisor"),
    directory: f.config.home,
    busy: false,
  });
  f.config.attention_capacity = 1;
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  await call(f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")));
  await call(f.controller.start(Id.IssueId.make("abra-2"), Id.SessionId.make("ses_supervisor")));
  await call(clock.setTime(10));
  await call(f.controller.supervise());
  const records = await run(f.records.executions());
  const admitted = records.flatMap((e) => e.attention ?? []).filter((a) => a.status === "admitted");
  assert.equal(admitted.length, 1);
  assert.equal(
    records.flatMap((e) => e.attention ?? []).filter((a) => a.status === "pending").length,
    1,
  );
  const owner = records.find((e) => e.attention?.some((a) => a.id === admitted[0].id))!;
  await run(
    f.controller.attentionDisposition(
      owner.issue_id,
      admitted[0].id,
      0,
      "handled",
      "Diagnosis complete",
    ),
  );
  await call(f.controller.supervise());
  assert.equal(
    (await run(f.records.executions()))
      .flatMap((e) => e.attention ?? [])
      .filter((a) => a.status === "admitted").length,
    1,
  );
});

test("diagnostic message provenance cannot authorize lifecycle changes, and pausing supersedes old attention", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  f.runtime.sessions.set(Id.SessionId.make("ses_supervisor"), {
    id: Id.SessionId.make("ses_supervisor"),
    directory: f.config.home,
    busy: false,
  });
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  const e = await call(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  await call(clock.setTime(10));
  await call(f.controller.supervise());
  const a = (await run(f.controller.get(e.issue_id))).attention![0];
  f.runtime.origins.set(Id.MessageId.make("msg_diagnostic-assistant"), a.prompt_id!);
  f.runtime.origins.set(
    Id.MessageId.make("msg_foreground-assistant"),
    Id.MessageId.make("msg_user-request"),
  );
  for (const tool of [
    "work_start",
    "work_control",
    "work_scope",
    "work_finish",
    "project_setup",
    "work_create",
  ])
    await assert.rejects(
      run(
        f.controller.guardAttention(
          Id.SessionId.make("ses_supervisor"),
          Id.MessageId.make("msg_diagnostic-assistant"),
          tool,
        ),
      ),
      /diagnostic turn/,
    );
  await run(
    f.controller.guardAttention(
      Id.SessionId.make("ses_supervisor"),
      Id.MessageId.make("msg_diagnostic-assistant"),
      "work_diagnostics",
    ),
  );
  await run(
    f.controller.guardAttention(
      Id.SessionId.make("ses_supervisor"),
      Id.MessageId.make("msg_diagnostic-assistant"),
      "work_correct",
    ),
  );
  await run(
    f.controller.guardAttention(
      Id.SessionId.make("ses_supervisor"),
      Id.MessageId.make("msg_foreground-assistant"),
      "work_control",
    ),
  );
  await run(f.controller.control(e.issue_id, "pause"));
  assert.equal((await run(f.controller.get(e.issue_id))).attention![0].status, "superseded");
  await assert.rejects(
    run(
      f.controller.guardAttention(
        Id.SessionId.make("ses_supervisor"),
        Id.MessageId.make("msg_diagnostic-assistant"),
        "work_control",
      ),
    ),
    /diagnostic turn/,
  );
});

test("PR feedback batches deduplicate operation churn, restart and handled unchanged revisions", async (t) => {
  const { delivered } = await import("../fixtures.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.diagnostic_turns = 2;
  await run(f.records.saveProject(p));
  f.runtime.sessions.set(Id.SessionId.make("ses_supervisor"), {
    id: Id.SessionId.make("ses_supervisor"),
    directory: f.config.home,
    busy: false,
  });
  let e = await run(delivered(f));
  e.feedback = {
    schema_version: 1,
    head: e.delivered_commit!,
    pr: e.pull_request_reference!,
    target: e.target_branch!,
    observed_at: 1,
    next_check_at: 2,
    attempts: 0,
    complete: true,
    digest: "one",
    findings: [
      {
        id: Id.FindingId.make("comment-1"),
        source_id: "comment-1",
        revision: "rev-1",
        head: e.delivered_commit!,
        kind: "comment",
        text: "Handle empty input",
        blocking: true,
      },
    ],
    history: [],
    actions: [],
  };
  await run(f.records.save(e));
  const prompts = f.runtime.prompts;
  await run(f.controller.supervise());
  e = await run(f.controller.get(e.issue_id));
  const incident = e.attention![0];
  assert.equal(incident.code, "pr_feedback");
  assert.equal(incident.batch!.findings[0].id, "comment-1");
  assert.equal(f.runtime.prompts, prompts + 1);
  await run(
    f.controller.attentionDisposition(
      e.issue_id,
      incident.id,
      e.control_generation,
      "handled",
      "Inspected this revision",
    ),
  );
  await run(f.controller.reconcile(e.issue_id));
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, prompts + 1);
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(c.close()));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, prompts + 1);
  e = await run(c.get(e.issue_id));
  e.feedback = {
    ...e.feedback!,
    findings: e.feedback!.findings.map((x) => ({
      ...x,
      id: Id.FindingId.make("comment-2"),
      revision: "rev-2",
    })),
  };
  await run(f.records.save(e));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, prompts + 2);
});
