import assert from "node:assert/strict";
import { test, type TestContext } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { type Context } from "@opencode/plugin/effect/plugin";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { decode } from "../../src/decode.ts";
import { NativeRuntime, type Runtime } from "../../src/opencode/runtime.ts";
import { responseState } from "../../src/workflow/messages.ts";
import { messageRequests } from "../../src/workflow/message-contracts.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";
import { requireOwnedPrompt, installGuards } from "../../src/opencode/guards.ts";

async function recoverable(
  t: TestContext,
  diagnostics = 1,
  response: "answer" | "acknowledgement" = "answer",
) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("recoverable"),
    supervisor = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await run(f.records.saveProject({ ...project, diagnostic_turns: diagnostics }));
  f.config.supervision_mode = "attended-automatic";
  f.work.add(issue);
  const e = await run(f.controller.start(issue, supervisor));
  const request = await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("recoverable-question"),
        role: "explore",
        response,
        body: "Which documented check applies?",
      },
      supervisor,
    ),
  );
  const session = f.runtime.session.bind(f.runtime);
  const completions = new Map<Id.MessageId, { id: Id.MessageId; at: number }>();
  f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
    session(id).pipe(
      Effect.map((state) => {
        if (bound && state.outcome && f.runtime.admissions.has(bound)) {
          if (!completions.has(bound))
            completions.set(bound, { id: Id.MessageId.make(`msg_idle_${bound}`), at: Date.now() });
          return {
            ...state,
            assignment: { id: bound, outcome: state.outcome, completion: completions.get(bound) },
          };
        }
        return state;
      }),
    );
  const idle = () =>
    Object.assign(f.runtime.sessions.get(e.explore_session_id!)!, {
      executing: false,
      busy: false,
      outcome: "succeeded",
    });
  idle();
  const read = async () => messageRequests((await run(f.controller.get(issue))).messages)[0]!;
  const reply = () =>
    f.controller.workerReply(e.explore_session_id!, {
      action: "answer",
      request_id: request.request_id,
      generation: request.generation,
      body: "Run the documented consumer check",
    });
  return { f, e, request, idle, read, reply };
}

test("a successful missing-answer turn admits one guarded response-only reminder and escalates once", async (t) => {
  const { f, e, request, idle, read, reply } = await recoverable(t);
  const prompts = f.runtime.prompts;
  await run(f.controller.reconcile(e.issue_id));
  const recovered = await read();
  const reminder = recovered.response_recovery!;
  assert.equal(reminder.status, "admitted");
  assert.match(reminder.prompt, new RegExp(request.request_id));
  assert.match(reminder.prompt, /Do not repeat the substantive task/);
  assert.notEqual(reminder.prompt_id, request.prompt_id);
  assert.equal(f.runtime.prompts, prompts + 1);
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention_turns, 1);
  assert.ok(current.capacity_reservation);
  assert.equal(
    requireOwnedPrompt(current, e.explore_session_id!, reminder.prompt_id)?.prompt,
    reminder.prompt,
  );
  await run(f.controller.reconcile(e.issue_id));
  assert.equal(f.runtime.prompts, prompts + 1);
  idle();
  for (let tick = 0; tick < 3; tick++) {
    await run(f.controller.reconcile(e.issue_id));
    await run(f.controller.supervise());
  }
  const escalated = await run(f.controller.get(e.issue_id));
  assert.equal(escalated.attention?.filter((a) => a.code === "message_pending").length, 1);
  assert.match(escalated.attention![0]!.evidence, /automatic attempt exhausted/);
  assert.equal(escalated.current_phase, "exploring");
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 1);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal((await read()).response_recovery?.prompt_id, reminder.prompt_id);
  await run(reply());
  await run(f.controller.supervise());
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
  assert.equal(
    (await run(f.controller.get(e.issue_id))).attention!.find((a) => a.code === "message_pending")!
      .status,
    "superseded",
  );
});

test("an early reply suppresses a reserved reminder and a reply during admission survives its receipt", async (t) => {
  for (const when of ["preflight", "admission"] as const) {
    const { f, e, read, reply } = await recoverable(t);
    const prompts = f.runtime.prompts;
    if (when === "preflight") f.runtime.preflight = () => reply().pipe(Effect.asVoid);
    else {
      const prompt = f.runtime.prompt.bind(f.runtime);
      f.runtime.prompt = (...args) => prompt(...args).pipe(Effect.andThen(reply()), Effect.asVoid);
    }
    await run(f.controller.reconcile(e.issue_id));
    const m = await read();
    assert.equal(m.status, "answered");
    assert.equal(m.reply?.body, "Run the documented consumer check");
    assert.equal(m.response_recovery?.status, when === "preflight" ? "suppressed" : "admitted");
    assert.equal(f.runtime.prompts, prompts + (when === "admission" ? 1 : 0));
    assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
  }
});

