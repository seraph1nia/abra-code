import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Cause, Context, Effect, Exit, FileSystem, Layer, Path, Schema, Scope } from "effect";
import { Model } from "@opencode/schema/model";
import { Provider } from "@opencode/schema/provider";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import {
  Agents,
  AgentSources,
  makeAgent,
  makeCatalog,
  customTool,
  AgentDefinitionError,
  type AgentDefinition,
  type PrepareAgentInput,
  CapturedProfile,
  profileRevision,
} from "../../src/index.ts";
import { AgentsLive, sourcesLayer, bundledAssets, bundledSkills } from "../../src/bundled.ts";
import { validProfile } from "../../src/contracts.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const dependencies = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, sourcesLayer());
const run = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | AgentSources | Scope.Scope>,
) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(dependencies))));
const input: PrepareAgentInput = {
  role: "review",
  workflow: "full-openspec",
  task: { id: "one", title: "Example", description: "private task facts" },
  repository: { id: "repo", directory: "/owned", base: "abc" },
};
test("public catalog constructs six separate common-tag contexts with owned guidance and native policy", async () => {
  await run(
    Effect.gen(function* () {
      const context = yield* Layer.build(AgentsLive);
      const catalog = Context.get(context, Agents);
      const definitions = yield* catalog.list;
      assert.deepEqual(
        definitions.map((d) => d.id),
        ["abra", "explore", "apply", "review", "research", "project-lead"],
      );
      for (const definition of definitions) {
        const prepared = yield* catalog.prepare(definition.id, {
          ...input,
          role: definition.roles[0],
        });
        assert.ok(
          prepared.profile.system.startsWith(
            definition.id === "abra"
              ? "You are Abra"
              : definition.id === "project-lead"
                ? "You are a controller-managed"
                : `You are ${definition.id[0].toUpperCase()}${definition.id.slice(1)}`,
          ),
        );
        assert.ok(!prepared.profile.system.includes("---"));
        assert.ok(!prepared.profile.system.includes("private task facts"));
        assert.ok(validProfile(prepared.profile));
        if (definition.id === "abra") {
          assert.match(prepared.profile.system, /what deserves attention next.*abra-orchestration/);
          assert.ok(prepared.profile.skills.some((skill) => skill.id === "abra-orchestration"));
        }
        assert.ok(!prepared.profile.skills.some((skill) => skill.id === "abra-testing"));
        assert.equal(prepared.profile.mode, definition.id === "abra" ? "primary" : "subagent");
        if (definition.id === "review")
          assert.ok(
            !prepared.profile.permissions.some((p) => p.action === "edit" && p.effect === "allow"),
          );
        if (definition.id === "apply")
          assert.ok(
            prepared.profile.permissions.some((p) => p.action === "edit" && p.resource === "**"),
          );
      }
      const missing = yield* Effect.result(catalog.get("unknown"));
      assert.equal(missing._tag, "Failure");
      const review = yield* catalog.get("review");
      assert.ok(Exit.isFailure(yield* Effect.exit(makeCatalog([review, review]))));
    }),
  );
});
test("seventh specialist uses typed custom tool, injected provider, available and preload skills without a new role", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-skill-fixture-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const skills = join(root, "skills");
  await cp(bundledSkills, skills, { recursive: true });
  await mkdir(join(skills, "preload-fixture"));
  await writeFile(
    join(skills, "preload-fixture/SKILL.md"),
    "---\nname: preload-fixture\ndescription: Test preloading\n---\nFixture preload instructions.\n",
  );
  class Counter extends Context.Service<Counter, { next: Effect.Effect<number> }>()(
    "test/Counter",
  ) {}
  let count = 0;
  const definition: AgentDefinition<Counter> = {
    id: "specialist",
    revision: "one",
    description: "Read-only specialist",
    mode: "subagent",
    roles: ["review"],
    instructions: [{ inline: "First" }, { file: "review.md" }, { inline: "Last" }],
    skills: [{ name: "browser" }, { name: "preload-fixture", preload: true }],
    customTools: [
      customTool({
        id: "inspect-specialist",
        revision: "1",
        description: "Inspect a value",
        action: "read",
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
        run: (input) => Effect.succeed({ value: input.value }),
      }),
    ],
    context: (facts) =>
      Effect.gen(function* () {
        assert.ok(
          Object.isFrozen(facts) &&
            Object.isFrozen(facts.task) &&
            Object.isFrozen(facts.repository),
        );
        const counter = yield* Counter;
        return [{ name: "task-facts", content: `${facts.task.id}:${yield* counter.next}` }];
      }),
  };
  await run(
    Effect.gen(function* () {
      const agent = yield* makeAgent(definition).pipe(
        Effect.provideService(Counter, { next: Effect.sync(() => ++count) }),
      );
      const catalog = yield* makeCatalog([agent]);
      const prepared = yield* catalog.prepare("specialist", input);
      assert.equal(count, 1);
      assert.deepEqual(prepared.fragments, [{ name: "task-facts", content: "one:1" }]);
      assert.ok(prepared.profile.system.startsWith("First\n\nYou are Review"));
      assert.ok(prepared.profile.system.includes("Last"));
      assert.ok(prepared.profile.system.includes("Fixture preload instructions."));
      assert.ok(!prepared.profile.system.includes("Use agent-browser for browser interaction"));
      assert.deepEqual(
        prepared.profile.skills.map((s) => [s.id, s.preload]),
        [
          ["abra-browser", false],
          ["abra-preload-fixture", true],
        ],
      );
      assert.deepEqual(prepared.profile.contributions, [
        {
          id: "inspect-specialist",
          revision: "1",
          action: "read",
          schema_digest: definition.customTools![0].schema_digest,
        },
      ]);
      const next = yield* agent.prepare({
        ...input,
        task: { ...input.task, id: "two" },
        configuredModel: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("fixture") },
      });
      assert.equal(next.profile.id, prepared.profile.id);
      const tool = definition.customTools![0];
      let registered: import("@opencode/schema/tool").Tool.Info | undefined;
      tool.register(
        {
          add: (t) => {
            registered = t;
          },
        } as import("@opencode/plugin/effect/tool").ToolEditor,
        () => Effect.void,
      );
      assert.ok(registered);
      const result = yield* registered.execute(
        { value: "typed" },
        {} as import("@opencode/schema/tool").Tool.Context,
      );
      assert.deepEqual(result.output, { value: "typed" });
      const bad = yield* Effect.exit(agent.prepare({ ...input, role: "apply" }));
      assert.ok(Exit.isFailure(bad));
    }).pipe(Effect.provide(sourcesLayer(skills))),
  );
});
test("injected source failures, duplicate fragments and incompatible captures fail closed; interruption keeps cleanup", async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const definition: AgentDefinition = {
        id: "fixture",
        revision: "1",
        description: "fixture",
        mode: "subagent",
        roles: ["review"],
        instructions: [{ file: "review.md" }],
      };
      const agent = yield* makeAgent(definition).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: () => Effect.fail({} as never),
        }),
      );
      const failed = yield* Effect.exit(agent.prepare(input));
      assert.ok(Exit.isFailure(failed));
      const duplicate = yield* makeAgent({
        ...definition,
        instructions: [{ inline: "fixture" }],
        context: () =>
          Effect.succeed([
            { name: "same", content: "a" },
            { name: "same", content: "b" },
          ]),
      });
      assert.ok(Exit.isFailure(yield* Effect.exit(duplicate.prepare(input))));
      const good = yield* makeAgent({ ...definition, instructions: [{ inline: "original" }] });
      const prepared = yield* good.prepare(input);
      const changed = yield* makeAgent({ ...definition, instructions: [{ inline: "changed" }] });
      assert.notEqual((yield* changed.prepare(input)).profile.id, prepared.profile.id);
      assert.equal(
        (yield* changed.prepare({ ...input, captured: prepared.profile })).profile.system,
        "original",
      );
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            changed.prepare({ ...input, captured: { ...prepared.profile, system: "tampered" } }),
          ),
        ),
      );
      assert.ok(Exit.isFailure(yield* Effect.exit(makeAgent({ ...definition, id: "invalid id" }))));
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            makeAgent({
              ...definition,
              context: () =>
                Effect.fail(
                  new AgentDefinitionError({
                    code: "PROVIDER",
                    definition: "fixture",
                    message: "safe failure",
                  }),
                ),
            }).pipe(Effect.flatMap((a) => a.prepare(input))),
          ),
        ),
      );
    }),
  );
  let cleaned = false;
  const interrupted = await run(
    Effect.gen(function* () {
      const agent = yield* makeAgent({
        id: "interrupt",
        revision: "1",
        description: "interrupt",
        roles: ["review"],
        mode: "subagent",
        instructions: [{ inline: "test" }],
        context: () =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  cleaned = true;
                }),
              );
              return yield* Effect.interrupt;
            }),
          ),
      });
      return yield* Effect.exit(agent.prepare(input));
    }),
  );
  assert.ok(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause));
  assert.ok(cleaned);
  assert.ok(bundledAssets.endsWith("/packages/agents/assets"));
});

