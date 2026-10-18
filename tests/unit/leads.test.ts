import assert from "node:assert/strict";
import { test, type TestContext } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import { Tool } from "@opencode/schema/tool";
import { type Context } from "@opencode/plugin/effect/plugin";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { LeadRecordSchema, readLeads, leadAccounting } from "../../src/workflow/lead-contracts.ts";
import { type Runtime } from "../../src/opencode/runtime.ts";
import { installGuards } from "../../src/opencode/guards.ts";
import { registerTools } from "../../src/opencode/tools.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
const parent = Id.SessionId.make("ses_lead-parent");
const leadID = Id.LeadId.make("frontend-lead");
const repo = Id.RepositoryId.make("frontend");
const issue = Id.IssueId.make("lead-work");
const model = { providerID: Id.ProviderId.make("fixture"), id: Id.ModelId.make("fixture") };
const declaration = {
  action: "register" as const,
  id: leadID,
  expected_revision: 0,
  repositories: [repo],
  model,
  enabled: true,
};
async function prepare() {
  const f = await run(fixture);
  f.runtime.sessions.set(parent, {
    id: parent,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(parent));
  f.work.add(issue, repo);
  await run(f.controller.lead().control(parent, declaration));
  return { f, lead: (await run(readLeads(f.records)))[0]! };
}

test("lead observer isolates malformed registrations while authority remains deny-first", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const before = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  const view = new Visibility(f.controller);
  const initial = await run(view.snapshot());
  assert.equal(initial.leads![0]!.id, lead.id);
  assert.equal(initial.leads![0]!.session_available, true);
  assert.equal(initial.leads![0]!.enabled, true);
  assert.deepEqual(initial.leads![0]!.assigned_work, [issue]);
  await run(f.records.store.set(Id.StorageKey.make("lead/broken"), { malformed: true }));
  const isolated = await run(view.snapshot());
  assert.equal(isolated.leads!.length, 1);
  assert.equal(isolated.lead_diagnostics!.length, 1);
  await assert.rejects(run(readLeads(f.records)), { code: "INVALID_DATA" });
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    before,
  );
});

test("lead inspection shows pending shutdown before disabled without changing authority", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const bundle = await run(f.controller.queries.observe());
  const effects = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  for (const [enabled, stop_pending, expected] of [
    [true, false, "idle"],
    [true, true, "stopping"],
    [false, true, "stopping"],
    [false, false, "disabled"],
  ] as const) {
    const retained = { ...lead, enabled, stop_pending };
    await run(f.records.store.set(Id.StorageKey.make(`lead/${lead.id}`), retained));
    const { leads } = await run(f.controller.queries.leadOverview(bundle));
    assert.equal(leads[0]!.state, expected);
    assert.equal(leads[0]!.enabled, enabled);
    assert.equal(leads[0]!.session_available, true);
    assert.deepEqual((await run(readLeads(f.records)))[0], retained);
  }
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    effects,
  );
});

async function recoverableLead(t: TestContext, budget = 2) {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(repo)))!;
  await run(f.records.saveProject({ ...project, diagnostic_turns: budget }));
  const request = Id.RequestId.make("lead-required-response");
  await run(
    f.controller.lead().control(parent, {
      action: "message",
      id: leadID,
      revision: lead.revision,
      issue_id: issue,
      request_id: request,
      body: "Inspect the scoped evidence and reply",
    }),
  );
  const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
  const completions = new Map<Id.MessageId, { id: Id.MessageId; at: number }>();
  f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
    session(id).pipe(
      Effect.map((state) => {
        if (!bound || !state.outcome || !f.runtime.admissions.has(bound)) return state;
        if (!completions.has(bound))
          completions.set(bound, { id: Id.MessageId.make(`msg_idle_${bound}`), at: Date.now() });
        return {
          ...state,
          assignment: { id: bound, outcome: state.outcome, completion: completions.get(bound) },
        };
      }),
    );
  const idle = () =>
    Object.assign(f.runtime.sessions.get(lead.session_id)!, {
      busy: false,
      executing: false,
      outcome: "succeeded",
    });
  idle();
  const read = async () =>
    (await run(readLeads(f.records)))[0]!.requests.find((r) => r.request.request_id === request)!
      .request;
  return { f, lead, request, read, idle };
}