for (const admitted of [false, true]) {
  test(`lost recovery admission response (native admitted ${admitted}) cannot mint another identity across restart`, async (t) => {
    const { f, e, read } = await recoverable(t);
    const prompt = f.runtime.prompt.bind(f.runtime);
    f.runtime.prompt = (...args) =>
      (admitted ? prompt(...args) : Effect.void).pipe(
        Effect.andThen(Effect.fail(new CrewError("RESPONSE_LOST", "Lost reminder receipt"))),
      );
    await run(f.controller.reconcile(e.issue_id));
    const before = (await read()).response_recovery!;
    assert.equal(before.status, "admission_uncertain");
    const prompts = f.runtime.prompts;
    f.runtime.prompt = prompt;
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
    await run(restarted.reconcile(e.issue_id));
    await run(restarted.reconcile(e.issue_id));
    const after = (await read()).response_recovery!;
    assert.equal(after.prompt_id, before.prompt_id);
    assert.equal(after.status, admitted ? "admitted" : "admission_uncertain");
    assert.equal(f.runtime.prompts, prompts);
    assert.equal((await run(restarted.get(e.issue_id))).attention_turns, 1);
    assert.equal((await run(restarted.queries.messages(e.issue_id))).outstanding, 1);
  });
}

test("manual posture and zero diagnostics preserve one actionable obligation without a worker reminder", async (t) => {
  for (const policy of ["manual", "zero"] as const) {
    const { f, e, read } = await recoverable(t, policy === "zero" ? 0 : 1);
    if (policy === "manual") f.config.supervision_mode = "manual";
    const prompts = f.runtime.prompts;
    for (let tick = 0; tick < 3; tick++) {
      await run(f.controller.reconcile(e.issue_id));
      await run(f.controller.supervise());
    }
    assert.equal((await read()).response_recovery, undefined);
    assert.equal(f.runtime.prompts, prompts);
    assert.equal((await run(f.controller.get(e.issue_id))).attention?.length, 1);
    assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 1);
  }
});

test("queued requests, busy workers and unproven outcomes cannot admit reminders", async (t) => {
  for (const native of ["queued", "busy", "unavailable"] as const) {
    const { f, e, request, read } = await recoverable(t);
    if (native === "queued") f.runtime.promptAdmission = () => Effect.succeed("queued" as const);
    if (native === "busy")
      Object.assign(f.runtime.sessions.get(e.explore_session_id!)!, {
        executing: true,
        busy: true,
      });
    if (native === "unavailable") {
      const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
      f.runtime.session = (id) =>
        session(id).pipe(Effect.map((state) => ({ ...state, assignment: undefined })));
    }
    const prompts = f.runtime.prompts;
    await run(f.controller.reconcile(e.issue_id));
    assert.equal((await read()).response_recovery, undefined);
    assert.equal((await read()).prompt_id, request.prompt_id);
    assert.equal(f.runtime.prompts, prompts);
  }
});

test("reminder prompt hooks reject foreign identity, payload, delivery and attachments; pause withdraws the reminder", async (t) => {
  const { f, e, read } = await recoverable(t);
  await run(f.controller.reconcile(e.issue_id));
  const recovery = (await read()).response_recovery!;
  let hook: (event: any) => Effect.Effect<void> = () => Effect.void;
  await run(
    installGuards(
      {
        session: {
          get: ({ sessionID }: { sessionID: Id.SessionId }) =>
            f.runtime
              .session(sessionID)
              .pipe(Effect.map((s) => ({ location: { directory: s.directory }, agent: s.agent }))),
          hook: (name: string, callback: typeof hook) =>
            Effect.sync(() => {
              if (name === "prompt") hook = callback;
            }),
        },
        shell: { hook: () => Effect.void },
        tool: { hook: () => Effect.void },
      } as unknown as Context,
      f.controller,
    ),
  );
  const event = {
    sessionID: e.explore_session_id!,
    messageID: recovery.prompt_id,
    prompt: { text: recovery.prompt },
    delivery: "queue",
  };
  await run(hook(event));
  for (const changed of [
    { ...event, messageID: Id.MessageId.make("msg_forged") },
    { ...event, prompt: { text: "Repeat the task" } },
    { ...event, delivery: "steer" },
    { ...event, prompt: { text: recovery.prompt, files: [{ uri: "file:///private" }] } },
    { ...event, prompt: { text: recovery.prompt, agents: [{ id: "foreign" }] } },
    { ...event, prompt: { text: recovery.prompt, skills: [{ id: "foreign" }] } },
  ])
    await assert.rejects(run(hook(changed)), /Talk to Abra/);
  const interrupted: Id.MessageId[] = [];
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  f.runtime.interrupt = (id, prompt, additional) => {
    interrupted.push(...(additional ?? []));
    return interrupt(id, prompt, additional);
  };
  await run(f.controller.control(e.issue_id, "pause"));
  assert.ok(interrupted.includes(recovery.prompt_id));
  await assert.rejects(run(hook(event)), /Talk to Abra/);
});

