import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Deferred, Effect, Exit, Layer, Logger, Schema, Scope, Stream } from "effect";
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin";
import type { Skill } from "@opencode/schema/skill";
import { Tool } from "@opencode/schema/tool";
import { customTool, Agents, makeAgent, makeCatalog } from "@abracode/agents";
import { AgentsLive, bundledSkills, sourcesLayer } from "@abracode/agents/bundled";
import { OpenCodeAgentsLive } from "@abracode/agents/native";
import { monitor } from "../../src/recovery/monitor.ts";
import { NoMistakes } from "../../src/validation/no-mistakes.ts";
import { Onboarding } from "../../src/config/onboard.ts";
import { findSupervisor } from "../../src/opencode/supervisor.ts";
import { installGuards, requireOwnedPromptEffect } from "../../src/opencode/guards.ts";
import { CrewError, type Execution } from "../../src/domain.ts";
import type { Controller } from "../../src/workflow/controller.ts";
import type { Scheduler } from "../../src/scheduler/scheduler.ts";
import type { Runner } from "../../src/process.ts";
import type { OpenCodeClient } from "@opencode/client/effect";
import * as Id from "@abracode/contracts/identities";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
import { goal as workGoal } from "../helpers/work-goal.ts";

const dependencies = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, sourcesLayer());

test("OpenCodeAgentsLive does not leak central-only skills into worker locations and avoids double authorization", async () => {
  const registeredSkills = (central: boolean) =>
    Effect.scoped(
      Effect.gen(function* () {
        const skills = new Set<string>();
        const toolHooks: string[] = [];
        const registeredTools = new Map<string, Tool.Info>();
        let authorizeCalls = 0;

        const custom = customTool({
          id: "inspect-wave1",
          revision: "1",
          description: "Inspect value",
          action: "read",
          input: Schema.Struct({ ok: Schema.Boolean }),
          output: Schema.Struct({ ok: Schema.Boolean }),
          run: (input) => Effect.succeed(input),
        });
        const specialist = yield* makeAgent<never>({
          id: "wave1-specialist",
          revision: "1",
          description: "Wave 1 specialist",
          mode: "subagent",
          roles: ["review"],
          instructions: [{ inline: "Specialist instructions" }],
          skills: [{ name: "browser" }],
          customTools: [custom],
        });
        const bundled = yield* Agents;
        const allDefs = yield* bundled.list;
        const baseServices = yield* Effect.forEach(allDefs, (d) => bundled.get(d.id));
        const catalog = yield* makeCatalog([...baseServices, specialist]);

        const ctx = {
          skill: {
            transform: (fn: (editor: { add: (skill: Skill.Info) => void }) => void) =>
              Effect.sync(() =>
                fn({
                  add: (skill) => {
                    skills.add(skill.id);
                  },
                }),
              ),
          },
          agent: {
            transform: () => Effect.void,
            reload: () => Effect.void,
          },
          tool: {
            list: () => Effect.succeed([]),
            transform: (
              fn: (editor: {
                get: (id: string) => Tool.Info | undefined;
                add: (tool: Tool.Info) => void;
              }) => void,
            ) =>
              Effect.sync(() =>
                fn({
                  get: (id) => registeredTools.get(id),
                  add: (tool) => {
                    registeredTools.set(tool.name, tool);
                  },
                }),
              ),
            hook: (name: string) =>
              Effect.sync(() => {
                toolHooks.push(name);
              }),
          },
        } as unknown as PluginContext;

        yield* Layer.build(
          OpenCodeAgentsLive(ctx, {
            central,
            skills: bundledSkills,
            profiles: [],
            authorize: () =>
              Effect.sync(() => {
                authorizeCalls++;
              }),
          }).pipe(Layer.provide(Layer.succeed(Agents, catalog))),
        );

        const handler = registeredTools.get("inspect-wave1");
        assert.ok(handler);
        yield* handler.execute({ ok: true }, {} as Tool.Context);
        assert.equal(authorizeCalls, 1);
        assert.deepEqual(toolHooks, []);
        return skills;
      }),
    ).pipe(Effect.provide(AgentsLive.pipe(Layer.provideMerge(dependencies))));

  const workerSkills = await run(registeredSkills(false));
  for (const centralOnly of [
    "abra-thoughts",
    "abra-orchestration",
    "abra-project-onboarding",
    "abra-recovery",
    "abra-express",
  ])
    assert.equal(
      workerSkills.has(centralOnly),
      false,
      `Worker location must not register central-only skill ${centralOnly}`,
    );
  assert.ok(workerSkills.has("abra-browser"));
  assert.ok(workerSkills.has("abra-memory"));

  const centralSkills = await run(registeredSkills(true));
  for (const centralOnly of [
    "abra-thoughts",
    "abra-orchestration",
    "abra-project-onboarding",
    "abra-recovery",
    "abra-express",
  ])
    assert.equal(
      centralSkills.has(centralOnly),
      true,
      `Central location must register ${centralOnly}`,
    );
});

