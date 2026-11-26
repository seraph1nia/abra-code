import { goal as workGoal } from "../helpers/work-goal.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Exit, Layer, Schema, Deferred, Fiber } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { AgentDefinitionError, Agents, makeAgent, makeCatalog, customTool } from "@abracode/agents";
import { Tool } from "@opencode/schema/tool";
import { contributionAuthorization } from "../../src/opencode/agent-contributions.ts";
import {
  workerToolAllowed,
  workerPermissions,
  contributionAllows,
  definitionAllows,
} from "@abracode/agents/policy";
import { definitions, sourcesLayer, bundledSkills } from "@abracode/agents/bundled";
import { ConfigurationSnapshotSchema, workerProfile } from "../../src/config/snapshot.ts";
import { WorkerContextSchema } from "../../src/workflow/worker-context-contracts.ts";
import { readWorkerContext, WorkerContexts } from "../../src/workflow/worker-context.ts";
import { retainedExecution } from "../helpers/retained-execution.ts";
import { Capacity } from "../../src/workflow/capacity.ts";
import { fixtureConfig, fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
import { join } from "node:path";
import { writeFile } from "../../src/filesystem.ts";
import type { AgentDefinition } from "@abracode/agents";
import { CrewError } from "../../src/domain.ts";
const specialistTool = customTool({
  id: "inspect-assignment",
  revision: "1",
  description: "Read-only assignment inspection",
  action: "read",
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.Struct({ value: Schema.String }),
  run: (input) => Effect.succeed(input),
});

const catalog = (
  assets: string,
  context: NonNullable<AgentDefinition["context"]>,
  denials: readonly string[] = [],
  additional: readonly AgentDefinition[] = [],
) =>
  Effect.gen(function* () {
    const agents = yield* Effect.forEach(
      [
        ...definitions,
        {
          ...definitions[1],
          customTools: [specialistTool],
          deny: denials,
          skills: [{ name: "browser" }, { name: "verification", preload: true }],
          id: "specialist",
          revision: "fixture-1",
          context,
        },
        ...additional,
      ],
      (definition) => makeAgent(definition),
    );
    return yield* makeCatalog(agents);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, sourcesLayer(bundledSkills, assets)),
    ),
  );

