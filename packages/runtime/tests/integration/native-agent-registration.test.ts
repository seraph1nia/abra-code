import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { OpenCode } from "@opencode/client";
import { Rpc } from "@opencode/plugin";
import { bundledSkills } from "@abracode/agents/bundled";
import { nativePermissions } from "@abracode/agents/policy";
import { removeFixture } from "../helpers/resources.ts";

const value = { type: "object" as const, additionalProperties: true };
const proof = Rpc.define({
  id: "agent-registry-proof",
  methods: {
    close: { input: value, output: value },
    late: { input: value, output: value },
  },
  events: {},
});
test(
  "2.3.0 agent transform inserts absent IDs with native fields and scoped disposal",
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp("/tmp/opencode/abra-agent-registry-");
    const file = join(root, "state/opencode/service.json");
    const native = <A, E>(effect: Effect.Effect<A, E, import("effect").FileSystem.FileSystem>) =>
      Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
    t.onTestFinished(async () => {
      try {
        await native(Service.stop({ file, pty: "clear" }));
      } finally {
        await removeFixture(root);
      }
    });
    const plugin = join(root, "plugin");
    await mkdir(plugin);
    await symlink(resolve("packages/runtime/node_modules"), join(plugin, "node_modules"));
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ name: "agent-registry-proof", type: "module", exports: "./index.ts" }),
    );
    await writeFile(
      join(plugin, "index.ts"),
      `
import { Plugin } from "@opencode/plugin/effect";
import { Rpc } from "@opencode/plugin";
import { Context, Effect, Scope, Exit } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
 import { Layer, Schema } from "effect";
 import { makeAgent, makeCatalog, Agents, PreparedAgent } from "@abracode/agents";
import { sourcesLayer } from "@abracode/agents/bundled";
import { OpenCodeAgents, OpenCodeAgentsLive } from "@abracode/agents/native";
const value = { type: "object", additionalProperties: true };
const proof = Rpc.define({id:"agent-registry-proof",methods:{close:{input:value,output:value},late:{input:value,output:value}},events:{}});
export default Plugin.define({
 id: "agent-registry-proof",
 effect: ctx => Effect.gen(function* () {
   const scope = yield* Scope.make();
   yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
   const dependencies = Layer.mergeAll(NodeFileSystem.layer,NodePath.layer,sourcesLayer(${JSON.stringify(bundledSkills)}));
   const agent = yield* makeAgent({
     id:"absent-agent-proof",revision:"1",description:"inserted native profile",mode:"subagent",roles:["review"],
     model:{providerID:"fixture",id:"fixture"},instructions:[{inline:"single static system proof"}],
   }).pipe(Effect.provide(dependencies));
   const catalog = yield* makeCatalog([agent]);
    const retained = yield* ctx.storage.get("prepared");
    const prepared = retained
      ? yield* Schema.decodeUnknownEffect(PreparedAgent)(retained)
      : yield* agent.prepare({role:"review",task:{id:"private-task",title:"private",description:"private facts"},repository:{id:"private-repo",directory:"/private",base:"base"}});
    yield* ctx.storage.set("prepared",JSON.parse(JSON.stringify(prepared)));
    const registration = yield* Layer.build(OpenCodeAgentsLive(ctx, {
      central:false,skills:${JSON.stringify(bundledSkills)},profiles:[yield* agent.resolve("review"),prepared.profile],
     authorize:()=>Effect.void,
   }).pipe(Layer.provide(Layer.succeed(Agents,catalog)),Layer.provide(dependencies)))
      .pipe(Effect.provideService(Scope.Scope,scope));
    const adapter = Context.get(registration, OpenCodeAgents);
    const lateAgent = yield* makeAgent({
      ...agent.definition,instructions:[{inline:"late captured static proof"}],
    }).pipe(Effect.provide(dependencies));
    const lateProfile = yield* lateAgent.resolve("review");
    yield* ctx.rpc.register(proof, {
      close: () => Scope.close(scope, Exit.void).pipe(Effect.as({closed:true})),
      late: () => adapter.register([lateProfile]).pipe(Effect.as({id:lateProfile.id})),
    });
 })
});
`,
    );
    const config = join(root, "opencode.json");
    await writeFile(
      config,
      JSON.stringify({
        plugins: [plugin],
        agent: {
          unrelated: {
            description: "unrelated entry",
            mode: "subagent",
            prompt: "unrelated system",
          },
        },
      }),
    );
    const serviceOptions = {
      file,
      version: "2.3.0",
      command: [resolve("node_modules/.bin/opencode"), "serve", "--service", "--port", "0"],
      env: {
        ...process.env,
        OPENCODE_CONFIG: config,
        OPENCODE_CONFIG_DIR: join(root, "global"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
      },
    };
    const endpoint = await native(Service.ensure(serviceOptions));
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    assert.equal((await client.server.info()).version, "2.3.0");
    const location = { directory: root };
    await client.location.get({ location });
    for (let attempt = 0; attempt < 100; attempt++) {
      const plugins = (await client.plugin.list({ location })).data;
      assert.ok(!plugins.some((p) => p.state.status === "failed"), JSON.stringify(plugins));
      if (plugins.some((p) => p.id === "agent-registry-proof" && p.state.status === "active"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const inventory = await client.agent.list({ location });
    const skills = (await client.skill.list({ location })).data;
    assert.ok(skills.some((skill) => skill.id === "abra-browser"));
    assert.ok(!skills.some((skill) => skill.id === "abra-testing"));
    assert.ok(
      skills
        .filter((skill) => skill.id.startsWith("abra-"))
        .every((skill) => skill.path.startsWith(bundledSkills + "/")),
    );
    const inserted = inventory.data.find((a) => a.id.startsWith("abra-absent-agent-proof-"));
    assert.ok(inserted, JSON.stringify(await client.plugin.list({ location })));
    assert.equal(inserted.system, "single static system proof");
    assert.equal(inserted.description, "inserted native profile");
    assert.equal(inserted.mode, "subagent");
    assert.equal(inserted.hidden, true);
    assert.deepEqual(inserted.model, { providerID: "fixture", id: "fixture" });
    assert.deepEqual(inserted.permissions, [
      ...nativePermissions("review"),
      { action: "browser", resource: "*", effect: "deny" },
      { action: "skill", resource: "browser", effect: "deny" },
    ]);
    assert.ok(inventory.data.some((a) => a.id === "unrelated" && a.system === "unrelated system"));
    assert.equal((await client.session.list({ directory: root })).data.length, 0);
    assert.ok(!inventory.data.some((a) => a.system === "late captured static proof"));
    const late = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await client.rpc(proof).late({}, { location }),
    );
    const lateInventory = (await client.agent.list({ location })).data;
    assert.equal(
      lateInventory.find((a) => a.id === late.id)?.system,
      "late captured static proof",
      "Late registration must invalidate the already observed native registry inside the adapter",
    );
    assert.ok(lateInventory.some((a) => a.id === inserted.id));
    assert.equal((await client.session.list({ directory: root })).data.length, 0);
    await client.rpc(proof).close({}, { location });
    const after = await client.agent.list({ location });
    assert.ok(!after.data.some((a) => a.id === inserted.id));
    assert.ok(!after.data.some((a) => a.id === late.id));
    assert.ok(after.data.some((a) => a.id === "unrelated"));
    assert.equal((await client.session.list({ directory: root })).data.length, 0);
    await native(Service.stop({ file, pty: "clear" }));
    const source = await readFile(join(plugin, "index.ts"), "utf8");
    await writeFile(
      join(plugin, "index.ts"),
      source.replace("single static system proof", "edited current static proof"),
    );
    const restarted = await native(Service.ensure(serviceOptions));
    const restoredClient = OpenCode.make({
      baseUrl: restarted.url,
      headers: Service.headers(restarted),
    });
    await restoredClient.location.get({ location });
    for (let attempt = 0; attempt < 100; attempt++) {
      const plugins = (await restoredClient.plugin.list({ location })).data;
      assert.ok(
        !plugins.some((p) => p.state.status === "failed"),
        JSON.stringify(plugins.filter((p) => p.id === "agent-registry-proof")),
      );
      if (plugins.some((p) => p.id === "agent-registry-proof" && p.state.status === "active"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const restored = (await restoredClient.agent.list({ location })).data;
    assert.equal(restored.find((a) => a.id === inserted.id)?.system, "single static system proof");
    assert.ok(
      restored.some((a) => a.id !== inserted.id && a.system === "edited current static proof"),
    );
    assert.equal((await restoredClient.session.list({ directory: root })).data.length, 0);
    await restoredClient.rpc(proof).close({}, { location });
    assert.ok(
      !(await restoredClient.agent.list({ location })).data.some((a) =>
        a.id.startsWith("abra-absent-agent-proof-"),
      ),
    );
  },
);
