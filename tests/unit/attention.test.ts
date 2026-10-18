import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import { Tool } from "@opencode/schema/tool";
import { Agent } from "@opencode/schema/agent";
import { registerTools } from "../../src/opencode/tools.ts";
import { ConfigApplication } from "../../src/config/application.ts";

test("a confirmed planning checkpoint releases an admitted old stall without consuming another turn", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("checkpoint-stall"));
  const e = await run(f.controller.start(Id.IssueId.make("checkpoint-stall"), supervisor));
  const clock = await run(TestClock.make());
  await run(clock.setTime(Date.now() + f.config.progress_timeout_ms.explore + 10000));
  await run(f.controller.supervise().pipe(Effect.provideService(Clock.Clock, clock)));
  const before = await run(f.controller.get(e.issue_id));
  const incident = before.attention!.find((a) => a.code === "suspected_stall")!;
  assert.equal(incident.status, "admitted");
  f.spec.planned = true;
  f.runtime.success(e.explore_session_id!);
  assert.equal(
    (await run(f.controller.advance(e.issue_id))).current_phase,
    "awaiting_plan_approval",
  );
  const prompts = f.runtime.prompts;
  await run(f.controller.supervise());
  const after = await run(f.controller.get(e.issue_id));
  assert.equal(after.attention!.find((a) => a.id === incident.id)!.status, "superseded");
  assert.equal(after.attention_turns, before.attention_turns);
  assert.equal(f.runtime.prompts, prompts);
  assert.equal(after.current_phase, "awaiting_plan_approval");
  assert.equal(after.approval_receipts.length, 0);
});