test("new selections capture static definitions before providers; prepared evidence precedes admission and requests never rerun providers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let providers = 0;
  const agents = await run(
    catalog(join(f.root, "packages/agents/assets"), (input) =>
      Effect.sync(() => {
        providers++;
        return [{ name: "assignment", content: `Captured assignment ${input.task.id}` }];
      }),
    ),
  );
  f.config.workers.explore = { definition: "specialist", model: f.config.models.default };
  const withAgents = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Agents, agents)));
  const { id: issue } = await run(f.work.create(workGoal("prepared-once")));
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (session, text, id) =>
    Effect.gen(function* () {
      const execution = (yield* f.records.execution(issue))!;
      assert.equal(execution.prompt_id, id);
      const captured = yield* readWorkerContext(f.records.store, id!);
      assert.equal(captured.schema_version, 2);
      assert.equal(captured.prompt, text);
      return yield* prompt(session, text, id);
    });
  const e = await withAgents(f.controller.start(issue));
  assert.equal(e.configuration_snapshot?.agent_selection_version, 1);
  assert.equal(providers, 1);
  const captured = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  assert.equal(captured.schema_version, 2);
  if (captured.schema_version !== 2) return;
  assert.equal(captured.prepared.profile.definition, "specialist");
  const authorize = contributionAuthorization(
    (session) => f.controller.queries.assignment(session),
    f.records.store,
    (session, message) => f.runtime.promptOrigin(session, message),
  );
  const native = {
    sessionID: e.explore_session_id!,
    agent: captured.environment.agent,
    messageID: Id.MessageId.make("msg_specialist_call"),
    id: Tool.CallID.make("call_specialist"),
  };
  f.runtime.origins.set(native.messageID, e.prompt_id!);
  assert.equal(workerToolAllowed("explore", captured.prepared.profile, specialistTool.id), true);
  assert.ok(
    workerPermissions("explore", captured.prepared.profile, "assigned", []).some(
      (rule) => rule.action === specialistTool.action && rule.effect === "allow",
    ),
  );
  await run(authorize(specialistTool, native));
  await assert.rejects(run(authorize({ ...specialistTool, revision: "wrong" }, native)));
  await assert.rejects(
    run(authorize(specialistTool, { ...native, agent: Id.AgentId.make("wrong") })),
  );
  await assert.rejects(
    run(authorize(specialistTool, { ...native, sessionID: Id.SessionId.make("ses_wrong") })),
  );
  const wrongRole = contributionAuthorization(
    () => Effect.succeed({ ...e, active_role: "review" }),
    f.records.store,
    (session, message) => f.runtime.promptOrigin(session, message),
  );
  await assert.rejects(run(wrongRole(specialistTool, native)));
  const wrongGeneration = contributionAuthorization(
    () => Effect.succeed({ ...e, control_generation: e.control_generation + 1 }),
    f.records.store,
    (session, message) => f.runtime.promptOrigin(session, message),
  );
  await assert.rejects(run(wrongGeneration(specialistTool, native)));
  const staleCall = contributionAuthorization(
    (session) => f.controller.queries.assignment(session),
    f.records.store,
    () => Effect.succeed(Id.MessageId.make("msg_prior_assignment")),
  );
  await assert.rejects(run(staleCall(specialistTool, native)), /stale assignment/);
  assert.equal(captured.environment.agent, captured.prepared.profile.id);
  const names = captured.environment.tools.map((group) => group.any_of[0]);
  for (let i = 0; i < 2; i++)
    assert.equal(
      await withAgents(
        f.controller.workerContextRequest(
          e,
          "explore",
          e.explore_session_id!,
          captured.environment.model,
          names,
        ),
      ),
      `Captured assignment ${issue}`,
    );
  assert.equal(providers, 1);
  await run(writeFile(join(f.root, "packages/agents/assets/explore.md"), "Edited after capture"));
  f.config.workers.explore = {
    definition: "explore",
    agent: Id.AgentId.make("changed-native"),
    model: f.config.models.default,
  };
  await withAgents(f.controller.reconcile(issue));
  assert.equal(providers, 1);
  assert.equal(f.runtime.prompts, 1);
  assert.deepEqual(await run(readWorkerContext(f.records.store, e.worker_context_id!)), captured);
  assert.throws(() =>
    Schema.decodeSync(WorkerContextSchema)({
      ...captured,
      prepared: { ...captured.prepared, fragments: [{ name: "assignment", content: "tampered" }] },
    }),
  );
  const summary = (await run(f.controller.diagnostics(issue, "explore"))).contexts[0];
  assert.equal(summary.definition, "specialist");
  assert.equal(summary.profile_revision, captured.prepared.profile.revision);
  assert.ok(!JSON.stringify(summary).includes("Captured assignment"));
});

test("external native override retains managed guidance and fragments; legacy snapshots do not adopt package profiles", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const agents = await run(
    catalog(join(f.root, "packages/agents/assets"), () =>
      Effect.succeed([{ name: "extra", content: "managed fragment" }]),
    ),
  );
  f.config.workers.explore = {
    definition: "specialist",
    agent: Id.AgentId.make("external"),
    model: f.config.models.default,
  };
  const { id: issue } = await run(f.work.create(workGoal("external-prepared")));
  const e = await run(f.controller.start(issue).pipe(Effect.provideService(Agents, agents)));
  const context = await run(readWorkerContext(f.records.store, e.worker_context_id!));
  assert.equal(context.schema_version, 2);
  if (context.schema_version !== 2) return;
  assert.equal(context.environment.agent, "external");
  const guidance = await run(
    f.controller.workerContextRequest(
      e,
      "explore",
      e.explore_session_id!,
      context.environment.model,
      context.environment.tools.map((g) => g.any_of[0]),
    ),
  );
  assert.equal(guidance, context.guidance.content + "\n\nmanaged fragment");
  const legacy = Schema.decodeSync(ConfigurationSnapshotSchema)({
    digest: "original",
    supervisor: f.config.models.default,
    workers: { explore: { model: f.config.models.default } },
  });
  assert.equal(legacy.agent_selection_version, undefined);
  assert.equal(
    workerProfile({ ...e, configuration_snapshot: legacy }, "explore", f.config)?.agent,
    undefined,
  );
  assert.equal(
    workerProfile({ ...e, configuration_snapshot: undefined }, "explore", {
      workers: {
        explore: { agent: Id.AgentId.make("must-not-adopt-current"), definition: "specialist" },
      },
    })?.agent,
    undefined,
  );
});

