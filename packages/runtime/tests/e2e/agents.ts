import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Rpc } from "@opencode/plugin";
const object = { type: "object" as const, additionalProperties: true };
export const agentFixture = Rpc.define({
  id: "abracode-agent-fixture",
  methods: { counts: { input: object, output: object } },
  events: {},
});

/** Trusted seventh definition through the public catalog/plugin seams, only in the disposable install. */
export async function installSpecialist(home: string) {
  const plugin = join(home, ".opencode/plugins/abracode/index.ts");
  const skill = join(home, "packages/agents/assets/skills/preload-fixture");
  await mkdir(skill);
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: preload-fixture\ndescription: Test preloading\n---\nFixture preload instructions.\n",
  );
  await writeFile(
    plugin,
    `
import { createPlugin } from "@abracode/runtime/plugin";
import { Context, Effect, Layer, Schema } from "effect";
import { Agents, makeAgent, makeCatalog, customTool, AgentDefinitionError } from "@abracode/agents";
import { bundledCatalog, definitions } from "@abracode/agents/bundled";
import { Rpc } from "@opencode/plugin";
const object = {type:"object",additionalProperties:true};
const agentFixture = Rpc.define({id:"abracode-agent-fixture",methods:{counts:{input:object,output:object}},events:{}});
class PreparationCounter extends Context.Service()("fixture/PreparationCounter") {}
export default createPlugin(ctx => Layer.effect(Agents,Effect.gen(function* () {
  yield* ctx.rpc.register(agentFixture,{counts:()=>ctx.storage.get("specialist-preparations").pipe(
    Effect.map(counts=>({counts:counts ?? {}})))});
  const bundled = yield* bundledCatalog;
  const values = yield* Effect.forEach(yield* bundled.list,d=>bundled.get(d.id));
  const counter = {
    next: task => Effect.gen(function* () {
      const counts = (yield* ctx.storage.get("specialist-preparations")) ?? {};
      counts[task] = (counts[task] ?? 0) + 1;
      yield* ctx.storage.set("specialist-preparations",counts);
      return counts[task];
    }).pipe(Effect.mapError(()=>new AgentDefinitionError({code:"PROVIDER",definition:"engineering-specialist",message:"Counter unavailable"})))
  };
  const specialist = yield* makeAgent({
    ...definitions[1],id:"engineering-specialist",revision:"fixture-1",
    skills:[{name:"browser"},{name:"preload-fixture",preload:true}],
    deny:["inspect-denied"],
    customTools:[customTool({
      id:"inspect-specialist",revision:"1",description:"Inspect the retained preparation count",action:"read",
      input:Schema.Struct({task:Schema.String}),output:Schema.Struct({prepared:Schema.Finite}),
      run: ({task}) => ctx.storage.get("specialist-preparations").pipe(Effect.map(counts=>({prepared:counts?.[task] ?? 0}))),
    }),customTool({
      id:"inspect-denied",revision:"1",description:"Explicitly denied read contribution",action:"read",
      input:Schema.Struct({}),output:Schema.Struct({ran:Schema.Boolean}),
      run:()=>Effect.succeed({ran:true}),
    })],
    context: facts => Effect.gen(function* () {
      const counter = yield* PreparationCounter;
      const count = yield* counter.next(facts.task.id);
      return [{name:"fixture-task",content:"Specialist captured "+facts.task.id+" preparation "+count}];
    }),
  }).pipe(Effect.provideService(PreparationCounter,counter));
  return yield* makeCatalog([...values,specialist]);
})));
`,
  );
  await symlink(
    join(home, "packages/runtime/node_modules"),
    join(home, ".opencode/plugins/abracode/node_modules"),
  );
}
export function assertSpecialistRequest(
  role: string,
  system: string,
  toolNames: readonly string[],
) {
  if (role !== "explore") return;
  assert.ok(system.includes("Specialist captured "));
  assert.ok(system.includes("Fixture preload instructions."));
  assert.ok(toolNames.includes("inspect-specialist"));
  assert.ok(!toolNames.includes("inspect-denied"));
  assert.ok(!toolNames.includes("abra_work_start"));
  assert.ok(!toolNames.includes("task"));
}