test("custom contributions reject reserved names, collisions, unsupported authority and invalid runtime contracts", async () => {
  const tool = customTool({
    id: "safe-inspection",
    revision: "1",
    description: "Read",
    action: "read",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
    run: (input) => Effect.succeed(input),
  });
  const base: AgentDefinition = {
    id: "fixture",
    revision: "1",
    description: "fixture",
    roles: ["review"],
    mode: "subagent",
    instructions: [{ inline: "Read only" }],
  };
  await run(
    Effect.gen(function* () {
      for (const tools of [
        [tool, tool],
        [{ ...tool, id: "abra-unsafe" }],
        [{ ...tool, id: "read" }],
        [{ ...tool, action: "shell" } as unknown as typeof tool],
        [{ ...tool, input: undefined } as unknown as typeof tool],
      ])
        assert.ok(Exit.isFailure(yield* Effect.exit(makeAgent({ ...base, customTools: tools }))));
      const forbidden = yield* makeAgent({ ...base, tools: ["abra_work_start"] });
      assert.ok(Exit.isFailure(yield* Effect.exit(forbidden.prepare(input))));
      const scoped = yield* makeAgent({ ...base, roles: ["project-lead"], customTools: [tool] });
      assert.ok(
        Exit.isFailure(yield* Effect.exit(scoped.prepare({ ...input, role: "project-lead" }))),
      );
    }),
  );
});

