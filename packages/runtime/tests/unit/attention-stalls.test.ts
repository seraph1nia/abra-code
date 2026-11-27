import { nativeReviews } from "../../src/web/review-tool.ts";
import { goal as workGoal } from "../helpers/work-goal.ts";
import { createWorkflow } from "../../src/opencode/application.ts";
import * as Id from "@abracode/contracts/identities";
import { toolPresentation } from "../../src/web/tool-presentation.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
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
  const { id: checkpointStallId } = await run(f.work.create(workGoal("checkpoint-stall")));
  const e = await run(f.controller.start(checkpointStallId, supervisor));
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
  assert.equal(after.approval_receipts.length, 1);
  assert.ok(after.approval_receipts[0]?.delivered_at);
});

test("busy polls don't reset progress; one stall prompt is retained across restart until handled", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
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
  const e = await call(f.controller.start(issueId, Id.SessionId.make("ses_supervisor")));
  const count = f.runtime.prompts;
  await call(clock.setTime(900));
  await call(f.controller.supervise());
  assert.equal(f.runtime.prompts, count);
  await call(clock.setTime(1100));
  await call(f.controller.supervise());
  const incident = (await run(f.controller.get(e.issue_id))).attention![0];
  assert.equal(incident.status, "admitted");
  assert.equal(f.runtime.prompts, count + 1);
  const c = (
    await run(
      createWorkflow(
        f.catalog,
        f.config,
        f.records,
        f.work,
        f.spec,
        f.git,
        f.runtime,
        f.delivery,
        f.locks,
      ),
    )
  ).controller;
  let uncertain = await run(c.get(e.issue_id));
  uncertain = {
    ...uncertain,
    attention: uncertain.attention!.map((a) =>
      a.id === incident.id ? { ...a, status: "uncertain" } : a,
    ),
  };
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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  f.seed.named(Id.IssueId.make("dep"), Id.RepositoryId.make("frontend"));
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
  const e = await call(f.controller.start(issueId));
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
  let current = await run(f.controller.get(e.issue_id));
  current = {
    ...current,
    command_wait: {
      operation_id: Id.OperationId.make("check"),
      command: "long check",
      started_at: 500,
      deadline_at: 10000,
    },
  };
  current = await run(f.records.save(current));
  await call(clock.setTime(2000));
  await call(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).attention, undefined);
  current = { ...current, command_wait: undefined };
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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const e = await call(f.controller.start(issueId, Id.SessionId.make("ses_supervisor")));
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
  const withLock = f.locks.with.bind(f.locks);
  const attentionLocks: string[] = [];
  f.locks.with = (key, action, options) => {
    if (key.startsWith("attention-")) attentionLocks.push(key);
    return withLock(key, action, options);
  };
  await run(
    f.controller.attentionDisposition(e.issue_id, a.id, 0, "retry", "Provider connection restored"),
  );
  assert.equal(attentionLocks.length, 1);
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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const { id: abra2Id } = await run(
    f.work.create({ ...workGoal("abra-2"), repository_id: Id.RepositoryId.make("frontend") }),
  );
  f.config.attention_capacity = 1;
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  await call(f.controller.start(issueId, Id.SessionId.make("ses_supervisor")));
  await call(f.controller.start(abra2Id, Id.SessionId.make("ses_supervisor")));
  await call(clock.setTime(10));
  await call(f.controller.supervise());
  const records = await run(f.records.executions);
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
    (await run(f.records.executions))
      .flatMap((e) => e.attention ?? [])
      .filter((a) => a.status === "admitted").length,
    1,
  );
});

test("diagnostic message provenance cannot authorize lifecycle changes, and pausing supersedes old attention", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  const e = await call(f.controller.start(issueId, Id.SessionId.make("ses_supervisor")));
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
      nativeReviews(f.controller, f.records.store, f.locks),
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
    "thought_get",
    "thought_search",
    "thought_save",
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
  for (const name of ["thought_get", "thought_save", "thought_search", "work_briefing"]) {
    const tool = tools.get(name)!;
    const invokeAs = (sessionID: Id.SessionId) =>
      run(
        tool.execute(
          {},
          {
            sessionID,
            agent: Agent.ID.make("abra"),
            messageID: Id.MessageId.make("msg_foreground-assistant"),
            id: Tool.CallID.make("call_notebook"),
            progress: () => Effect.void,
          },
        ),
      );
    await assert.rejects(invokeAs(e.explore_session_id!), /WORKER_FORBIDDEN/);
    if (name === "work_briefing") {
      const result = await invokeAs(Id.SessionId.make("ses_supervisor"));
      assert.equal(JSON.parse(result.content as string).result.github.total, 0);
    } else
      await assert.rejects(invokeAs(Id.SessionId.make("ses_supervisor")), /MEMOS_UNCONFIGURED/);
  }
  const centralTools = new Map(tools);
  tools.clear();
  await run(
    registerTools(
      ctx,
      f.controller,
      f.onboarding,
      false,
      f.setup,
      nativeReviews(f.controller, f.records.store, f.locks),
    ),
  );
  for (const name of ["thought_get", "thought_save", "thought_search", "work_briefing"])
    assert.equal(tools.has(name), false);
  for (const [name, tool] of centralTools) tools.set(name, tool);
  const draft = { surface_id: "draft", source: 'root = Text("Draft")', validate_only: true };
  const draftResult = await invoke("render_ui", draft);
  assert.equal(
    toolPresentation(
      "abra_render_ui",
      draft,
      [{ type: "text", text: draftResult.content as string }],
      undefined,
    ),
    undefined,
  );
  assert.deepEqual(JSON.parse(draftResult.content as string).result, {
    surface_id: "draft",
    validated: true,
  });
  await assert.rejects(
    run(
      tools.get("render_ui")!.execute(draft, {
        sessionID: e.explore_session_id!,
        agent: Agent.ID.make("abra"),
        messageID: Id.MessageId.make("msg_worker-draft"),
        id: Tool.CallID.make("call_worker-draft"),
        progress: () => Effect.void,
      }),
    ),
    /WORKER_FORBIDDEN/,
  );
  await assert.rejects(
    invoke("render_ui", { ...draft, source: `root = WorkTable(${"x".repeat(4096)}=true)` }),
    (error: Error) => error.message.includes("UI_EXPRESS") && error.message.length < 1600,
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

test("an exhausted diagnostic is recorded even while an unrelated incident holds attention capacity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const root = Id.SessionId.make("ses_supervisor");
  f.config.attention_capacity = 1;
  f.config.progress_timeout_ms = { explore: 1, apply: 1, review: 1, research: 1, operation: 1 };
  const project = (await run(f.records.project(Id.RepositoryId.make("frontend"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  f.seed.named(Id.IssueId.make("admitted"));
  f.seed.named(Id.IssueId.make("exhausted"), Id.RepositoryId.make("frontend"));
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
    (await run(f.records.executions))
      .flatMap((e) => e.attention ?? [])
      .filter((a) => a.status === "admitted").length,
    1,
  );
});