test("catalog-dependent unknown/incompatible selections fail before native admission without running unassigned providers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let providers = 0;
  const agents = await run(
    catalog(join(f.root, "packages/agents/assets"), () =>
      Effect.sync(() => {
        providers++;
        return [];
      }),
    ),
  );
  for (const [definition, code] of [
    ["unknown-definition", "UNKNOWN_DEFINITION"],
    ["review", "INCOMPATIBLE_ROLE"],
  ]) {
    f.config.workers.apply = { definition };
    const { id: issue } = await run(f.work.create(workGoal(`selection-${definition}`)));
    const result = await run(
      f.controller.start(issue).pipe(Effect.provideService(Agents, agents), Effect.result),
    );
    assert.equal(result._tag, "Failure", "Expected admission errors remain typed, not defects");
    if (result._tag !== "Failure") assert.fail("Expected typed admission failure");
    assert.ok(result.failure instanceof CrewError);
    assert.equal(result.failure.code, code);
    assert.match(result.failure.message, /workers.apply.definition/);
  }
  assert.equal(providers, 0);
  assert.equal(f.runtime.creates, 0);
  assert.equal(f.runtime.prompts, 0);
});

test("unreadable captured instruction sources fail as typed admission diagnostics before sessions or providers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let providers = 0;
  const agents = await run(
    catalog(
      join(f.root, "packages/agents/assets"),
      () =>
        Effect.sync(() => {
          providers++;
          return [];
        }),
      [],
      [{ ...definitions[1], id: "unreadable", instructions: [{ file: "missing.md" }] }],
    ),
  );
  f.config.workers.explore = { definition: "unreadable" };
  const { id: issue } = await run(f.work.create(workGoal("unreadable-selection")));
  const result = await run(
    f.controller.start(issue).pipe(Effect.provideService(Agents, agents), Effect.result),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag !== "Failure") assert.fail("Expected typed source failure");
  assert.ok(result.failure instanceof CrewError);
  assert.equal(result.failure.code, "SOURCE");
  assert.match(
    result.failure.message,
    /workers.explore.definition: Cannot read instruction source/,
  );
  assert.equal(f.runtime.creates, 0);
  assert.equal(f.runtime.prompts, 0);
  assert.equal(providers, 0);
});

for (const denial of ["inspect-assignment", "inspect-*", "read*", "*"])
  test(`direct contribution handler respects authored ${denial} denial, independently of native hooks`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const agents = await run(
      catalog(join(f.root, "packages/agents/assets"), () => Effect.succeed([]), [denial]),
    );
    f.config.workers.explore = { definition: "specialist", model: f.config.models.default };
    const { id: issue } = await run(f.work.create(workGoal("denied-contribution")));
    const e = await run(f.controller.start(issue).pipe(Effect.provideService(Agents, agents)));
    const context = await run(readWorkerContext(f.records.store, e.worker_context_id!));
    assert.equal(context.schema_version, 2);
    if (context.schema_version !== 2) return;
    assert.equal(workerToolAllowed("explore", context.prepared.profile, specialistTool.id), false);
    assert.ok(
      workerPermissions("explore", context.prepared.profile, "assigned", []).some(
        (rule) => rule.effect === "deny" && rule.action === denial,
      ),
    );
    assert.equal(contributionAllows(context.prepared.profile, "explore", specialistTool.id), false);
    if (denial !== "read*")
      assert.equal(definitionAllows(context.prepared.profile, specialistTool.id), false);
    let handler: Tool.Info | undefined;
    specialistTool.register(
      {
        add: (tool) => {
          handler = tool;
        },
      } as import("@opencode/plugin/effect/tool").ToolEditor,
      contributionAuthorization(
        (session) => f.controller.queries.assignment(session),
        f.records.store,
        () => Effect.succeed(e.prompt_id),
      ),
    );
    assert.ok(handler);
    const native = {
      sessionID: e.explore_session_id!,
      agent: context.environment.agent,
      messageID: Id.MessageId.make("msg_denied"),
      id: Tool.CallID.make("denied"),
    } as Tool.Context;
    await assert.rejects(run(handler.execute({ value: "must-not-run" }, native)), /Custom tool/);
  });

