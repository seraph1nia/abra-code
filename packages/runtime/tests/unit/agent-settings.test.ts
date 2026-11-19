/* oxlint-disable effecttsgo/unstable-api-usage -- Exercise injected pinned Effect filesystem/path services. */
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema, Layer } from "effect";
import { Agents, makeCatalog, makeAgent, customTool } from "@abracode/agents";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { sourcesLayer } from "@abracode/agents/bundled";
import { definitions } from "@abracode/agents/bundled";
import { AgentCatalogSchema } from "@abracode/contracts/web/agent-settings";
import { readAgentCatalog } from "../../src/web/agent-settings.ts";

test("settings reads authored instructions without preparing context, skills or tools", async () => {
  const mustNotRun = () => Effect.die("Settings must not prepare context or tools");
  const catalog = await Effect.runPromise(
    makeCatalog(
      [
        ...definitions,
        {
          ...definitions[1],
          id: "specialist",
          revision: "custom-2",
          instructions: [{ file: "unreadable-file.md" }, { inline: "Specialist instructions" }],
          skills: [{ name: "missing-skill", preload: true }],
          context: mustNotRun,
          customTools: [
            customTool({
              id: "inspect-custom",
              revision: "3",
              description: "Inspect custom data",
              action: "read",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              run: mustNotRun,
            }),
          ],
        },
      ].map((definition) => ({
        definition,
        readInstructions: Effect.succeed(
          definition.instructions.map((source) =>
            "file" in source
              ? {
                  kind: "file" as const,
                  path: source.file,
                  error: "Cannot read instruction source",
                }
              : { kind: "inline" as const, content: source.inline },
          ),
        ),
        resolve: mustNotRun,
        prepare: mustNotRun,
      })),
    ),
  );
  const view = await Effect.runPromise(
    readAgentCatalog.pipe(Effect.provideService(Agents, catalog)),
  );
  assert.equal(view.agents.length, 7);
  const specialist = view.agents.find((agent) => agent.id === "specialist")!;
  assert.equal(specialist.revision, "custom-2");
  assert.equal(specialist.dynamicContext, true);
  assert.deepEqual(specialist.skills, [{ name: "missing-skill", preload: true }]);
  assert.deepEqual(specialist.customTools, [{ id: "inspect-custom", revision: "3" }]);
  assert.deepEqual(specialist.instructions, [
    { kind: "file", path: "unreadable-file.md", error: "Cannot read instruction source" },
    { kind: "inline", content: "Specialist instructions" },
  ]);
  assert.deepEqual(Schema.decodeSync(AgentCatalogSchema)(view), view);
  assert.ok(!JSON.stringify(view).includes("register"));
});

test("settings reads package instruction files and preserves unavailable sources independently", async () => {
  const view = await Effect.runPromise(
    Effect.gen(function* () {
      const agent = yield* makeAgent({
        ...definitions[1],
        instructions: [
          { file: "explore.md" },
          { file: "missing.md" },
          { file: "../package.json" },
          { inline: "## Inline guidance\n\nUse **evidence**." },
        ],
        skills: [{ name: "missing-skill", preload: true }],
        context: () => Effect.die("Settings must not prepare context"),
      });
      const catalog = yield* makeCatalog([agent]);
      return yield* readAgentCatalog.pipe(Effect.provideService(Agents, catalog));
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, sourcesLayer()))),
  );
  const sources = view.agents[0]!.instructions;
  assert.ok(sources[0]!.content?.includes("You are Explore"));
  assert.deepEqual(sources[1], {
    kind: "file",
    path: "missing.md",
    error: "Cannot read instruction source",
  });
  assert.deepEqual(sources[2], {
    kind: "file",
    path: "../package.json",
    error: "Instruction source escapes package assets",
  });
  assert.deepEqual(sources[3], {
    kind: "inline",
    content: "## Inline guidance\n\nUse **evidence**.",
  });
  assert.deepEqual(Schema.decodeSync(AgentCatalogSchema)(view), view);
});
