import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { Skill } from "@opencode/schema/skill";
import { join } from "node:path";
import { readFile, writeFile } from "../../src/filesystem.ts";
import * as Id from "../../src/identities.ts";
import { engineeringSkillIds } from "../../src/opencode/engineering-skills.ts";
import { resolveSkills, missingTools } from "../../src/opencode/worker-environment.ts";
import { WorkerContexts, readWorkerContext } from "../../src/workflow/worker-context.ts";
import { WorkerContextSchema } from "../../src/workflow/worker-context-contracts.ts";
import { ConfigInputSchema } from "../../src/config/contracts.ts";
import { fixture, MemoryStore } from "../fixtures.ts";
import { run } from "../effects.ts";
import { CrewError } from "../../src/domain.ts";

test("required skills resolve by native ID at the worker location without granting tools", async () => {
  const id = Skill.ID.make("specialist");
  const config = { required_skills: [id] };
  const skill = {
    id,
    name: Skill.Name.make("different-name"),
    path: Id.AbsolutePath.make("/worker/skill.md"),
    content: "Useful guidance",
  };
  const browser = { ...skill, id: Skill.ID.make("abra-browser") };
  for (const inventory of [
    [browser],
    [browser, skill, skill],
    [browser, { ...skill, content: " " }],
  ])
    await assert.rejects(
      run(resolveSkills("research", "research-only", config, inventory, "/worker")),
      /specialist.*workers.research.required_skills/,
    );
  const result = await run(
    resolveSkills("research", "research-only", config, [browser, skill], "/worker"),
  );
  assert.equal(result.skills[0].loading, "unobserved");
  assert.ok(
    !result.tools.flatMap((group) => group.any_of).includes(Id.ToolName.make("abra_work_finish")),
  );
  assert.throws(() =>
    Schema.decodeSync(ConfigInputSchema)({
      version: 1,
      models: { default: { providerID: "fake", id: "fixture" } },
      workers: { apply: { required_tools: [{ any_of: [] }] } },
    }),
  );
  assert.doesNotThrow(() =>
    Schema.decodeSync(ConfigInputSchema)({
      version: 1,
      models: { default: { providerID: "fake", id: "fixture" } },
      workers: { apply: { agent: "build" } },
    }),
  );
  assert.deepEqual(
    missingTools(
      [{ any_of: [Id.ToolName.make("edit"), Id.ToolName.make("patch")], source: "policy" }],
      ["patch"],
    ),
    [],
  );
});

test("captured context is immutable, survives source edits and diagnostics are read-only", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  assert.ok(e.worker_context_id);
  const original = await run(readWorkerContext(f.records.store, e.worker_context_id));
  await run(writeFile(join(f.config.home, ".opencode/agents/explore.md"), "Changed role guidance"));
  f.work.issues.get(issue)!.description = "Changed issue request";
  assert.deepEqual(await run(readWorkerContext(f.records.store, e.worker_context_id)), original);
  assert.ok(!original.guidance.content.startsWith("---"));
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      key: Id.ObligationKey.make("pending-context-question"),
      generation: e.control_generation,
      scope: "context",
      question: "Retain this unanswered decision",
      owner: "user",
    }),
  );
  const before = await run(f.records.export());
  const diag = await run(f.controller.diagnostics(issue, "explore"));
  assert.equal(diag.contexts[0].provenance, "captured");
  assert.equal(diag.contexts[0].skills[0].loading, "unobserved");
  assert.ok(!JSON.stringify(diag.contexts).includes(original.prompt));
  assert.deepEqual(await run(f.records.export()), before);
  const exported = await run(f.records.export());
  assert.ok(exported.entries.some((entry) => entry.key === `worker-context/${original.prompt_id}`));
  assert.throws(() =>
    Schema.decodeUnknownSync(WorkerContextSchema)({ ...original, schema_version: 999 }),
  );
  const contexts = new WorkerContexts(f.records, f.config);
  await assert.rejects(
    run(
      contexts.prepare(
        e,
        "explore",
        f.work.issues.get(issue)!,
        original.environment,
        e.explore_session_id!,
        original.prompt_id,
        [],
      ),
    ),
    /already has/,
  );
  assert.ok(
    (await run(readFile(join(f.config.home, ".opencode/agents/explore.md"), "utf8"))).includes(
      "Changed",
    ),
  );
});