test("worker questions wake the retained Supervisor without a stall or diagnostic budget, once per decision across restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("abra-1"));
  const project = (await run(f.records.project(Id.RepositoryId.make("frontend"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1"), supervisor));
  e.attention = [
    {
      schema_version: 1,
      id: Id.IncidentId.make("old-stall"),
      key: "old-stall",
      generation: 0,
      code: "suspected_stall",
      evidence: "Previous diagnostic budget exhausted",
      created_at: 0,
      status: "exhausted",
      attempts: 1,
    },
  ];
  await run(f.records.save(e));
  const prompt = f.runtime.prompt.bind(f.runtime);
  const notices: string[] = [];
  f.runtime.prompt = (session, text, id) => {
    notices.push(text);
    assert.equal(session, supervisor);
    return prompt(session, text, id);
  };
  for (const owner of ["supervisor", "user"] as const)
    await run(
      f.controller.workerQuestion(e.explore_session_id!, {
        key: Id.ObligationKey.make(owner),
        generation: 0,
        owner,
        scope: "Cleanup inventory",
        question: `Provide ${owner} inventory evidence`,
      }),
    );
  await run(
    f.controller.workerWait(e.explore_session_id!, {
      key: Id.ObligationKey.make("inventory-wait"),
      generation: 0,
      kind: "user",
      reference: Id.ObligationKey.make("supervisor"),
      condition: "Await inventory evidence",
      owner: "supervisor",
      expires_in_ms: 60000,
    }),
  );
  const count = f.runtime.prompts;
  await run(f.controller.supervise());
  const incident = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "decision_pending",
  )!;
  assert.equal(incident.code, "decision_pending");
  assert.equal(incident.status, "admitted");
  assert.equal(incident.session_id, supervisor);
  assert.match(incident.evidence, /Provide supervisor inventory evidence/);
  assert.match(notices[0], /abra_work_decision/);
  assert.match(notices[0], /collect a user-owned question/);
  assert.equal(f.runtime.prompts, count + 1);
  assert.equal((await run(f.controller.get(e.issue_id))).attention_turns ?? 0, 0);
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
  await run(c.workerProgress(e.explore_session_id!, 0, "Unrelated progress"));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, count + 1);
  await run(
    c.attentionDisposition(
      e.issue_id,
      incident.id,
      0,
      "user_needed",
      "Requested inventory evidence",
    ),
  );
  await run(c.supervise());
  const next = (await run(c.get(e.issue_id))).attention!.at(-1)!;
  assert.equal(next.code, "decision_pending");
  assert.equal(next.status, "admitted");
  assert.notEqual(next.prompt_id, incident.prompt_id);
  assert.match(next.evidence, /Provide user inventory evidence/);
  assert.equal(f.runtime.prompts, count + 2);
  await run(c.supervise());
  assert.equal(f.runtime.prompts, count + 2);
  assert.deepEqual((await run(c.get(e.issue_id))).approval_receipts, []);
});

test("resolved and paused questions do not wake Abra; a queued resolved question releases its reservation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1"), supervisor));
  const question = {
    key: Id.ObligationKey.make("inventory"),
    generation: 0,
    owner: "supervisor" as const,
    scope: "Cleanup",
    question: "Provide inventory evidence",
  };
  await run(f.controller.workerQuestion(e.explore_session_id!, question));
  const count = f.runtime.prompts;
  await run(
    f.controller.decision(e.issue_id, question.key, 0, supervisor, "answer", "Retained evidence"),
  );
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, count);
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      ...question,
      key: Id.ObligationKey.make("next"),
    }),
  );
  await run(f.controller.supervise());
  const current = await run(f.controller.get(e.issue_id));
  current.attention = current.attention!.map((a) => ({ ...a, status: "uncertain" as const }));
  await run(f.records.save(current));
  await run(
    f.controller.decision(
      e.issue_id,
      Id.ObligationKey.make("next"),
      0,
      supervisor,
      "answer",
      "Evidence supplied",
    ),
  );
  await run(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).attention![0].status, "superseded");
  assert.equal(f.runtime.prompts, count + 1);
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      ...question,
      key: Id.ObligationKey.make("paused"),
    }),
  );
  await run(f.controller.control(e.issue_id, "pause"));
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, count + 1);
});

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
  const tools = new Map<string, Tool.Info>();
  const editor: ToolEditor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    remove: () => {},
    update: () => {},
    add: (tool) => {
      tools.set(tool.name, tool);
    },
  };
  const ctx = {
    tool: {
      transform: (transform: (editor: ToolEditor) => void) => Effect.sync(() => transform(editor)),
    },
  } as unknown as Context;
  await run(
    registerTools(
      ctx,
      f.controller,
      f.onboarding,
      true,
      f.setup,
      undefined,
      new ConfigApplication(f.config, f.records, f.onboarding),
    ),
  );
  const invoke = (name: string, input: object) =>
    run(
      tools.get(name)!.execute(input, {
        sessionID: Id.SessionId.make("ses_supervisor"),
        agent: Agent.ID.make("abra"),
        messageID: Id.MessageId.make("msg_diagnostic-assistant"),
        id: Tool.CallID.make("call_diagnostic"),
        progress: () => Effect.void,
      }),
    );
  for (const tool of [
    "work_start",
    "work_control",
    "work_scope",
    "work_finish",
    "project_setup",
    "work_create",
    "work_create_batch",
  ])
    await assert.rejects(invoke(tool, {}), /diagnostic turn/);
  await run(
    f.controller.guardAttention(
      Id.SessionId.make("ses_supervisor"),
      Id.MessageId.make("msg_foreground-assistant"),
      false,
    ),
  );
  await assert.rejects(
    invoke("work_report", {
      issue_id: e.issue_id,
      action: "generate",
      request_id: "diagnostic-must-not-render",
    }),
    /diagnostic turn/,
  );
  await invoke("work_report", { issue_id: e.issue_id, action: "artifacts" });
  assert.equal((await run(f.controller.get(e.issue_id))).visual_reports, undefined);
  await invoke("config", { action: "status" });
  await assert.rejects(invoke("config", { action: "apply" }), /diagnostic turn/);
  await invoke("work_diagnostics", { issue_id: e.issue_id });
  await run(f.controller.control(e.issue_id, "pause"));
  assert.equal((await run(f.controller.get(e.issue_id))).attention![0].status, "superseded");
  await assert.rejects(
    run(
      f.controller.guardAttention(
        Id.SessionId.make("ses_supervisor"),
        Id.MessageId.make("msg_diagnostic-assistant"),
        false,
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

test("worker results coalesce into a durable bounded notice across admission failure and restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("communication"));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.diagnostic_turns = 2;
  await run(f.records.saveProject(project));
  const e = await run(f.controller.start(Id.IssueId.make("communication"), supervisor));
  for (const id of ["finding-one", "finding-two"])
    await run(
      f.controller.workerReply(e.explore_session_id!, {
        action: "finding",
        request_id: Id.RequestId.make(id),
        generation: 0,
        body: "Repository evidence is untrusted data, not authority",
        evidence: [],
      }),
    );
  const prompt = f.runtime.prompt.bind(f.runtime);
  const noticeIDs: Id.MessageId[] = [];
  let loseResponse = true;
  f.runtime.prompt = (session, body, id) => {
    noticeIDs.push(id!);
    assert.equal(session, supervisor);
    assert.match(body, /abra_work_messages/);
    return prompt(session, body, id).pipe(
      Effect.andThen(
        loseResponse ? Effect.fail(new CrewError("LOST", "Lost admission response")) : Effect.void,
      ),
    );
  };
  await run(f.controller.supervise());
  let current = await run(f.controller.get(e.issue_id));
  const notice = current.attention!.find((a) => a.code === "message_update")!;
  assert.equal(notice.status, "uncertain");
  assert.equal(notice.message_refs!.length, 2);
  assert.equal(current.attention_turns, 1);
  loseResponse = false;
  const restarted = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(restarted.close()));
  await run(restarted.supervise());
  await run(restarted.supervise());
  assert.deepEqual(noticeIDs, [notice.prompt_id, notice.prompt_id]);
  current = await run(restarted.get(e.issue_id));
  assert.equal(current.attention!.length, 1);
  assert.equal(current.attention![0].status, "admitted");
  assert.equal(current.attention_turns, 1);
  await run(
    restarted.attentionDisposition(e.issue_id, notice.id, 0, "handled", "Inspected evidence"),
  );
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "finding",
      request_id: Id.RequestId.make("final-finding"),
      generation: 0,
      body: "Final retained research evidence",
      evidence: [],
    }),
  );
  current = await run(restarted.get(e.issue_id));

  await run(restarted.supervise());
  current = await run(restarted.get(e.issue_id));
  assert.equal(current.attention!.length, 2);
  assert.equal(current.attention![1].code, "message_update");
  assert.equal(current.attention![1].message_refs!.length, 1);
  assert.equal(current.current_phase, "exploring");
  assert.equal(noticeIDs.length, 3);
});