test("lead missing replies consume one management diagnostic attempt and retain one escalation without creating an execution", async (t) => {
  const { f, lead, read, idle } = await recoverableLead(t);
  assert.equal(await run(f.records.execution(issue)), undefined);
  const prompts = f.runtime.prompts;
  await run(f.controller.lead().scan());
  const recovery = (await read()).response_recovery!;
  assert.equal(recovery.status, "admitted");
  assert.match(recovery.prompt, /ORIGINAL request_id lead-required-response/);
  assert.equal((await read()).response_escalation, undefined);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal((await run(leadAccounting(f.records))).turns(issue), 2);
  assert.equal(
    await run(
      f.controller.lead().prompt(lead.session_id, recovery.prompt_id, recovery.prompt, "queue"),
    ),
    true,
  );
  await assert.rejects(
    run(f.controller.lead().prompt(lead.session_id, recovery.prompt_id, "Changed", "queue")),
    { code: "LEAD_PROMPT" },
  );
  await assert.rejects(
    run(f.controller.lead().prompt(lead.session_id, recovery.prompt_id, recovery.prompt, "steer")),
    { code: "LEAD_PROMPT" },
  );
  idle();
  for (let tick = 0; tick < 3; tick++) await run(f.controller.lead().scan());
  const incident = (await read()).response_escalation!;
  assert.match(incident.body, /automatic attempt exhausted/);
  assert.equal(incident.notified, true);
  assert.equal((await read()).response_recovery?.prompt_id, recovery.prompt_id);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal(await run(f.records.execution(issue)), undefined);
});

test("lead recovery replies resolve the original identity and accepted evidence survives disable", async (t) => {
  const { f, lead, request, read, idle } = await recoverableLead(t);
  await run(f.controller.lead().scan());
  const prompts = f.runtime.prompts;
  await run(
    f.controller.lead().action(lead.session_id, {
      action: "reply",
      revision: lead.revision,
      request_id: request,
      body: "Scoped evidence retained",
    }),
  );
  idle();
  await run(f.controller.lead().scan());
  assert.equal((await read()).status, "answered");
  assert.equal((await read()).response_escalation, undefined);
  assert.equal(f.runtime.prompts, prompts);
  const owned: Id.MessageId[] = [];
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  f.runtime.interrupt = (session, prompt, additional) => {
    owned.push(...(prompt ? [prompt] : []), ...(additional ?? []));
    return interrupt(session, prompt, additional);
  };
  await run(
    f.controller
      .lead()
      .control(parent, { ...declaration, expected_revision: lead.revision, enabled: false }),
  );
  assert.ok(owned.includes((await read()).response_recovery!.prompt_id));
  assert.equal((await read()).reply?.body, "Scoped evidence retained");
  await run(f.controller.lead().scan());
  assert.equal(f.runtime.prompts, prompts);
});

for (const admitted of [false, true]) {
  test(`lead reminder receipt loss with native admission ${admitted} preserves identity and lifetime budget across restart`, async (t) => {
    const { f, read } = await recoverableLead(t);
    const prompt = f.runtime.prompt.bind(f.runtime);
    f.runtime.prompt = (...args) =>
      (admitted ? prompt(...args) : Effect.void).pipe(
        Effect.andThen(Effect.fail(new CrewError("RESPONSE_LOST", "Lost lead reminder receipt"))),
      );
    await run(f.controller.lead().scan());
    const recovery = (await read()).response_recovery!;
    assert.equal(recovery.status, "admission_uncertain");
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
    for (let tick = 0; tick < 3; tick++) await run(restarted.lead().scan());
    assert.equal((await read()).response_recovery?.prompt_id, recovery.prompt_id);
    assert.equal(
      (await read()).response_recovery?.status,
      admitted ? "admitted" : "admission_uncertain",
    );
    assert.equal((await run(leadAccounting(f.records))).turns(issue), 2);
    assert.equal(f.runtime.prompts, prompts);
  });
}