test("pre-session capability failures remain inspectable and release only unsubmitted capacity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("missing-skill");
  f.work.add(issue);
  f.runtime.preflight = () =>
    Effect.fail(
      new CrewError(
        "SKILL_UNAVAILABLE",
        "research at /worker: required skill missing; repair registration; Authorization: Bearer fixture-context-private",
      ),
    );
  await assert.rejects(run(f.controller.start(issue)), /required skill missing/);
  const e = await run(f.controller.get(issue));
  assert.equal(e.capacity_reservation, undefined);
  assert.equal(e.explore_session_id, undefined);
  assert.equal(f.runtime.prompts, 0);
  const diag = await run(f.controller.diagnostics(issue, "explore"));
  assert.equal(diag.sessions.length, 0);
  assert.equal(diag.contexts[0].status?.blocker?.code, "SKILL_UNAVAILABLE");
  assert.ok(!JSON.stringify(diag).includes("fixture-context-private"));
});

test("request validation blocks missing tools, accepts patch and fences replaced observations", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("request-tools");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const ctx = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  const names = ctx.environment.tools.map((group) =>
    group.any_of.includes(Id.ToolName.make("patch")) ? Id.ToolName.make("patch") : group.any_of[0],
  );
  const contexts = new WorkerContexts(f.records, f.config);
  await assert.rejects(
    run(
      contexts.request(
        e,
        "explore",
        e.explore_session_id!,
        ctx.environment.model,
        names.filter((name) => name !== "patch"),
      ),
    ),
    /missing required tool/,
  );
  const diag = await run(f.controller.diagnostics(issue, "explore"));
  assert.equal(diag.contexts[0].status?.stage, "blocked");
  assert.equal(
    await run(contexts.request(e, "explore", e.explore_session_id!, ctx.environment.model, names)),
    ctx.guidance.content,
  );
  const statusBefore = await run(
    f.records.store.get(Id.StorageKey.make(`worker-context-status/${e.execution_id}/explore`)),
  );
  await run(f.records.saveControl({ ...e }));
  await assert.rejects(
    run(contexts.request(e, "explore", e.explore_session_id!, ctx.environment.model, names)),
    /superseded/,
  );
  assert.deepEqual(
    await run(
      f.records.store.get(Id.StorageKey.make(`worker-context-status/${e.execution_id}/explore`)),
    ),
    statusBefore,
  );
});

test("example configuration decodes with role prerequisites", async () => {
  const { parseYaml } = await import("../../src/config/contracts.ts");
  const { capabilityRequirements } = await import("../../src/opencode/role-policy.ts");
  const example = await run(
    readFile("abracode.example.yaml", "utf8").pipe(
      Effect.flatMap((text) => parseYaml(text, "Example")),
    ),
  );
  const config = Schema.decodeUnknownSync(ConfigInputSchema)(example);
  for (const role of ["explore", "apply", "review", "research"] as const)
    assert.doesNotThrow(() =>
      capabilityRequirements(role, config.default_workflow, config.workers?.[role]),
    );
});

