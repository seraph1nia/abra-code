/* oxlint-disable effecttsgo/unstable-api-usage -- Read only the disposable installation's pinned native service. */
import { removeFixture } from "../helpers/resources.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { installSource, installationRoot, interactiveLaunch, command } from "../e2e/install.ts";
import { webJourney } from "../e2e/web.ts";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Service } from "@opencode/client/effect/service";
import { OpenCode } from "@opencode/client";
import { runtimePaths } from "../../src/config/identity.ts";

test(
  "fresh frozen Linux installation validates offline and reuses its own service and Abra",
  { timeout: 180_000 },
  async (t) => {
    const root = await installationRoot("abracode-install-");
    const home = join(root, "installation");
    const modelEvidence: Record<string, unknown> = { schema_version: 1 };
    await mkdir(home);
    const env = {
      ...process.env,
      ABRACODE_HOME: home,
      ABRACODE_CONFIG: "personal.yaml",
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"),
      OPENCREW_HOME: join(root, "legacy"),
    };
    const run = (script: string, args: string[] = []) =>
      command(join(home, "node_modules/.bin/tsx"), [join(home, "scripts", script), ...args], {
        cwd: home,
        env,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      });
    t.onTestFinished(async () => {
      env.ABRACODE_CONFIG = "personal.yaml";
      try {
        await run("stop.ts");
      } finally {
        await removeFixture(root);
        if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
          const directory = process.env.ABRACODE_TEST_EVIDENCE_DIR;
          assert.ok(directory !== root && !directory.startsWith(root + "/"));
          await mkdir(directory, { recursive: true });
          await writeFile(
            join(directory, "installation-agents.json"),
            JSON.stringify(
              { ...modelEvidence, result: t.task.result?.state, cleanup_complete: true },
              null,
              2,
            ) + "\n",
          );
          console.info(
            "agent-installation-evidence " +
              JSON.stringify({
                ...modelEvidence,
                result: t.task.result?.state,
                cleanup_complete: true,
              }),
          );
        }
      }
    });
    await installSource(home);
    await assert.rejects(access(join(home, ".agents")), /ENOENT/);
    assert.deepEqual((await readdir(join(home, "packages/agents/assets"))).sort(), [
      "abra.md",
      "apply.md",
      "explore.md",
      "research.md",
      "review.md",
      "skills",
    ]);
    for (const role of ["abra", "apply", "explore", "research", "review"])
      await assert.rejects(readFile(join(home, `.opencode/agents/${role}.md`)), /ENOENT/);
    const pluginRoot = join(home, ".opencode/plugins/abracode");
    const plugin = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));
    assert.equal("./tui" in plugin.exports, false);
    assert.equal((await readdir(pluginRoot)).includes("tui.ts"), false);
    await writeFile(
      join(home, "personal.yaml"),
      "version: 1\nmodels:\n  default: {providerID: example, id: example}\n  overrides:\n    supervisor: {providerID: example, id: supervisor-configured}\n",
    );
    await mkdir(join(home, ".opencrew"));
    await writeFile(join(home, ".opencrew/service.json"), "legacy sentinel");
    await writeFile(join(home, "projects.yaml"), "legacy config sentinel");
    const staticResult = JSON.parse((await run("config.ts", ["--show", "--json"])).stdout);
    assert.equal(staticResult.models.supervisor.name, "Abra");
    assert.equal(staticResult.config_path, join(home, "personal.yaml"));
    assert.equal((await readdir(home)).includes(".abracode"), false);
    await assert.rejects(run("launch.ts"), /service:start/);
    const first = await run("start.ts");
    const second = await run("start.ts");
    assert.equal(first.stdout, second.stdout);
    assert.match(first.stdout, /Abra: ses_/);
    const endpoint = await Effect.runPromise(
      Service.discover({
        file: runtimePaths(home).service,
        version: "2.3.0",
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    assert.ok(endpoint);
    const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    assert.equal((await native.server.info()).version, "2.3.0");
    const inventory = (await native.agent.list({ location: { directory: home } })).data;
    const lead = inventory.find((agent) => agent.id === "project-lead");
    assert.ok(lead?.hidden && lead.mode === "subagent");
    assert.deepEqual(
      lead.permissions.filter((rule) => rule.effect === "allow").map((rule) => rule.action),
      ["abra_lead_action"],
    );
    const profile = inventory.find((agent) => agent.id === "abra");
    assert.ok(profile && !profile.hidden && profile.mode === "primary");
    assert.equal(profile.model?.providerID, "example");
    assert.equal(profile.model?.id, "supervisor-configured");
    assert.ok(profile.system?.startsWith("You are Abra,"));
    const sessionID = /Abra: (ses_\S+)/.exec(first.stdout)![1];
    const session = await native.session.get({ sessionID });
    assert.equal(session.agent, "abra");
    assert.equal(session.model?.providerID, "example");
    assert.equal(session.model?.id, "supervisor-configured");
    Object.assign(modelEvidence, {
      configured_default: { providerID: "example", id: "example" },
      configured_supervisor: { providerID: "example", id: "supervisor-configured" },
      native_profile_model: profile.model,
      native_session_model: session.model,
      native_profile_mode: profile.mode,
      native_profile_hidden: profile.hidden,
      session_id: session.id,
      relocated: !home.startsWith(process.cwd() + "/"),
    });
    const hostBefore = await readFile(
      join(home, ".abracode/config/opencode/opencode.json"),
      "utf8",
    );
    await writeFile(
      join(home, "other.yaml"),
      "version: 1\nmodels: {default: {providerID: example, id: other}}\n",
    );
    env.ABRACODE_CONFIG = "other.yaml";
    await assert.rejects(run("start.ts"), /another configuration|CONFIG_RESTART|Restart/);
    await assert.rejects(run("config-apply.ts"), /another configuration|CONFIG_RESTART|Restart/);
    await assert.rejects(
      run("client.ts", ["--auth", "--help"]),
      /another configuration|CONFIG_RESTART|Restart/,
    );
    assert.equal(
      await readFile(join(home, ".abracode/config/opencode/opencode.json"), "utf8"),
      hostBefore,
    );
    env.ABRACODE_CONFIG = "personal.yaml";
    const host = JSON.parse(
      await readFile(join(home, ".abracode/config/opencode/opencode.json"), "utf8"),
    );
    assert.equal(host.default_agent, "abra");
    assert.deepEqual(host.plugins, [join(home, ".opencode/plugins/abracode")]);
    const auth = await run("client.ts", ["--auth", "--help"]);
    assert.match(auth.stdout, /auth login|provider|server/i);
    assert.deepEqual(JSON.parse((await run("config-apply.ts", ["--json"])).stdout).outcomes, []);
    const selection = /Abra\s*·\s*supervisor-configured\s*\(unavailable\)\s*example/;
    await interactiveLaunch(home, env, selection);
    await interactiveLaunch(home, env, selection);
    await webJourney(home, env, /Abra: (ses_\S+)/.exec(first.stdout)![1], async () => {
      await run("stop.ts");
      assert.equal(
        (await run("start.ts")).stdout.match(/Abra: (ses_\S+)/)?.[1],
        /Abra: (ses_\S+)/.exec(first.stdout)![1],
      );
    });
    assert.equal(
      (await run("start.ts")).stdout.match(/Abra: (ses_\S+)/)?.[1],
      /Abra: (ses_\S+)/.exec(first.stdout)![1],
    );
    await run("stop.ts");
    assert.equal(await readFile(join(home, ".opencrew/service.json"), "utf8"), "legacy sentinel");
    assert.equal(await readFile(join(home, "projects.yaml"), "utf8"), "legacy config sentinel");
  },
);