test("manual posture, exhausted lead budgets, queued requests and busy sessions cannot produce reminders", async (t) => {
  for (const condition of ["manual", "budget", "queued", "busy"] as const) {
    const { f, read, lead } = await recoverableLead(t, condition === "budget" ? 1 : 2);
    if (condition === "manual") f.config.supervision_mode = "manual";
    if (condition === "queued") f.runtime.promptAdmission = () => Effect.succeed("queued" as const);
    if (condition === "busy")
      Object.assign(f.runtime.sessions.get(lead.session_id)!, { busy: true, executing: true });
    const prompts = f.runtime.prompts;
    for (let tick = 0; tick < 3; tick++) await run(f.controller.lead().scan());
    assert.equal((await read()).response_recovery, undefined);
    assert.equal(f.runtime.prompts, prompts);
    assert.equal((await run(leadAccounting(f.records))).turns(issue), 1);
    if (condition === "manual" || condition === "budget")
      assert.ok((await read()).response_escalation?.notice_id);
  }
});

test("lead escalation notification loss retries one retained synthetic notice and cannot wake a model", async (t) => {
  const { f, read, idle } = await recoverableLead(t);
  await run(f.controller.lead().scan());
  idle();
  const notices = new Map<Id.MessageId, string>();
  let calls = 0;
  f.runtime.notify = (_session, text, id) =>
    Effect.sync(() => {
      assert.ok(id);
      if (notices.has(id)) assert.equal(notices.get(id), text);
      notices.set(id, text);
      calls++;
    });
  const set = f.records.store.set.bind(f.records.store);
  let lose = true;
  f.records.store.set = (key, value) =>
    key === `lead/${leadID}` && lose && JSON.stringify(value).includes('"notified":true')
      ? ((lose = false), Effect.fail(new CrewError("STORAGE", "Lost escalation receipt")))
      : set(key, value);
  const prompts = f.runtime.prompts;
  await run(f.controller.lead().scan());
  assert.equal((await read()).response_escalation?.notified, undefined);
  await run(f.controller.lead().scan());
  await run(f.controller.lead().scan());
  assert.equal((await read()).response_escalation?.notified, true);
  assert.equal(notices.size, 1);
  assert.equal(calls, 2);
  assert.equal(f.runtime.prompts, prompts);
});

test("lead registration persists session intent before creation and retries the same identity after response loss", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.runtime.sessions.set(parent, {
    id: parent,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(parent));
  const original = f.runtime.managementSession.bind(f.runtime);
  let once = true;
  f.runtime.managementSession = (...args) =>
    original(...args).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (once) {
            once = false;
            return Effect.fail(new CrewError("TRANSPORT", "response lost"));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(f.controller.lead().control(parent, declaration)), /response lost/);
  const intent = (await run(readLeads(f.records)))[0]!;
  assert.equal(intent.provisioned, false);
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
  await run(restarted.lead().control(parent, declaration));
  const retained = (await run(readLeads(f.records)))[0]!;
  assert.equal(retained.session_id, intent.session_id);
  assert.equal(retained.provisioned, true);
  assert.equal(f.runtime.sessions.size, 2);
  assert.equal(retained.revision, 1);
  assert.throws(() =>
    Schema.decodeSync(LeadRecordSchema)({
      ...retained,
      retired_sessions: [retained.session_id],
    }),
  );
  await assert.rejects(run(restarted.lead().control(retained.session_id, declaration)), /Abra/);
  await assert.rejects(
    run(
      restarted.lead().control(parent, {
        ...declaration,
        expected_revision: 0,
        model: { ...model, id: Id.ModelId.make("different") },
      }),
    ),
    /revision/,
  );
});

test("a moved lead session is refused before native request admission", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  f.runtime.sessions.get(lead.session_id)!.directory = Id.AbsolutePath.make("/foreign-location");
  const prompts = f.runtime.prompts;
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        action: "message",
        id: leadID,
        revision: lead.revision,
        issue_id: issue,
        request_id: Id.RequestId.make("moved-lead-request"),
        body: "Inspect only the registered scope",
      }),
    ),
    { code: "LEAD_SESSION" },
  );
  assert.equal(f.runtime.prompts, prompts);
  const retained = (await run(readLeads(f.records)))[0]!.requests[0]!.request;
  assert.equal(retained.status, "pending");
});