test("custom tool preserves underlying Tool.Error message and AGENT_TOOL metadata", async () => {
  const contribution = customTool({
    id: "diagnostic-tool",
    revision: "1",
    description: "Failing read tool",
    action: "read",
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    run: () =>
      Effect.fail(
        new Tool.Error({
          message: "Missing repository manifest at root",
          metadata: { reason: "NO_MANIFEST" },
        }),
      ),
  });
  let registered: Tool.Info | undefined;
  contribution.register(
    {
      add: (tool) => {
        registered = tool;
      },
    } as import("@opencode/plugin/effect/tool").ToolEditor,
    () => Effect.void,
  );
  assert.ok(registered);
  const exit = await run(Effect.exit(registered.execute({}, {} as Tool.Context)));
  assert.ok(Exit.isFailure(exit));
  const failure = await run(Effect.flip(registered.execute({}, {} as Tool.Context)));
  assert.ok(failure instanceof Tool.Error);
  assert.match(failure.message, /Missing repository manifest at root/);
  assert.match(failure.message, /Custom tool diagnostic-tool failed/);
  assert.equal(failure.metadata?.code, "AGENT_TOOL");
  assert.equal(failure.metadata?.reason, "NO_MANIFEST");
});

test("monitor scope interruption exits cleanly without logging event errors or hanging", async () => {
  const loggedErrors: string[] = [];
  const logger = Logger.make((entry) => {
    if (entry.logLevel === "Error") loggedErrors.push(String(entry.message));
  });
  const subscribed = Deferred.makeUnsafe<void>();

  const ctx = {
    event: {
      subscribe: () =>
        Stream.unwrap(Deferred.succeed(subscribed, undefined).pipe(Effect.as(Stream.never))),
    },
  } as unknown as PluginContext;
  const controller = {
    queries: {
      settings: { reconcileInterval: 60_000, home: Id.AbsolutePath.make("/tmp/abra-home") },
      executions: () => Effect.succeed([]),
      supervisor: () => Effect.undefined,
    },
    reconcile: () => Effect.void,
    reconcileReports: () => Effect.void,
    supervise: () => Effect.void,
  } as unknown as Controller;
  const scheduler = {
    tick: () => Effect.succeed([]),
  } as unknown as Scheduler;

  await run(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* monitor(ctx, controller, scheduler).pipe(Effect.provideService(Scope.Scope, scope));
      yield* Deferred.await(subscribed);
      yield* Scope.close(scope, Exit.void).pipe(Effect.timeout("2 seconds"));
    }).pipe(Effect.provide(Logger.layer([logger]))),
  );
  assert.deepEqual(loggedErrors, []);
});

test("NoMistakes call and Onboarding inspect fail inside Effect instead of throwing synchronously", async () => {
  const runner: Runner = {
    run: () => Effect.succeed(""),
  };
  const nm = new NoMistakes(runner);
  const executionWithoutWorktree = {
    effective_policy: {},
  } as unknown as Execution;

  let effect: Effect.Effect<string, CrewError> | undefined;
  assert.doesNotThrow(() => {
    effect = nm.setup(executionWithoutWorktree);
  });
  assert.ok(effect);
  const error = await run(Effect.flip(effect));
  assert.ok(error instanceof CrewError);
  assert.equal(error.code, "WORKTREE");

  const onboarding = new Onboarding(
    {} as never,
    {} as never,
    runner,
    Id.Executable.make("openspec"),
    undefined,
    {
      with: (_key, action) => action(),
    },
  );
  let inspectEffect: ReturnType<Onboarding["inspect"]> | undefined;
  assert.doesNotThrow(() => {
    inspectEffect = onboarding.inspect({ id: "../invalid" as Id.RepositoryId });
  });
  assert.ok(inspectEffect);
  const inspectError = await run(Effect.flip(inspectEffect));
  assert.ok(inspectError instanceof CrewError);
});

test("findSupervisor omits order when paginating with a cursor", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const home = Id.AbsolutePath.make("/tmp/abra-home");
  const client = {
    session: {
      list: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          calls.push(input);
          if (!input.cursor) return { data: [], cursor: { next: "page-2" } };
          return {
            data: [{ id: "ses_abra", metadata: { abracode_supervisor_home: home } }],
            cursor: { next: null },
          };
        }),
    },
  } as unknown as OpenCodeClient;

  const found = await run(findSupervisor(client, home));
  assert.equal(found?.id, "ses_abra");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.order, "asc");
  assert.equal("cursor" in calls[0]!, false);
  assert.equal(calls[1]?.cursor, "page-2");
  assert.equal("order" in calls[1]!, false);
});

test("execute.before guard enforces memory_reads policy and requireOwnedPromptEffect returns typed CrewError", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id } = await run(f.work.create(workGoal("memory-guard-check")));
  const execution = await run(f.controller.start(id));

  const badPrompt = await run(
    Effect.flip(
      requireOwnedPromptEffect(
        execution,
        execution.explore_session_id!,
        Id.MessageId.make("msg_unowned"),
      ),
    ),
  );
  assert.equal(badPrompt.code, "WORKER_PROMPT_ONLY");

  let beforeHook: ((event: Record<string, unknown>) => Effect.Effect<void, Tool.Error>) | undefined;
  const ctx = {
    session: { hook: () => Effect.void },
    permission: { hook: () => Effect.void },
    shell: { hook: () => Effect.void },
    tool: {
      hook: (
        name: string,
        fn: (event: Record<string, unknown>) => Effect.Effect<void, Tool.Error>,
      ) =>
        Effect.sync(() => {
          if (name === "execute.before") beforeHook = fn;
        }),
    },
  } as unknown as PluginContext;
  await run(installGuards(ctx, f.controller));
  assert.ok(beforeHook);

  const denied = await run(
    Effect.flip(
      beforeHook({
        sessionID: execution.explore_session_id!,
        agent: "explore",
        tool: "memory_search",
        input: {},
      }),
    ),
  );
  assert.ok(denied instanceof Tool.Error);
  assert.match(denied.message, /explore cannot use memory_search/);
});
