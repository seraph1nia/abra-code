import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Id from "../../src/identities.ts";
import { OpenSpec } from "../../src/openspec/adapter.ts";
import { type Runner } from "../../src/process.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { ProcessRunner } from "../../src/process.ts";

async function instructionFiles(root: string) {
  const files = new Map<string, string>();
  for (const directory of [".agents", ".opencode"]) {
    for (const entry of await readdir(join(root, directory), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files.set(path.slice(root.length + 1), await readFile(path, "utf8"));
    }
  }
  return [...files].sort(([a], [b]) => a.localeCompare(b));
}

test("installed OpenSpec refreshes outdated instructions in the issue worktree before planning", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const runner: Runner = {
    run: (file, args, cwd, env, options) =>
      f.git.runner.run(
        file,
        args,
        cwd,
        {
          ...env,
          XDG_CONFIG_HOME: join(f.root, "config"),
          XDG_DATA_HOME: join(f.root, "data"),
        },
        options,
      ),
  };
  const bin = Id.Executable.make(resolve("node_modules/.bin/openspec"));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const guidance = ".agents/skills/openspec-execution/SKILL.md";
  const controllerGuidance = await readFile(resolve(guidance), "utf8");
  await mkdir(join(p.path, ".agents/skills/openspec-execution"), { recursive: true });
  await writeFile(join(p.path, guidance), controllerGuidance);
  await run(runner.run(bin, ["init", "--tools", "opencode", "--no-animation"], p.path));
  const generated = ".agents/skills/openspec-propose/SKILL.md";
  const current = await readFile(join(p.path, generated), "utf8");
  const outdated = current.replace(/^  generatedBy:.*$/m, '  generatedBy: "0.0.0"');
  assert.notEqual(outdated, current);
  await writeFile(join(p.path, generated), outdated);
  const issue = Id.IssueId.make("abra-1");
  const base = await run(f.git.commit(p.path, issue, "Outdated OpenSpec instructions"));
  await run(f.git.run(p.path, ["push", "origin", "main"]));
  const spec = new OpenSpec(runner, bin);
  f.spec.update = (e) => spec.update(e);
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  assert.equal(e.base_commit, base);
  assert.notEqual(e.openspec_update_commit, base);
  assert.equal(await readFile(join(e.worktree_directory!, generated), "utf8"), current);
  assert.equal(await readFile(join(p.path, generated), "utf8"), outdated);
  assert.equal(await readFile(join(e.worktree_directory!, guidance), "utf8"), controllerGuidance);
  f.spec.planned = true;
  f.runtime.success(e.explore_session_id!);
  assert.equal((await run(f.controller.advance(issue))).current_phase, "awaiting_plan_approval");
});

test("OpenSpec 2 refresh is idempotent and preserves all project-owned guidance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-openspec2-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(join(project, "openspec"), { recursive: true });
  await cp(resolve(".agents"), join(project, ".agents"), { recursive: true });
  await cp(resolve(".opencode/agents"), join(project, ".opencode/agents"), { recursive: true });
  await cp(resolve("openspec/config.yaml"), join(project, "openspec/config.yaml"));
  await mkdir(join(project, ".agents/skills/local-fixture"));
  await writeFile(
    join(project, ".agents/skills/local-fixture/SKILL.md"),
    "Local guidance stays local.\n",
  );
  await mkdir(join(root, "config/openspec"), { recursive: true });
  await writeFile(join(root, "config/openspec/config.json"), JSON.stringify({ profile: "core" }));
  const expected = await instructionFiles(project);
  const generated = expected.filter(([, body]) => /^  generatedBy: "2\.0\.0"$/m.test(body));
  assert.equal(generated.length, 6);
  for (const [path, body] of generated)
    await writeFile(
      join(project, path),
      body.replace(/^  generatedBy:.*$/m, '  generatedBy: "0.0.0"'),
    );
  const runner = new ProcessRunner();
  for (let attempt = 0; attempt < 2; attempt++) {
    await run(
      runner.run(
        Id.Executable.make(resolve("node_modules/.bin/openspec")),
        ["update"],
        Id.AbsolutePath.make(project),
        {
          XDG_CONFIG_HOME: join(root, "config"),
          XDG_DATA_HOME: join(root, "data"),
          OPENSPEC_TELEMETRY: "0",
          OPENSPEC_NO_UPDATE_CHECK: "1",
        },
      ),
    );
    assert.deepEqual(
      await instructionFiles(project),
      expected,
      `refresh ${attempt + 1} changed generated skills, local guidance, or role profiles`,
    );
    await assert.rejects(access(join(project, ".opencode/skills")), /ENOENT/);
    await assert.rejects(access(join(project, ".opencode/commands")), /ENOENT/);
  }
});
