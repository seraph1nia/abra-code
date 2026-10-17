import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeFile, readFile, rm, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { installSource, installationRoot, interactiveLaunch, command } from "./install.ts";

test(
  "fresh frozen Linux installation validates offline and reuses its own service and Abra",
  { timeout: 180_000 },
  async (t) => {
    const root = await installationRoot("abracode-install-");
    const home = join(root, "installation");
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
        await rm(root, { recursive: true, force: true });
      }
    });
    await installSource(home);
    await writeFile(
      join(home, "personal.yaml"),
      "version: 1\nmodels: {default: {providerID: example, id: example}}\n",
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
    await interactiveLaunch(home, env);
    await interactiveLaunch(home, env);
    assert.equal((await run("start.ts")).stdout, first.stdout);
    await run("stop.ts");
    assert.equal(await readFile(join(home, ".opencrew/service.json"), "utf8"), "legacy sentinel");
    assert.equal(await readFile(join(home, "projects.yaml"), "utf8"), "legacy config sentinel");
  },
);