test("interrupted preparation keeps its receipt unadmitted, releases capacity and blocks automatic provider replay", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let providers = 0,
    cleaned = false;
  const agents = await run(
    catalog(join(f.root, "packages/agents/assets"), () =>
      Effect.scoped(
        Effect.gen(function* () {
          providers++;
          if (providers > 1) return [];
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleaned = true;
            }),
          );
          return yield* Effect.interrupt;
        }),
      ),
    ),
  );
  f.config.workers.explore = { definition: "specialist", model: f.config.models.default };
  const { id: issue } = await run(f.work.create(workGoal("interrupted-preparation")));
  const interrupted = await run(
    Effect.exit(f.controller.start(issue).pipe(Effect.provideService(Agents, agents))),
  );
  assert.ok(Exit.isFailure(interrupted));
  assert.ok(cleaned);
  let e = await run(f.controller.get(issue));
  assert.ok(e.session_intent?.prompt);
  const originalPrompt = e.session_intent.prompt;
  const diagnostics = await run(f.controller.diagnostics(issue, "explore"));
  assert.deepEqual(diagnostics.sessions, []);
  assert.equal(e.capacity_reservation, undefined);
  assert.equal(f.runtime.prompts, 0);
  assert.equal(f.runtime.creates, 0);
  await run(f.controller.reconcile(issue).pipe(Effect.provideService(Agents, agents)));
  assert.equal(providers, 1);
  assert.equal(f.runtime.prompts, 0);
  e = await run(f.controller.get(issue));
  assert.match(e.error_or_recovery_reason ?? "", /preparation started/i);
  await run(f.controller.control(issue, "pause"));
  assert.equal((await run(f.controller.get(issue))).session_intent, undefined);
  const resumed = await run(
    f.controller.control(issue, "resume").pipe(Effect.provideService(Agents, agents)),
  );
  assert.notEqual(resumed.prompt_id, originalPrompt);
  assert.equal(providers, 2);
  assert.equal(f.runtime.prompts, 1);
  assert.ok(
    await run(f.records.store.get(Id.StorageKey.make(`agent-preparation/${originalPrompt}`))),
  );
});

test("superseded cleanup cannot release a replacement or uncertain admission", async () => {
  let { execution, records } = await retainedExecution({
    capacity_reservation: { role: "explore", generation: 0, status: "preparing" },
  });
  const capacity = new Capacity(await run(fixtureConfig("/fixture")), records);
  const stale = structuredClone(execution);
  execution = await run(records.commitControl(execution));
  await assert.rejects(run(capacity.releasePreparation(stale, "explore")), /superseded/);
  execution = {
    ...execution,
    capacity_reservation: {
      role: "explore",
      generation: execution.control_generation,
      status: "uncertain",
    },
  };
  execution = await run(records.saveOwned(execution, ["capacity_reservation"]));
  await assert.rejects(run(capacity.releasePreparation(execution, "explore")), /superseded/);
  assert.deepEqual(
    (await run(records.execution(execution.issue_id)))!.capacity_reservation,
    execution.capacity_reservation,
  );
});