test("legacy and malformed provenance stay explicit while context summaries remain bounded", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("legacy-context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const context = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  await run(
    f.records.store.set(Id.StorageKey.make(`worker-context/${context.prompt_id}`), {
      ...context,
      prompt: "private-prompt-sentinel",
      references: Array.from({ length: 100 }, () => ({
        path: "/retained/reference",
        status: "declared",
      })),
    }),
  );
  const bounded = await run(f.controller.diagnostics(issue, "explore"));
  assert.equal(bounded.contexts[0].references.length, 32);
  assert.equal(bounded.contexts[0].omitted, 68);
  assert.ok(!JSON.stringify(bounded.contexts).includes("private-prompt-sentinel"));
  assert.ok(f.records.store instanceof MemoryStore);
  f.records.store.values.delete(`worker-context-status/${e.execution_id}/explore`);
  delete e.worker_context_id;
  await run(f.records.save(e));
  assert.equal(
    (await run(f.controller.diagnostics(issue, "explore"))).contexts[0].provenance,
    "legacy_unavailable",
  );
  await run(
    f.records.store.set(Id.StorageKey.make(`worker-context-status/${e.execution_id}/explore`), {
      schema_version: 999,
    }),
  );
  const damaged = await run(f.controller.diagnostics(issue));
  assert.equal(damaged.contexts[0].provenance, "invalid");
  assert.equal(damaged.contexts[1].provenance, "legacy_unavailable");
});

test("partial context persistence is not prompt admission and cannot replace the active payload", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("orphan-context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const original = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  const id = Id.MessageId.make("msg_orphan_context");
  const set = f.records.store.set.bind(f.records.store);
  f.records.store.set = (key, value) =>
    key.startsWith("worker-context-status/")
      ? Effect.fail(new CrewError("FIXTURE_WRITE", "Interrupted status pointer write"))
      : set(key, value);
  const count = f.runtime.prompts;
  const contexts = new WorkerContexts(f.records, f.config);
  await assert.rejects(
    run(
      contexts.prepare(
        e,
        "explore",
        f.work.issues.get(issue)!,
        original.environment,
        e.explore_session_id!,
        id,
        [],
      ),
    ),
    /Interrupted status/,
  );
  f.records.store.set = set;
  assert.equal((await run(readWorkerContext(f.records.store, id))).prompt_id, id);
  assert.equal((await run(f.controller.get(issue))).worker_context_id, original.prompt_id);
  assert.equal(f.runtime.prompts, count);
  assert.equal(
    (await run(f.controller.diagnostics(issue, "explore"))).contexts[0].context_id,
    original.prompt_id,
  );
});

test("cold native registry activation is awaited without creating a session", async () => {
  const { awaitWorkerPlugin } = await import("../../src/opencode/worker-environment.ts");
  const { Plugin } = await import("@opencode/schema/plugin");
  let polls = 0;
  const inventory = Effect.sync(() =>
    ++polls < 2
      ? []
      : [
          {
            id: Plugin.ID.make("abracode"),
            state: { status: "active" as const },
            source: { type: "builtin" as const },
          },
        ],
  );
  await run(awaitWorkerPlugin(inventory, 3, 0));
  assert.equal(polls, 2);
  await assert.rejects(
    run(awaitWorkerPlugin(Effect.succeed([]), 1, 0)),
    /activation has not settled/,
  );
});

test("policy incompatibility is retained as a blocker without replacing captured instructions", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("policy-drift");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const context = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  const prior = { ...context, policy: "previous-policy-version" };
  await run(f.records.store.set(Id.StorageKey.make(`worker-context/${context.prompt_id}`), prior));
  const contexts = new WorkerContexts(f.records, f.config);
  await assert.rejects(
    run(contexts.request(e, "explore", e.explore_session_id!, context.environment.model, [])),
    /Captured policy is incompatible/,
  );
  const diagnostics = await run(f.controller.diagnostics(issue, "explore"));
  assert.equal(diagnostics.contexts[0].status?.blocker?.code, "CONTEXT_POLICY");
  assert.deepEqual(await run(readWorkerContext(f.records.store, e.worker_context_id!)), prior);
});