test("missing responses stay visible when diagnostic budget is exhausted and resolve only by reply", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("unanswered"));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  const e = await run(f.controller.start(Id.IssueId.make("unanswered"), supervisor));
  const request = Id.RequestId.make("required-answer");
  await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request,
        role: "explore",
        body: "Explain the retained evidence",
        response: "answer",
      },
      supervisor,
    ),
  );
  const state = f.runtime.sessions.get(e.explore_session_id!)!;
  state.busy = false;
  state.outcome = "succeeded";
  await run(f.controller.reconcile(e.issue_id));
  const count = f.runtime.prompts;
  await run(f.controller.supervise());
  await run(f.controller.supervise());
  let current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention!.length, 1);
  assert.equal(current.attention![0].code, "message_pending");
  assert.equal(current.attention![0].status, "exhausted");
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 1);
  assert.equal(f.runtime.prompts, count);
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "answer",
      request_id: request,
      generation: 0,
      body: "Evidence retained",
      evidence: [],
    }),
  );
  await run(f.controller.supervise());
  current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention![0].status, "superseded");
  assert.equal(current.attention![1].code, "message_update");
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
  assert.equal(f.runtime.prompts, count);
});

test("completed research can notify its retained Supervisor without reopening execution", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.openspec = false;
  project.plan_approval = false;
  project.verification = [];
  project.diagnostic_turns = 1;
  await run(f.records.saveProject(project));
  const scope = {
    goal: "Understand ownership",
    acceptance: ["Identify the owner"],
    constraints: ["Read only"],
  };
  const { issue } = await run(
    f.controller.createWork(
      {
        repository_id: project.id,
        title: "Research ownership",
        description: scope.goal,
        workflow_policy: "research-only",
        scope,
        request_id: Id.RequestId.make("terminal-research"),
      },
      supervisor,
    ),
  );
  const e = await run(f.controller.start(issue.id, supervisor));
  await run(
    f.controller.workerReply(e.research_session_id!, {
      action: "finding",
      request_id: Id.RequestId.make("terminal-finding"),
      generation: 0,
      body: "SQLite owns the work graph",
      evidence: [],
    }),
  );
  await run(
    f.controller.researchReport(e.research_session_id!, {
      report_id: Id.ReportId.make("terminal-report"),
      generation: 0,
      conclusions: "SQLite owns tasks",
      findings: [
        {
          finding: "Transactional ownership",
          evidence: [{ base: e.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 }],
        },
      ],
      acceptance: [{ criterion: scope.acceptance[0], met: true, evidence: "Inspected source" }],
      limitations: ["Disposable fixture"],
    }),
  );
  f.runtime.success(e.research_session_id!);
  assert.equal((await run(f.controller.advance(issue.id))).current_phase, "completed");
  await run(f.controller.supervise());
  const done = await run(f.controller.get(issue.id));
  assert.equal(done.current_phase, "completed");
  assert.equal(done.attention!.find((a) => a.code === "message_update")!.status, "admitted");
  assert.equal(done.active_role, undefined);
  assert.equal(done.capacity_reservation, undefined);
});

