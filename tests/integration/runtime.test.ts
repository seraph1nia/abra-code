import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config/load.ts";
import { ProcessRunner } from "../../src/process.ts";
test("controller defaults run pinned workflow CLIs outside the central home without ambient openspec", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-runtime-"));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  await symlink(resolve("node_modules"), join(home, "node_modules"));
  const runtime = join(home, "runtime");
  const worktree = join(home, "worktree");
  await mkdir(runtime);
  await mkdir(worktree);
  await symlink(process.execPath, join(runtime, "node"));
  await writeFile(
    join(home, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\n",
  );
  const config = await run(loadConfig(home));
  assert.equal(config.work_database, join(home, ".abracode/work.sqlite"));
  const runner = new ProcessRunner();
  const env = { PATH: runtime };
  await assert.rejects(
    run(
      runner.run(
        Id.Executable.make("openspec"),
        ["--version"],
        Id.AbsolutePath.make(worktree),
        env,
      ),
    ),
    /ENOENT/,
  );
  assert.match(
    await run(
      runner.run(config.commands.openspec, ["--version"], Id.AbsolutePath.make(worktree), env),
    ),
    /1\.13\.2/,
  );
});
test("command overrides are preserved and unavailable workflow CLIs fail before service startup", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-preflight-"));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  const missing = join(home, "missing-openspec");
  const configFile = join(home, "abracode.yaml");
  await writeFile(
    configFile,
    `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\ncommands:\n  openspec: ${missing}\n  forge: custom-gh\n`,
  );
  assert.deepEqual((await run(loadConfig(home))).commands, {
    openspec: missing,
    forge: "custom-gh",
  });
  await assert.rejects(
    run(
      new ProcessRunner().run(
        Id.Executable.make(process.execPath),
        ["--import", "tsx", resolve("scripts/start.ts")],
        Id.AbsolutePath.make(process.cwd()),
        { ABRACODE_HOME: home, ABRACODE_CONFIG: configFile },
      ),
    ),
    /Workflow CLI unavailable: .*missing-openspec.*pnpm install/,
  );
  await assert.rejects(access(join(home, ".abracode")), /ENOENT/);
});