for (const stage of ["provider", "preflight"] as const) {
  test(`${stage} failure releases only the preparing worker's capacity and preserves independent evidence`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const issue = Id.IssueId.make("release-capacity");
    const fail = () =>
      f.records
        .update(issue, (e) => ({ ...e, retry_instructions: "Independent evidence" }))
        .pipe(
          Effect.andThen(
            Effect.fail(new CrewError("TEST_FAILURE", "Admission preparation failed")),
          ),
        );
    const agents = await run(
      catalog(join(f.root, "packages/agents/assets"), () =>
        stage === "provider"
          ? fail().pipe(
              Effect.mapError(
                (error) =>
                  new AgentDefinitionError({
                    definition: "specialist",
                    code: error.code,
                    message: error.message,
                  }),
              ),
            )
          : Effect.succeed([]),
      ),
    );
    if (stage === "preflight") f.runtime.preflight = fail;
    f.config.workers.explore = { definition: "specialist", model: f.config.models.default };
    f.seed.named(issue);
    await assert.rejects(
      run(f.controller.start(issue).pipe(Effect.provideService(Agents, agents))),
    );
    const saved = await run(f.controller.get(issue));
    assert.equal(saved.capacity_reservation, undefined);
    assert.equal(saved.capacity_observed_idle, true);
    assert.equal(saved.retry_instructions, "Independent evidence");
    assert.equal(f.runtime.creates, 0);
  });
}

test("concurrent preparation claims one durable receipt and never invokes its provider twice", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id: issue } = await run(f.work.create(workGoal("concurrent-preparation")));
  const e = await run(f.controller.start(issue));
  const entered = Deferred.makeUnsafe<void>(),
    release = Deferred.makeUnsafe<void>();
  let providers = 0;
  const agents = await run(
    catalog(join(f.root, "packages/agents/assets"), () =>
      Effect.gen(function* () {
        providers++;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return [{ name: "once", content: "retained" }];
      }),
    ),
  );
  const profile = await run(
    agents.get("specialist").pipe(Effect.flatMap((agent) => agent.resolve("explore"))),
  );
  const prompt = Id.MessageId.make("msg_concurrent_preparation");
  const prospective = {
    ...e,
    configuration_snapshot: {
      ...e.configuration_snapshot!,
      agent_selection_version: 1 as const,
      definitions: { explore: profile },
    },
    session_intent: { role: "explore" as const, id: e.explore_session_id!, prompt },
  };
  const contexts = new WorkerContexts(f.records, f.config);
  const preparation = contexts.prepareAgent(
    prospective,
    "explore",
    await run(f.work.show(issue)),
    prompt,
  );
  assert.equal((await Effect.runPromise(Effect.flip(preparation))).code, "AGENTS_UNAVAILABLE");
  assert.equal(
    await run(f.records.store.get(Id.StorageKey.make(`agent-preparation/${prompt}`))),
    undefined,
  );
  assert.equal(providers, 0);
  const prepare = preparation.pipe(Effect.provideService(Agents, agents));
  await run(
    Effect.gen(function* () {
      const first = yield* prepare.pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      assert.ok(Exit.isFailure(yield* Effect.exit(prepare)));
      yield* Deferred.succeed(release, undefined);
      const captured = yield* Fiber.join(first);
      assert.deepEqual(yield* prepare, captured);
    }),
  );
  assert.deepEqual(await Effect.runPromise(preparation), await run(prepare));
  const key = Id.StorageKey.make(`agent-preparation/${prompt}`);
  const binding = {
    execution: e.execution_id,
    generation: e.control_generation,
    role: "explore",
    session: prospective.session_intent.id,
    prompt,
  };
  for (const [receipt, expected] of [
    [{ ...binding, stage: "complete" }, "INVALID_DATA"],
    [{ ...binding, generation: -1, stage: "started" }, "INVALID_DATA"],
    [{ ...binding, role: "review", stage: "started" }, "PREPARATION_ASSIGNMENT"],
    [{ ...binding, stage: "started" }, "PREPARATION_UNCERTAIN"],
  ] as const) {
    await run(f.records.store.set(key, receipt));
    assert.equal((await run(Effect.flip(prepare))).code, expected);
    assert.deepEqual(await run(f.records.store.get(key)), receipt);
  }
  assert.equal(providers, 1);
  assert.equal(f.runtime.prompts, 1, "preparation itself never admits a new prompt");
});

test("configured admission resolves its catalog at assembly even without an ambient override", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id } = await run(f.work.create(workGoal("assembled-catalog")));
  // Preparation needs an ambient catalog for its provider; selection was captured at admission.
  await Effect.runPromiseExit(f.controller.start(id));
  const e = await run(f.records.execution(id));
  assert.ok(e?.configuration_snapshot?.definitions?.explore);
});