test("a response committed at the native guard suppresses the unused identity without stranding capacity", async (t) => {
  const { f, e, read, reply } = await recoverable(t);
  let hook: (event: any) => Effect.Effect<void> = () => Effect.void;
  await run(
    installGuards(
      {
        session: {
          get: ({ sessionID }: { sessionID: Id.SessionId }) =>
            f.runtime
              .session(sessionID)
              .pipe(Effect.map((s) => ({ location: { directory: s.directory }, agent: s.agent }))),
          hook: (name: string, callback: typeof hook) =>
            Effect.sync(() => {
              if (name === "prompt") hook = callback;
            }),
        },
        shell: { hook: () => Effect.void },
        tool: { hook: () => Effect.void },
      } as unknown as Context,
      f.controller,
    ),
  );
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (session, text, id) =>
    reply().pipe(
      Effect.andThen(
        hook({ sessionID: session, messageID: id, prompt: { text }, delivery: "queue" }),
      ),
      Effect.andThen(prompt(session, text, id)),
    );
  const prompts = f.runtime.prompts;
  await run(f.controller.reconcile(e.issue_id));
  assert.equal((await read()).status, "answered");
  assert.equal((await read()).response_recovery?.status, "suppressed");
  assert.equal(f.runtime.prompts, prompts);
  await run(f.controller.reconcile(e.issue_id));
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(current.capacity_reservation, undefined);
  assert.equal(current.capacity_observed_idle, true);
  assert.equal(f.runtime.prompts, prompts);
});

test("fresh stop and generation changes during preflight prevent reminder admission", async (t) => {
  for (const transition of ["pause", "generation"] as const) {
    const { f, e, read } = await recoverable(t);
    f.runtime.preflight = () =>
      f.records
        .update(e.issue_id, (current) => ({
          ...current,
          ...(transition === "pause"
            ? { stop_status: "requested" as const }
            : { control_generation: current.control_generation + 1 }),
        }))
        .pipe(Effect.asVoid);
    const prompts = f.runtime.prompts;
    await run(f.controller.reconcile(e.issue_id));
    assert.equal((await read()).response_recovery?.status, "pending");
    assert.equal(f.runtime.prompts, prompts);
    assert.equal((await run(f.controller.get(e.issue_id))).attention_turns, 1);
  }
});

test("normal replies and unavailable native outcomes do not admit a reminder", async (t) => {
  for (const observation of ["replied", "unavailable"] as const) {
    const { f, e, request, read, reply } = await recoverable(t);
    if (observation === "replied") await run(reply());
    else {
      const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
      f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
        bound === request.prompt_id
          ? Effect.fail(new CrewError("OFFLINE", "Native outcome unavailable"))
          : session(id, bound);
    }
    const prompts = f.runtime.prompts;
    await run(f.controller.reconcile(e.issue_id));
    assert.equal((await read()).response_recovery, undefined);
    assert.equal(f.runtime.prompts, prompts);
    if (observation === "unavailable") {
      const current = await run(f.controller.get(e.issue_id));
      assert.equal(current.attention?.length, 1);
      assert.match(current.attention![0]!.evidence, /unavailable/);
      assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 1);
    }
  }
});

test("acknowledgement-only requests resolve normally or through their one response-only reminder", async (t) => {
  for (const omitted of [false, true]) {
    const { f, e, request, read } = await recoverable(t, 1, "acknowledgement");
    const acknowledge = () =>
      f.controller.workerReply(e.explore_session_id!, {
        action: "acknowledge",
        request_id: request.request_id,
        generation: request.generation,
      });
    const prompts = f.runtime.prompts;
    if (!omitted) await run(acknowledge());
    await run(f.controller.reconcile(e.issue_id));
    if (omitted) {
      assert.match((await read()).response_recovery!.prompt, /action acknowledge/);
      await run(acknowledge());
    } else assert.equal((await read()).response_recovery, undefined);
    assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
    assert.equal(f.runtime.prompts, prompts + (omitted ? 1 : 0));
  }
});

