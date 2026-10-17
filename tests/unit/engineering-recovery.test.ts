import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { Agent, Model, Provider } from "@opencode/client/effect";
import { Skill } from "@opencode/schema/skill";
import { type Context } from "@opencode/plugin/effect/plugin";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { readWorkerContext } from "../../src/workflow/worker-context.ts";
import { type WorkerContext } from "../../src/workflow/worker-context-contracts.ts";
import { engineeringSkillIds } from "../../src/opencode/engineering-skills.ts";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

for (const admitted of [false, true]) {
  test(`native preflight preserves a pre-suite capture when ${admitted ? "admission response" : "submission"} was lost`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const issue = Id.IssueId.make("pre-suite");
    f.work.add(issue);
    const e = await run(f.controller.start(issue));
    const original = await run(readWorkerContext(f.records.store, e.worker_context_id!));
    const legacy: WorkerContext = {
      ...original,
      environment: {
        ...original.environment,
        skills: original.environment.skills.filter(
          (s) => !engineeringSkillIds("explore", "full-openspec").includes(s.id),
        ),
        tools: [
          ...original.environment.tools,
          { any_of: [Id.ToolName.make("list")], source: "workers.explore.required_tools" },
        ],
      },
    };
    await run(
      f.records.store.set(Id.StorageKey.make(`worker-context/${legacy.prompt_id}`), legacy),
    );
    let inventories = 0;
    const model = Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("fixture"));
    const inventory = legacy.environment.skills.map((s) => ({
      id: s.id,
      name: Skill.Name.make(s.id),
      path: s.path,
      content: "Changed installed content",
    }));
    const ctx = {
      storage: { get: (key: string) => f.records.store.get(Id.StorageKey.make(key)) },
    } as unknown as Context;
    const native = new NativeRuntime(ctx, f.config);
    const client = {
      session: {
        inbox: { list: () => Effect.succeed(admitted ? [{ id: legacy.prompt_id }] : []) },
        context: () => Effect.succeed([]),
      },
      plugin: {
        list: () => Effect.succeed({ data: [{ id: "abracode", state: { status: "active" } }] }),
      },
      agent: {
        list: () => Effect.succeed({ data: [Agent.Info.default(legacy.environment.agent)] }),
      },
      model: { list: () => Effect.succeed({ data: [model] }) },
      skill: {
        list: () =>
          Effect.sync(() => {
            inventories++;
            return { data: inventory };
          }),
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>;
    native.client = () => Effect.succeed(client);
    const resolved = await run(native.preflight(e, "explore", legacy.prompt_id));
    assert.equal(inventories, admitted ? 0 : 1);
    if (!admitted) {
      assert.deepEqual(resolved, legacy.environment);
      const corrupted = { ...legacy, policy: "old-permission-policy" };
      await run(
        f.records.store.set(Id.StorageKey.make(`worker-context/${legacy.prompt_id}`), corrupted),
      );
      await assert.rejects(
        run(native.preflight(e, "explore", legacy.prompt_id)),
        /Captured role policy is incompatible/,
      );
      await run(
        f.records.store.set(Id.StorageKey.make(`worker-context/${legacy.prompt_id}`), legacy),
      );
      await assert.rejects(
        run(native.preflight({ ...e, prompt_id: undefined }, "explore")),
        /required skill abra-codebase-design/,
      );
    }
    assert.deepEqual(await run(readWorkerContext(f.records.store, e.worker_context_id!)), legacy);
    assert.equal(legacy.prompt_id, original.prompt_id);
    assert.equal(legacy.prompt, original.prompt);
  });
}
