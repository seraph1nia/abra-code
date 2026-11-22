/* oxlint-disable effecttsgo/unstable-api-usage -- Exercise the pinned native service in an isolated fixture. */
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, mkdir, symlink, writeFile, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { OpenCode } from "@opencode/client";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateHostConfiguration } from "../../src/config/host.ts";
import { loadConfig } from "../../src/config/load.ts";
import { runtimePaths } from "../../src/config/identity.ts";
import { command } from "../e2e/install.ts";
import { removeFixture } from "../helpers/resources.ts";

test("a failed native plugin can be stopped before Abra exists, with process/config ownership enforced", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-service-recovery-"));
  const home = join(root, "installation");
  const file = runtimePaths(home).service;
  const native = <A, E>(effect: Effect.Effect<A, E, import("effect").FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
  t.onTestFinished(async () => {
    try {
      await native(Service.stop({ file, pty: "clear" }));
    } finally {
      await removeFixture(root);
    }
  });
  await mkdir(home);
  await symlink(resolve("node_modules"), join(home, "node_modules"));
  const source = "version: 1\nmodels: {default: {providerID: fixture, id: fixture}}\n";
  await writeFile(join(home, "abracode.yaml"), source);
  await writeFile(join(home, "other.yaml"), source);
  const plugin = join(home, ".opencode/plugins/abracode");
  await mkdir(plugin, { recursive: true });
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({ name: "abracode-broken-fixture", type: "module", exports: "./index.ts" }),
  );
  await writeFile(
    join(plugin, "index.ts"),
    'export { default } from "abracode-missing-package-fixture";\n',
  );
  const config = await Effect.runPromise(loadConfig(home));
  const host = await Effect.runPromise(generateHostConfiguration(config));
  const env = {
    ...process.env,
    ABRACODE_HOME: home,
    ABRACODE_CONFIG: config.config_path,
    OPENCODE_CONFIG: host,
    OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(home, ".abracode/state"),
  };
  const endpoint = await native(
    Service.ensure({
      file,
      version: "2.3.0",
      command: [resolve("node_modules/.bin/opencode"), "serve", "--service", "--port", "0"],
      env,
    }),
  );
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const cli = (script: string, configPath: string = config.config_path) =>
    command(resolve("node_modules/.bin/tsx"), [resolve("scripts", script)], {
      cwd: home,
      env: { ...env, ABRACODE_CONFIG: configPath },
      timeout: 12000,
    });
  await assert.rejects(cli("start.ts"), (error) => {
    assert.ok(error instanceof Error);
    const output = String(Reflect.get(error, "stdout")) + String(Reflect.get(error, "stderr"));
    assert.match(
      output,
      /AbraCode plugin failed to activate: Plugin failed to load.*native diagnostic: err_/,
    );
    assert.match(output, /pnpm service:restart/);
    return true;
  });
  assert.equal((await client.session.list({ directory: home })).data.length, 0);
  const before = await readFile(file, "utf8");
  await assert.rejects(cli("stop.ts", join(home, "other.yaml")), /No service was stopped/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await client.server.info()).version, "2.3.0");

  // Copying a live registration into another installation cannot grant stop authority.
  const foreign = join(root, "foreign");
  await mkdir(join(foreign, ".abracode/state/opencode"), { recursive: true });
  await symlink(resolve("node_modules"), join(foreign, "node_modules"));
  await writeFile(join(foreign, "abracode.yaml"), source);
  await writeFile(runtimePaths(foreign).service, before);
  await assert.rejects(
    command(resolve("node_modules/.bin/tsx"), [resolve("scripts/stop.ts")], {
      cwd: foreign,
      env: { ...env, ABRACODE_HOME: foreign, ABRACODE_CONFIG: join(foreign, "abracode.yaml") },
      // A foreign location can omit AbraCode for the entire 15-second activation window.
      timeout: 20000,
    }),
    /No service was stopped/,
  );
  assert.equal((await client.server.info()).version, "2.3.0");

  assert.match((await cli("stop.ts")).stdout, /native service stopped/);
  await assert.rejects(access(file), /ENOENT/);
  await assert.rejects(client.server.info());
});

test("a matching HTTP health response and environment cannot authorize stopping a non-native process", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-foreign-process-"));
  t.onTestFinished(() => removeFixture(home));
  const file = runtimePaths(home).service;
  await mkdir(join(home, ".abracode/state/opencode"), { recursive: true });
  await writeFile(
    join(home, "abracode.yaml"),
    "version: 1\nmodels: {default: {providerID: fixture, id: fixture}}\n",
  );
  const env = {
    ...process.env,
    ABRACODE_HOME: home,
    ABRACODE_CONFIG: join(home, "abracode.yaml"),
    OPENCODE_CONFIG: runtimePaths(home).hostConfig,
    OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
    XDG_STATE_HOME: join(home, ".abracode/state"),
  };
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createServer } from "node:http";
    let inventoryReads = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url.startsWith("/api/info")
        ? { version: "2.3.0", pid: process.pid, urls: [], paths: {tmp: process.env.ABRACODE_HOME} }
        : { location: {directory: process.env.ABRACODE_HOME}, data: ++inventoryReads === 1 ? [] : [{
          source: {type: "local", path: process.env.ABRACODE_HOME + "/.opencode/plugins/abracode"},
          features: {server: true}, state: {status: "failed", error: "Plugin failed to load"}
        }] }));
    });
    server.listen(0, "127.0.0.1", () => console.log("http://127.0.0.1:" + server.address().port));
  `,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  try {
    const [chunk] = await once(child.stdout!, "data");
    const url = String(chunk).trim();
    const registration = JSON.stringify({ url, pid: child.pid, version: "2.3.0" });
    await writeFile(file, registration);
    await assert.rejects(
      command(resolve("node_modules/.bin/tsx"), [resolve("scripts/stop.ts")], {
        cwd: home,
        env,
        timeout: 12000,
      }),
      /No service was stopped/,
    );
    assert.equal((await fetch(url + "/api/info")).status, 200);
    assert.equal(await readFile(file, "utf8"), registration);
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
});
