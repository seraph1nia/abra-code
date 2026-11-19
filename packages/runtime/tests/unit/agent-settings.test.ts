import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Agents, makeCatalog, customTool } from "@abracode/agents";
import { definitions } from "@abracode/agents/bundled";
import { AgentCatalogSchema } from "@abracode/contracts/web/agent-settings";
import { readAgentCatalog } from "../../src/web/agent-settings.ts";

test("settings reads the injected catalog without resolving instructions, context or tools", async () => {
  const mustNotRun = () => Effect.die("Settings must only read definition metadata");
  const catalog = await Effect.runPromise(
    makeCatalog(
      [
        ...definitions,
        {
          ...definitions[1],
          id: "specialist",
          revision: "custom-2",
          instructions: [{ file: "unreadable-file.md" }, { inline: "Specialist instructions" }],
          skills: [{ name: "verification", preload: true }],
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
      ].map((definition) => ({ definition, resolve: mustNotRun, prepare: mustNotRun })),
    ),
  );
  const view = await Effect.runPromise(
    readAgentCatalog.pipe(Effect.provideService(Agents, catalog)),
  );
  assert.equal(view.agents.length, 7);
  const specialist = view.agents.find((agent) => agent.id === "specialist")!;
  assert.equal(specialist.revision, "custom-2");
  assert.equal(specialist.dynamicContext, true);
  assert.deepEqual(specialist.skills, [{ name: "verification", preload: true }]);
  assert.deepEqual(specialist.customTools, [{ id: "inspect-custom", revision: "3" }]);
  assert.deepEqual(specialist.instructions, [
    { kind: "file", path: "unreadable-file.md" },
    { kind: "inline", content: "Specialist instructions" },
  ]);
  assert.deepEqual(Schema.decodeSync(AgentCatalogSchema)(view), view);
  assert.ok(!JSON.stringify(view).includes("register"));
});