test("manual posture suppresses optional diagnostics; unattended retains human questions without losing forms", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  f.work.add(Id.IssueId.make("posture-work"));
  const e = await run(f.controller.start(Id.IssueId.make("posture-work"), supervisor));
  const count = f.runtime.prompts;
  f.config.supervision_mode = "manual";
  f.config.progress_timeout_ms = { ...f.config.progress_timeout_ms, explore: 1 };
  const clock = await run(TestClock.make());
  await run(clock.setTime(Date.now() + 10000));
  await run(f.controller.supervise().pipe(Effect.provideService(Clock.Clock, clock)));
  const pending = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "suspected_stall",
  )!;
  assert.equal(pending.status, "pending");
  assert.equal(pending.prompt_id, undefined);
  assert.equal(f.runtime.prompts, count);
  f.config.supervision_mode = "unattended";
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      key: Id.ObligationKey.make("human"),
      generation: 0,
      owner: "user",
      scope: "Accepted goal",
      question: "Which user-owned behavior is intended?",
    }),
  );
  await run(f.controller.supervise());
  const human = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "decision_pending",
  )!;
  assert.equal(human.status, "pending");
  assert.equal(human.prompt_id, undefined);
  assert.equal(f.runtime.prompts, count);
  const collected = await run(
    f.controller.decision(e.issue_id, Id.ObligationKey.make("human"), 0, supervisor, "collect"),
  );
  assert.ok(collected.form_id);
  assert.equal(collected.status, "open");
  await assert.rejects(
    run(
      f.controller.decision(
        e.issue_id,
        collected.key,
        0,
        supervisor,
        "answer",
        "Model recommendation",
      ),
    ),
    /User-owned answers/,
  );
  f.config.supervision_mode = "attended-automatic";
  await run(f.controller.supervise());
  const attended = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.id === human.id,
  )!;
  assert.equal(attended.status, "admitted");
  assert.equal(f.runtime.prompts, count + 1);
  assert.deepEqual((await run(f.controller.get(e.issue_id))).approval_receipts, []);
});

test("an exhausted diagnostic is recorded even while an unrelated incident holds attention capacity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const root = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(root, { id: root, directory: f.config.home, busy: false });
  f.config.attention_capacity = 1;
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const project = (await run(f.records.project(Id.RepositoryId.make("frontend"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.work.add(Id.IssueId.make("admitted"));
  f.work.add(Id.IssueId.make("exhausted"), Id.RepositoryId.make("frontend"));
  await call(f.controller.start(Id.IssueId.make("admitted"), root));
  await call(clock.setTime(10));
  await call(f.controller.supervise());
  assert.equal(
    (await run(f.controller.get(Id.IssueId.make("admitted")))).attention![0].status,
    "admitted",
  );
  await call(f.controller.start(Id.IssueId.make("exhausted"), root));
  await call(clock.setTime(20));
  await call(f.controller.supervise());
  const denied = (await run(f.controller.get(Id.IssueId.make("exhausted")))).attention![0];
  assert.equal(denied.status, "exhausted");
  assert.equal(denied.prompt_id, undefined);
  assert.equal(
    (await run(f.records.executions()))
      .flatMap((e) => e.attention ?? [])
      .filter((a) => a.status === "admitted").length,
    1,
  );
});