test("a deliberate retry keeps captured profiles despite live config edits and preserves old context", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("new-profile-context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const previous = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  const session = f.runtime.sessions.get(e.explore_session_id!)!;
  session.busy = false;
  session.outcome = "failed";
  await run(f.controller.reconcile(issue));
  f.config.workers.explore = { agent: Id.AgentId.make("specialized") };
  const retried = await run(f.controller.control(issue, "retry"));
  assert.equal(f.runtime.permissionRefreshes, 1);
  const next = await run(readWorkerContext(f.records.store, retried.worker_context_id!));
  assert.notEqual(next.prompt_id, previous.prompt_id);
  assert.equal(next.environment.agent, previous.environment.agent);
  assert.equal(
    (await run(f.runtime.session(retried.explore_session_id!))).agent,
    previous.environment.agent,
  );
  assert.deepEqual(await run(readWorkerContext(f.records.store, previous.prompt_id)), previous);
  assert.equal(retried.explore_session_id, e.explore_session_id);
  const name = `Browser session: abracode-${e.explore_session_id}.`;
  assert.ok(previous.prompt.includes(name));
  assert.ok(next.prompt.includes(name));
});

test("a retained payload cannot be reused for another role, prompt or generation", async (t) => {
  const { compatibleContext } = await import("../../src/workflow/worker-context.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("bound-context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const context = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  assert.doesNotThrow(() => compatibleContext(context, context));
  for (const assignment of [
    { ...context, role: "apply" as const },
    { ...context, generation: context.generation + 1 },
    { ...context, prompt_id: Id.MessageId.make("msg_other_context") },
  ])
    assert.throws(
      () => compatibleContext(context, assignment),
      /do not match the retained admission/,
    );
});

test("browser context derives distinct session names and evidence directories without altering old captures", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("browser-context");
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  const previous = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  const contexts = new WorkerContexts(f.records, f.config);
  for (const id of ["ses_replacement", "ses_concurrent"]) {
    const next = await run(
      contexts.prepare(
        e,
        "explore",
        f.work.issues.get(issue)!,
        previous.environment,
        Id.SessionId.make(id),
        Id.MessageId.make(`msg_${id}`),
        [],
      ),
    );
    assert.ok(next.prompt.includes(`Browser session: abracode-${id}.`));
    assert.ok(next.prompt.includes(join(f.config.home, ".abracode/browser", id)));
    assert.ok(!next.prompt.includes(`Browser session: abracode-${e.explore_session_id}.`));
  }
  assert.deepEqual(await run(readWorkerContext(f.records.store, previous.prompt_id)), previous);
});

test("browser prerequisites are optional unless explicitly required, without dropping development shell requirements", async () => {
  for (const role of ["explore", "apply", "review", "research"] as const) {
    const defaults = engineeringSkillIds(role, "lightweight-fix").map((id) => ({
      id,
      name: Skill.Name.make(id),
      path: Id.AbsolutePath.make(`/installed/${id}.md`),
      content: "Offline guidance",
    }));
    const ordinary = await run(resolveSkills(role, "lightweight-fix", {}, defaults, "/foreign"));
    assert.deepEqual(
      ordinary.skills.map((s) => s.id),
      defaults.map((s) => s.id),
    );
    const withoutShell = ordinary.tools
      .flatMap((g) => g.any_of)
      .filter((n) => n !== "shell" && n !== "bash");
    const missingOrdinary = missingTools(ordinary.tools, withoutShell);
    assert.equal(missingOrdinary.length, role === "apply" ? 1 : 0);
    const required = { required_skills: [Skill.ID.make("abra-browser")] };
    await assert.rejects(
      run(resolveSkills(role, "lightweight-fix", required, defaults, "/foreign")),
      /abra-browser.*required_skills/,
    );
    const { tools, skills } = await run(
      resolveSkills(
        role,
        "lightweight-fix",
        required,
        [
          ...defaults,
          {
            id: Skill.ID.make("abra-browser"),
            name: Skill.Name.make("abra-browser"),
            path: Id.AbsolutePath.make("/central/browser/SKILL.md"),
            content: "Browse",
          },
        ],
        "/foreign",
      ),
    );
    assert.deepEqual(
      skills.map((s) => s.id),
      [...defaults.map((s) => s.id), "abra-browser"],
    );
    const missing = missingTools(
      tools,
      tools.flatMap((g) => g.any_of).filter((n) => n !== "shell" && n !== "bash"),
    );
    assert.ok(missing.some((g) => g.any_of.includes(Id.ToolName.make("shell"))));
  }
});