test("scoped lead proposals never create or start work until Abra accepts once; cross-project reads/dependencies are refused", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const other = Id.IssueId.make("other-project");
  f.work.add(other, Id.RepositoryId.make("backend"));
  const act = f.controller.lead().action;
  await assert.rejects(
    run(act(lead.session_id, { action: "status", revision: 1, issue_id: other })),
    /outside/,
  );
  const status = await run(act(lead.session_id, { action: "status", revision: 1 }));
  assert.ok(!JSON.stringify(status).includes("other-project"));
  assert.ok(!JSON.stringify(status).includes("configuration_snapshot"));
  const batch = {
    request_id: Id.RequestId.make("proposal"),
    tasks: [
      {
        client_key: "one",
        repository_id: repo,
        title: "Investigate",
        description: "Deliver findings",
        workflow_policy: "research-only" as const,
        scope: { goal: "Deliver findings", acceptance: ["Evidence retained"], constraints: [] },
      },
    ],
  };
  for (const task of [
    { ...batch.tasks[0]!, repository_id: Id.RepositoryId.make("backend") },
    { ...batch.tasks[0]!, dependencies: [{ type: "existing" as const, issue_id: other }] },
  ])
    await assert.rejects(
      run(
        act(lead.session_id, {
          action: "propose",
          revision: 1,
          batch: { ...batch, tasks: [task] },
        }),
      ),
      /scope/,
    );
  await run(act(lead.session_id, { action: "propose", revision: 1, batch }));
  assert.equal(f.work.issues.size, 2);
  assert.equal(f.runtime.prompts, 0);
  await assert.rejects(
    run(
      act(lead.session_id, {
        action: "propose",
        revision: 1,
        batch: { ...batch, tasks: [{ ...batch.tasks[0]!, title: "Different" }] },
      }),
    ),
    /rebound/,
  );
  const accepted = await run(
    f.controller
      .lead()
      .control(parent, { action: "accept", id: leadID, revision: 1, request_id: batch.request_id }),
  );
  assert.deepEqual(
    await run(
      f.controller.lead().control(parent, {
        action: "accept",
        id: leadID,
        revision: 1,
        request_id: batch.request_id,
      }),
    ),
    accepted,
  );
  assert.equal(f.work.issues.size, 3);
  assert.equal(f.runtime.prompts, 0);
});

test("shared native request recovery preserves correlation, budget, duplicate reply and unresolved interrupted work", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const request = {
    action: "message" as const,
    id: leadID,
    revision: 1,
    issue_id: issue,
    request_id: Id.RequestId.make("lead-question"),
    body: "Investigate scoped state",
  };
  const prompt = f.runtime.prompt.bind(f.runtime);
  let once = true;
  f.runtime.prompt = (...args) =>
    prompt(...args).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (once) {
            once = false;
            return Effect.fail(new CrewError("TRANSPORT", "lost admission"));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(f.controller.lead().control(parent, request)), /lost admission/);
  const pending = (await run(readLeads(f.records)))[0]!.requests[0]!.request;
  assert.equal(pending.status, "admission_uncertain");
  assert.equal(f.runtime.prompts, 1);
  await run(f.controller.lead().control(parent, request));
  assert.equal(f.runtime.prompts, 1);
  await assert.rejects(
    run(f.controller.lead().control(parent, { ...request, body: "Changed" })),
    /rebound/,
  );
  await assert.rejects(
    run(
      f.controller.lead().action(parent, {
        action: "reply",
        revision: 1,
        request_id: request.request_id,
        body: "forged",
      }),
    ),
    /principal/,
  );
  const reply = {
    action: "reply" as const,
    revision: 1,
    request_id: request.request_id,
    body: "Evidence retained",
  };
  const first = await run(f.controller.lead().action(lead.session_id, reply));
  assert.deepEqual(await run(f.controller.lead().action(lead.session_id, reply)), first);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { ...reply, body: "rebound" })),
    /another answer/,
  );
  const session = f.runtime.sessions.get(lead.session_id)!;
  session.busy = false;
  session.executing = false;
  session.outcome = "interrupted";
  await run(f.controller.lead().scan());
  await assert.rejects(
    run(
      f.controller
        .lead()
        .control(parent, { ...request, request_id: Id.RequestId.make("beyond-budget") }),
    ),
    /budget/,
  );
  assert.equal(
    (await run(readLeads(f.records)))[0]!.requests[0]!.request.prompt_id,
    pending.prompt_id,
  );
});