test("capacity waiting does not reserve a reminder or charge its diagnostic budget", async (t) => {
  const { f, e, read } = await recoverable(t);
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      capacity_observed_idle: true,
      capacity_reservation: undefined,
    })),
  );
  f.config.max_workers = 1;
  f.config.max_executions = 2;
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await run(f.records.saveProject({ ...project, max_executions: 2 }));
  const other = Id.IssueId.make("other-capacity-owner");
  f.work.add(other);
  await run(f.controller.start(other));
  const prompts = f.runtime.prompts;
  await run(f.controller.reconcile(e.issue_id));
  assert.equal((await read()).response_recovery, undefined);
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention_turns ?? 0, 0);
  assert.equal(current.capacity_wait?.consuming.includes(other), true);
  assert.equal(f.runtime.prompts, prompts);
});

test("concurrent reconciliation cannot reserve two reminders and a stopped reminder stays actionable", async (t) => {
  const { f, e, read, idle } = await recoverable(t);
  const prompts = f.runtime.prompts;
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => run(f.controller.reconcile(e.issue_id))),
  );
  for (const result of results)
    if (result.status === "rejected") assert.equal(result.reason.code, "LOCKED");
  const recovery = (await read()).response_recovery!;
  assert.equal(recovery.status, "admitted");
  assert.equal(f.runtime.prompts, prompts + 1);
  idle();
  Object.assign(f.runtime.sessions.get(e.explore_session_id!)!, {
    outcome: "failed",
    outcome_prompt_id: recovery.prompt_id,
    error: { type: "Provider", message: "Reminder turn failed" },
  });
  await run(f.controller.reconcile(e.issue_id));
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(current.current_phase, "failed");
  assert.equal(current.attention?.filter((a) => a.code === "message_pending").length, 1);
  assert.match(current.attention!.find((a) => a.code === "message_pending")!.evidence, /failed/);
  assert.equal((await read()).response_recovery?.prompt_id, recovery.prompt_id);
  assert.equal(f.runtime.prompts, prompts + 1);
});

test("a committed answer does not erase unresolved reminder transport uncertainty", async (t) => {
  const { f, e, read, reply } = await recoverable(t);
  f.runtime.prompt = () =>
    Effect.fail(new CrewError("RESPONSE_LOST", "Reminder submission unknown"));
  await run(f.controller.reconcile(e.issue_id));
  await run(reply());
  for (let tick = 0; tick < 2; tick++) {
    await run(f.controller.reconcile(e.issue_id));
    await run(f.controller.supervise());
  }
  const current = await run(f.controller.get(e.issue_id));
  assert.equal((await read()).status, "answered");
  assert.equal((await read()).response_recovery?.status, "admission_uncertain");
  assert.ok(current.capacity_reservation);
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
  const incident = current.attention!.find((a) => a.code === "message_pending")!;
  assert.notEqual(incident.status, "superseded");
  assert.match(incident.evidence, /business response already committed/);
  assert.equal(f.runtime.prompts, 2);
});

test("attention cannot spend the sole diagnostic turn while missing-response recovery is being classified", async (t) => {
  const { f, e, request, read } = await recoverable(t);
  const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
  let interleaved = false;
  f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
    Effect.gen(function* () {
      if (bound === request.prompt_id && !interleaved) {
        interleaved = true;
        yield* f.controller.supervise();
      }
      return yield* session(id, bound);
    });
  await run(f.controller.reconcile(e.issue_id));
  assert.equal(interleaved, true);
  assert.equal((await read()).response_recovery?.status, "admitted");
  assert.equal((await run(f.controller.get(e.issue_id))).attention_turns, 1);
  assert.equal(f.runtime.prompts, 3);
});

test("unconfirmed native completion holds ownership without spending a reminder and later recovers", async (t) => {
  const { f, e, read } = await recoverable(t);
  const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
  let completed = false;
  const prompts = f.runtime.prompts;
  f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
    session(id, bound).pipe(
      Effect.map((state) =>
        completed
          ? state
          : {
              ...state,
              busy: false,
              executing: false,
              completion_pending: true,
              diagnostic_error: "Native completion unconfirmed",
              assignment: bound ? { id: bound, outcome: "succeeded" as const } : undefined,
            },
      ),
    );
  await run(f.controller.reconcile(e.issue_id));
  const held = await run(f.controller.get(e.issue_id));
  assert.ok(held.capacity_reservation);
  assert.equal(held.attention_turns ?? 0, 0);
  assert.equal((await read()).response_recovery, undefined);
  assert.equal(f.runtime.prompts, prompts);
  completed = true;
  await run(f.controller.reconcile(e.issue_id));
  assert.equal((await read()).response_recovery?.status, "admitted");
  assert.equal(f.runtime.prompts, prompts + 1);
});