test("model preference is only a fallback and the preparation scope releases provider resources", async () => {
  let released = 0;
  await run(
    Effect.gen(function* () {
      const preferred = { providerID: Provider.ID.make("fixture"), id: Model.ID.make("preferred") };
      const configured = { providerID: Provider.ID.make("other"), id: Model.ID.make("configured") };
      const agent = yield* makeAgent({
        id: "scoped",
        revision: "1",
        description: "scoped",
        mode: "subagent",
        roles: ["review"],
        model: preferred,
        instructions: [{ inline: "Static" }],
        context: () =>
          Effect.acquireRelease(Effect.succeed("resource"), () =>
            Effect.sync(() => {
              released++;
            }),
          ).pipe(Effect.as([{ name: "resource", content: "prepared" }])),
      });
      assert.deepEqual((yield* agent.prepare(input)).model, preferred);
      assert.equal(released, 1);
      assert.deepEqual(
        (yield* agent.prepare({ ...input, configuredModel: configured })).model,
        configured,
      );
      assert.equal(released, 2);
    }),
  );
});

test("custom tool handlers validate the decoded side of transformed output codecs", async () => {
  await run(
    Effect.gen(function* () {
      for (const value of [42, "42"]) {
        const contribution = customTool({
          id: "codec-output-proof",
          revision: "1",
          description: "Read a number",
          action: "read",
          input: Schema.Struct({}),
          output: Schema.FiniteFromString,
          run: () => Effect.succeed(value as number),
        });
        let handler: import("@opencode/schema/tool").Tool.Info | undefined;
        contribution.register(
          {
            add: (tool) => {
              handler = tool;
            },
          } as import("@opencode/plugin/effect/tool").ToolEditor,
          () => Effect.void,
        );
        assert.ok(handler);
        const result = yield* Effect.exit(
          handler.execute({}, {} as import("@opencode/schema/tool").Tool.Context),
        );
        if (typeof value === "number") {
          assert.ok(Exit.isSuccess(result));
          assert.equal(result.value.output, 42);
          assert.equal(result.value.content, "42");
        } else assert.ok(Exit.isFailure(result));
      }
    }),
  );
});

test("relocated injected sources keep revision identity and captured permissions cannot exceed their role ceiling", async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const definition: AgentDefinition = {
        id: "relocatable",
        revision: "1",
        description: "relocatable",
        roles: ["review"],
        mode: "subagent",
        instructions: [{ file: "role.md" }],
        skills: [{ name: "browser" }],
      };
      const source = {
        ...fs,
        readFileString: (file: string) =>
          Effect.succeed(
            file.endsWith("SKILL.md")
              ? "---\ndescription: Relocatable skill\n---\nIdentical skill bytes"
              : "Identical source bytes",
          ),
      };
      const first = yield* makeAgent(definition).pipe(
        Effect.provideService(FileSystem.FileSystem, source),
        Effect.provideService(AgentSources, {
          assets: "/first/assets",
          skills: "/first/skills",
        }),
      );
      const second = yield* makeAgent(definition).pipe(
        Effect.provideService(FileSystem.FileSystem, source),
        Effect.provideService(AgentSources, {
          assets: "/relocated/assets",
          skills: "/relocated/skills",
        }),
      );
      const profile = yield* first.resolve("review");
      assert.equal((yield* second.resolve("review")).id, profile.id);
      const { id: _id, revision: _revision, ...original } = profile;
      const material = {
        ...original,
        permissions: [
          ...profile.permissions,
          { action: "abra_work_start", resource: "*", effect: "allow" as const },
        ],
      };
      const revision = profileRevision(material);
      assert.ok(
        !Schema.is(CapturedProfile)({ ...material, revision, id: `abra-relocatable-${revision}` }),
      );
    }),
  );
});

test("captured profiles retain removed skill selections without rereading current sources", async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const definition: AgentDefinition = {
        id: "retained",
        revision: "1",
        description: "retained profile",
        roles: ["review"],
        mode: "subagent",
        instructions: [{ inline: "Retained instructions" }],
        skills: [{ name: "testing", preload: true }],
      };
      const previous = yield* makeAgent(definition).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: () =>
            Effect.succeed("---\ndescription: Previous skill\n---\nRetained testing content"),
        }),
      );
      const captured = yield* previous.prepare(input);
      const current = yield* makeAgent({ ...definition, skills: [] }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: () => Effect.die("Captured skills must not be reconstructed"),
        }),
      );
      const fresh = yield* current.prepare(input);
      assert.notEqual(fresh.profile.id, captured.profile.id);
      assert.deepEqual(fresh.profile.skills, []);
      const restored = yield* current.prepare({ ...input, captured: captured.profile });
      assert.deepEqual(restored, captured);
      assert.ok(restored.profile.system.includes("Retained testing content"));
    }),
  );
});