test("disable confirms native stop before revision/model/scope changes, retired sessions never regain management authority", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  await run(
    f.controller.lead().control(parent, {
      action: "message",
      id: leadID,
      revision: 1,
      issue_id: issue,
      request_id: Id.RequestId.make("open"),
      body: "Pending work",
    }),
  );
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        ...declaration,
        expected_revision: 1,
        repositories: [Id.RepositoryId.make("other")],
      }),
    ),
    /Registered|Disable/,
  );
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  let once = true;
  f.runtime.interrupt = (...args) =>
    once
      ? ((once = false), Effect.fail(new CrewError("TRANSPORT", "stop lost")))
      : interrupt(...args);
  const disable = { ...declaration, expected_revision: 1, enabled: false };
  await assert.rejects(run(f.controller.lead().control(parent, disable)), /stop lost/);
  assert.equal((await run(readLeads(f.records)))[0]!.stop_pending, true);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { action: "status", revision: 2 })),
    /principal/,
  );
  await run(f.controller.lead().control(parent, disable));
  const stopped = (await run(readLeads(f.records)))[0]!;
  assert.equal(stopped.active, false);
  assert.equal(stopped.stop_pending, false);
  assert.equal(stopped.requests[0]!.request.status, "superseded");
  const changed = {
    ...declaration,
    expected_revision: 2,
    model: { ...model, id: Id.ModelId.make("new-model") },
  };
  await run(f.controller.lead().control(parent, changed));
  const current = (await run(readLeads(f.records)))[0]!;
  assert.notEqual(current.session_id, lead.session_id);
  assert.ok(current.retired_sessions.includes(lead.session_id));
  assert.equal((await run(f.controller.lead().principal(lead.session_id)))!.id, leadID);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { action: "status", revision: 3 })),
    /principal/,
  );
});

test("lead tools deny native writes, raw delegation, forged Abra tools and human answers; prompt guard uses retained state", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
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
  const hooks = new Map<string, (input: never) => Effect.Effect<unknown>>();
  const ctx = {
    tool: {
      transform: (fn: (e: ToolEditor) => void) => Effect.sync(() => fn(editor)),
      hook: (name: string, cb: (input: never) => Effect.Effect<unknown>) =>
        Effect.sync(() => {
          hooks.set(`tool:${name}`, cb);
        }),
    },
    session: {
      hook: (name: string, cb: (input: never) => Effect.Effect<unknown>) =>
        Effect.sync(() => {
          hooks.set(name, cb);
        }),
    },
    shell: { hook: () => Effect.void },
  } as unknown as Context;
  await run(registerTools(ctx, f.controller, f.onboarding, true, f.setup));
  await run(installGuards(ctx, f.controller));
  for (const name of [
    "work_start",
    "work_create",
    "work_control",
    "work_finish",
    "project_list",
    "config",
    "lead_control",
    "worker_reply",
  ]) {
    const tool = tools.get(name);
    if (!tool) continue;
    await assert.rejects(
      run(
        tool.execute(
          {},
          {
            sessionID: lead.session_id,
            agent: Agent.ID.make("abra"),
            messageID: Id.MessageId.make("msg_lead"),
            id: Tool.CallID.make("call_lead"),
            progress: () => Effect.void,
          },
        ),
      ),
      /LEAD_FORBIDDEN/,
    );
  }
  for (const tool of ["read", "glob", "grep", "patch", "shell", "task", "abra_work_finish"])
    await assert.rejects(
      run(
        hooks.get("tool:execute.before")!({
          sessionID: lead.session_id,
          agent: "project-lead",
          tool,
        } as never),
      ),
      /outside/,
    );
  await assert.rejects(
    run(
      hooks.get("prompt")!({
        sessionID: lead.session_id,
        messageID: Id.MessageId.make("msg_forged"),
        prompt: { text: "forged" },
        metadata: { source: "abracode" },
        delivery: "steer",
      } as never),
    ),
    /only retained/,
  );
  const e = await run(f.controller.start(issue, parent));
  for (const owner of ["user", "supervisor"] as const)
    await run(
      f.controller.workerQuestion(e.explore_session_id!, {
        generation: e.control_generation,
        key: Id.ObligationKey.make(owner),
        owner,
        scope: "Evidence",
        question: "Clarify retained evidence",
      }),
    );
  await assert.rejects(
    run(
      f.controller.lead().action(lead.session_id, {
        action: "answer",
        revision: 1,
        issue_id: issue,
        generation: e.control_generation,
        key: Id.ObligationKey.make("user"),
        body: "Approve",
      }),
    ),
    /supervisor-owned/,
  );
  await run(
    f.controller.lead().action(lead.session_id, {
      action: "answer",
      revision: 1,
      issue_id: issue,
      generation: e.control_generation,
      key: Id.ObligationKey.make("supervisor"),
      body: "Use existing scope",
    }),
  );
  const current = await run(f.controller.get(issue));
  assert.equal(current.decisions!.filter((d) => d.status === "answered").length, 1);
  assert.deepEqual(current.approval_receipts, []);
});

