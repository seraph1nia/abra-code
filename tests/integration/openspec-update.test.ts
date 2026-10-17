import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as Id from "../../src/identities.ts";
import { OpenSpec } from "../../src/openspec/adapter.ts";
import { type Runner } from "../../src/process.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

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
  await run(runner.run(bin, ["init", "--tools", "opencode", "--no-animation"], p.path));
  const generated = ".opencode/skills/openspec-propose/SKILL.md";
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
  f.spec.planned = true;
  f.runtime.success(e.explore_session_id!);
  assert.equal((await run(f.controller.advance(issue))).current_phase, "awaiting_plan_approval");
});