test("a routine reply notice cannot consume the diagnostic reserved for another outstanding response", async (t) => {
  const { f, e, idle, reply } = await recoverable(t, 2);
  const second = Id.RequestId.make("second-required-response");
  await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: second,
        role: "explore",
        response: "answer",
        body: "Reply to this second question",
      },
      e.supervisor_session_id!,
    ),
  );
  idle();
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (session, text, id) =>
    prompt(session, text, id).pipe(
      Effect.andThen(
        text.includes("response-only reminder for original request recoverable-question,")
          ? reply().pipe(Effect.andThen(f.controller.supervise()), Effect.asVoid)
          : Effect.void,
      ),
    );
  await run(f.controller.reconcile(e.issue_id));
  idle();
  await run(f.controller.reconcile(e.issue_id));
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(
    messageRequests(current.messages).find((m) => m.request_id === second)?.response_recovery
      ?.status,
    "admitted",
  );
  assert.equal(current.attention_turns, 2);
});

test("only a consumed request followed by its successful native turn establishes a missing reply", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("response-causality"),
    supervisor = Id.SessionId.make("ses_supervisor");
  f.work.add(issue);
  const e = await run(f.controller.start(issue, supervisor));
  const request = await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("required-answer"),
        role: "explore",
        body: "Which check applies?",
        response: "answer",
      },
      supervisor,
    ),
  );
  const id = e.explore_session_id!;
  const user = { type: "user", id: request.prompt_id, text: request.prompt, time: { created: 2 } };
  const failed = { type: "idle", id: "msg_failed", outcome: "failed", time: { created: 3 } };
  const success = { type: "idle", id: "msg_success", outcome: "succeeded", time: { created: 4 } };
  let history: SessionMessage.Info[] = [];
  const native = new NativeRuntime(
    {
      session: {
        get: () =>
          Effect.succeed({
            id,
            location: { directory: e.worktree_directory },
            outcome: "succeeded",
          }),
        context: () => Effect.succeed(history),
      },
      storage: { get: () => Effect.void },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        active: () => Effect.succeed({}),
        inbox: { list: () => Effect.succeed([]) },
      },
      message: { list: () => Effect.succeed({ data: history.toReversed(), cursor: {} }) },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  for (const [messages, expected] of [
    [[user, success], "missing"],
    [[success, user], "unavailable"],
    [[user], "unavailable"],
    [[user, failed, success], "failed"],
    [[user, success, success], "missing"],
    [[user, failed, { ...user, id: "msg_other_input" }, success], "failed"],
    [[{ ...user, id: "msg_other_input" }, success], "unavailable"],
  ] as const) {
    history = [
      ...(await run(
        decode(Schema.Array(SessionMessage.Info), messages, "native response history"),
      )),
    ];
    const state = await run(native.session(id, request.prompt_id));
    assert.equal(responseState(request, state, "consumed"), expected);
    if (state.diagnostic_error?.includes("unconfirmed")) {
      // Missing completion is in-flight evidence, not a verified empty session.
      assert.equal(state.busy, false);
      assert.equal(state.executing, false);
      assert.equal(state.completion_pending, true);
      assert.equal(state.assignment?.completion, undefined);
    }
    if (expected === "missing")
      assert.deepEqual(state.assignment?.completion, { id: "msg_success", at: 4 });
  }
  history = [
    ...(await run(
      decode(Schema.Array(SessionMessage.Info), [user, success], "native response history"),
    )),
  ];
  const state = await run(native.session(id, request.prompt_id));
  assert.equal(responseState(request, state, "queued"), "queued");
  assert.equal(
    responseState(request, { ...state, busy: true, executing: true }, "consumed"),
    "executing",
  );
  assert.equal(
    responseState(request, { ...state, executing: undefined }, "consumed"),
    "unavailable",
  );
  assert.equal(responseState(request, state, "absent"), "uncertain");
  assert.equal(responseState(request), "unavailable");
  assert.equal(responseState({ ...request, status: "cancelled" }), "superseded");
  assert.equal(
    responseState({ ...request, status: "acknowledged", response: "acknowledgement" }),
    "resolved",
  );
  assert.equal(responseState({ ...request, status: "acknowledged" }, state, "consumed"), "missing");
  assert.equal(responseState({ ...request, status: "answered" }), "resolved");
  assert.equal(
    responseState(request, { ...state, outcome: "interrupted" }, "consumed"),
    "interrupted",
  );
});