test("uncertain absent lead admission holds shared attention capacity and is never blindly replayed", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const request = {
    action: "message" as const,
    id: leadID,
    revision: 1,
    issue_id: issue,
    request_id: Id.RequestId.make("uncertain-absent"),
    body: "Inspect retained source",
  };
  let attempts = 0;
  f.runtime.prompt = () => {
    attempts++;
    return Effect.fail(new CrewError("TRANSPORT", "unknown admission"));
  };
  await assert.rejects(run(f.controller.lead().control(parent, request)), /unknown admission/);
  await run(f.controller.lead().control(parent, request));
  assert.equal(attempts, 1);
  const otherID = Id.LeadId.make("second-lead");
  await run(f.controller.lead().control(parent, { ...declaration, id: otherID }));
  const otherIssue = Id.IssueId.make("second-source");
  f.work.add(otherIssue, repo);
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        ...request,
        id: otherID,
        issue_id: otherIssue,
        request_id: Id.RequestId.make("second-request"),
      }),
    ),
    /capacity/,
  );
  const current = (await run(readLeads(f.records))).find((r) => r.id === lead.id)!;
  assert.equal(current.active, true);
  assert.equal(current.requests[0]!.request.status, "admission_uncertain");
  await run(
    f.controller.lead().control(parent, { ...declaration, expected_revision: 1, enabled: false }),
  );
  const stopped = (await run(readLeads(f.records))).find((r) => r.id === lead.id)!;
  assert.equal(stopped.active, false);
  assert.equal(stopped.requests[0]!.request.status, "superseded");
});

test("proposal acceptance recovers a graph commit without a lead receipt and synthetic notices reuse their retained identity", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const batch = {
    request_id: Id.RequestId.make("recover-proposal"),
    tasks: [
      {
        client_key: "research",
        repository_id: repo,
        title: "Investigation",
        description: "Collect evidence",
        workflow_policy: "research-only" as const,
        scope: { goal: "Collect evidence", acceptance: ["Retain findings"], constraints: [] },
      },
    ],
  };
  await run(f.controller.lead().action(lead.session_id, { action: "propose", revision: 1, batch }));
  const set = f.records.store.set.bind(f.records.store);
  let fail = true;
  f.records.store.set = (key, value) => {
    if (key === `lead/${leadID}` && fail && JSON.stringify(value).includes('"accepted"')) {
      fail = false;
      return Effect.fail(new CrewError("STORAGE", "lost accepted receipt"));
    }
    return set(key, value);
  };
  const acceptance = {
    action: "accept" as const,
    id: leadID,
    revision: 1,
    request_id: batch.request_id,
  };
  await assert.rejects(run(f.controller.lead().control(parent, acceptance)), /lost accepted/);
  assert.equal(f.work.issues.size, 2);
  await run(f.controller.lead().control(parent, acceptance));
  assert.equal(f.work.issues.size, 2);
  const notices = new Map<Id.MessageId, string>();
  let calls = 0;
  f.runtime.notify = (_s: Id.SessionId, text: string, id?: Id.MessageId) =>
    Effect.sync(() => {
      assert.ok(id);
      if (notices.has(id)) assert.equal(notices.get(id), text);
      notices.set(id, text);
      calls++;
    });
  let lose = true;
  f.records.store.set = (key, value) =>
    key === `lead/${leadID}` && lose && JSON.stringify(value).includes('"notified":true')
      ? ((lose = false), Effect.fail(new CrewError("STORAGE", "lost notice receipt")))
      : set(key, value);
  await run(f.controller.lead().scan());
  await run(f.controller.lead().scan());
  assert.equal(notices.size, 1);
  assert.equal(calls, 2);
  assert.equal((await run(readLeads(f.records)))[0]!.proposals[0]!.notified, true);
});
