import { nativeReviews } from "../../src/web/review-tool.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { Agent } from "@opencode/schema/agent";
import { Tool } from "@opencode/schema/tool";
import { type Context } from "@opencode/plugin/effect/plugin";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { readLeads } from "../../src/workflow/leads/contracts.ts";
import { installGuards } from "../../src/opencode/guards.ts";
import { registerTools } from "../../src/opencode/tools.ts";
import { run } from "../effects.ts";
import { parent, leadID, repo, issue, declaration, prepare } from "../helpers/registered-lead.ts";
test("scoped lead proposals never create or start work until Abra accepts once; cross-project reads/dependencies are refused", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const other = Id.IssueId.make("other-project");
  f.seed.named(other, Id.RepositoryId.make("backend"));
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
  assert.equal((await run(f.work.list)).length, 2);
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
  assert.equal((await run(f.work.list)).length, 3);
  assert.equal(f.runtime.prompts, 0);
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
    permission: { hook: () => Effect.void },
    shell: { hook: () => Effect.void },
  } as unknown as Context;
  await run(
    registerTools(
      ctx,
      f.controller,
      f.onboarding,
      true,
      f.setup,
      nativeReviews(f.controller, f.records.store, f.locks),
    ),
  );
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
  const foreign = Id.IssueId.make("another-worker");
  f.seed.named(foreign, Id.RepositoryId.make("api"));
  const other = await run(f.controller.start(foreign, parent));
  for (const [caller, code] of [
    [lead.session_id, "ABRA_REQUIRED"],
    [other.explore_session_id!, "WORKER_FORBIDDEN"],
  ] as const) {
    await assert.rejects(
      run(
        f.controller.decision(
          issue,
          Id.ObligationKey.make("supervisor"),
          e.control_generation,
          caller,
          "answer",
          "Bypass",
        ),
      ),
      { code },
    );
  }
  assert.equal(
    (await run(f.controller.get(issue))).decisions!.filter((d) => d.status === "answered").length,
    0,
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
  assert.equal((await run(f.work.list)).length, 2);
  await run(f.controller.lead().control(parent, acceptance));
  assert.equal((await run(f.work.list)).length, 2);
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

test("lead recall checks the live registration and native location before memory access", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  f.config.memory = {
    enabled: true,
    directory: Id.AbsolutePath.make("/unused-memory"),
    executable: Id.AbsolutePath.make("/unused-bm"),
  };
  const calls: string[] = [];
  f.controller.memory.search = (id) => {
    calls.push(id!);
    return Effect.succeed({ entries: [] });
  };
  const query = {
    action: "memory_search" as const,
    revision: lead.revision,
    repository_id: repo,
    query: "rotation",
  };
  await run(f.controller.lead().action(lead.session_id, query));
  await assert.rejects(
    run(
      f.controller
        .lead()
        .action(lead.session_id, { ...query, repository_id: Id.RepositoryId.make("other") }),
    ),
    /assigned/,
  );
  f.runtime.sessions.get(lead.session_id)!.directory = Id.AbsolutePath.make("/elsewhere");
  await assert.rejects(run(f.controller.lead().action(lead.session_id, query)), /moved/);
  f.runtime.sessions.get(lead.session_id)!.directory = f.config.home;
  await run(
    f.controller
      .lead()
      .control(parent, { ...declaration, expected_revision: lead.revision, enabled: false }),
  );
  await assert.rejects(run(f.controller.lead().action(lead.session_id, query)), /current/);
  assert.deepEqual(calls, [repo]);
});
