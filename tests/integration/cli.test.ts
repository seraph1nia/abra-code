import { Onboarding } from "../../src/config/onboard.ts";
import { Records } from "../../src/storage/store.ts";
import { MemoryStore, writePlan, repo } from "../fixtures.ts";
import { createExecution } from "../../src/workflow/execution.ts";
import * as Id from "../../src/identities.ts";
import { Effect, Scope, Exit } from "effect";
import { run } from "../effects.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProcessRunner } from "../../src/process.ts";
import { Git } from "../../src/git/repository.ts";
import { OpenSpec } from "../../src/openspec/adapter.ts";
import { FileLocks } from "../../src/storage/lock.ts";

import { CrewError, type Execution } from "../../src/domain.ts";
const bin = (name: string) => resolve("node_modules/.bin", name);
test("installed OpenSpec: schema planning, strict validation, unfinished tasks, completed tasks and canonical archive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-openspec-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const r = new ProcessRunner();
  const path = await run(repo(root, "api"));
  // Fixture uses a tracked config and the actual CLI resolves the standard schema.
  const project = (
    await run(
      new Onboarding(
        new Records(new MemoryStore()),
        new Git(r),
        r,
        Id.Executable.make(bin("openspec")),
      ).register(
        {
          id: Id.RepositoryId.make("api"),
          path: Id.AbsolutePath.make(path),
        },
        false,
      ),
    )
  ).project;
  const e: Execution = {
    ...(await run(
      createExecution(project, {
        issue_id: Id.IssueId.make("abra-1"),
        repository_id: project.id,
        execution_id: Id.ExecutionId.make("abra-test"),
        current_phase: "planning",
        workflow_policy: "full-openspec",
        branch: Id.BranchName.make("main"),
        openspec_change: Id.ChangeName.make("sample"),
      }),
    )),
    worktree_directory: Id.AbsolutePath.make(path),
  };
  const spec = new OpenSpec(r, Id.Executable.make(bin("openspec")));
  await run(spec.update(e));
  await run(spec.create(e));
  assert.equal((await run(spec.status(e))).isPlanningComplete, false);
  await assert.rejects(run(spec.plan(e)), /incomplete/);
  await run(writePlan(path, "sample"));
  await run(spec.plan(e));
  assert.equal((await run(spec.instructions(e, Id.ArtifactId.make("specs")))).artifactId, "specs");
  await assert.rejects(run(spec.implemented(e)), /unfinished/);
  await run(writePlan(path, "sample", true));
  await run(spec.implemented(e));
  const archive = await run(spec.archive(e));
  assert.equal(await run(spec.archive(e)), archive);
  const canonical = await run(
    r.run(
      Id.Executable.make(bin("openspec")),
      ["validate", "--specs", "--strict", "--json"],
      Id.AbsolutePath.make(path),
    ),
  );
  assert.equal(JSON.parse(canonical).summary.totals.failed, 0);
});
test("real kernel lock excludes independent controllers and releases safely", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-lock-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const a = new FileLocks(Id.AbsolutePath.make(root)),
    b = new FileLocks(Id.AbsolutePath.make(root));
  const scope = await run(Scope.make());
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  await run(
    a.acquire(Id.LockKey.make("controller")).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  await assert.rejects(
    run(b.acquire(Id.LockKey.make("controller"))),
    (error: unknown) => error instanceof CrewError && error.code === "LOCKED",
  );
  await run(Scope.close(scope, Exit.void));
  await run(b.acquire(Id.LockKey.make("controller")));
});
test("registration permits missing OpenSpec and explicit legacy init preserves existing instructions", async (t) => {
  const { Onboarding } = await import("../../src/config/onboard.ts");
  const { Records } = await import("../../src/storage/store.ts");
  const { MemoryStore } = await import("../fixtures.ts");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "abracode-onboard-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const r = new ProcessRunner();
  const path = await run(repo(root, "uninitialized"));
  await rm(join(path, "openspec"), { recursive: true });
  await writeFile(join(path, "AGENTS.md"), "Keep this project instruction.\n");
  await mkdir(join(path, ".agents/skills/existing"), { recursive: true });
  await writeFile(join(path, ".agents/skills/existing/SKILL.md"), "Existing skill.\n");
  const records = new Records(new MemoryStore());
  const onboarding = new Onboarding(records, new Git(r), r, Id.Executable.make(bin("openspec")));
  assert.equal(
    (
      await run(
        onboarding.inspect({ id: Id.RepositoryId.make("api"), path: Id.AbsolutePath.make(path) }),
      )
    ).proposal.initialize_openspec,
    true,
  );
  const pending = await run(
    onboarding.register(
      { id: Id.RepositoryId.make("api"), path: Id.AbsolutePath.make(path) },
      false,
    ),
  );
  assert.equal(pending.project.openspec, false);
  assert.match(pending.setup_blockers.join(), /OpenSpec/);
  assert.equal((await run(records.projects())).length, 1);
  assert.equal(
    await run(
      new Git(r).run(Id.AbsolutePath.make(path), [
        "ls-files",
        "--others",
        "--exclude-standard",
        "openspec/config.yaml",
      ]),
    ),
    "",
  );
  const registered = await run(
    onboarding.register(
      { id: Id.RepositoryId.make("api"), path: Id.AbsolutePath.make(path) },
      true,
    ),
  );
  assert.equal(registered.project.openspec, true);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(join(path, "AGENTS.md"), "utf8"), "Keep this project instruction.\n");
  assert.equal(
    await readFile(join(path, ".agents/skills/existing/SKILL.md"), "utf8"),
    "Existing skill.\n",
  );
});

test("Git observation leaves the index untouched after file timestamps change", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-git-observer-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = await run(repo(root, "observer"));
  const git = new Git(new ProcessRunner());
  const index = join(path, ".git/index");
  const before = await readFile(index);
  const future = new Date(Date.now() + 60_000);
  await utimes(join(path, "source.txt"), future, future);
  assert.equal(await run(git.dirty(Id.AbsolutePath.make(path))), "");
  assert.deepEqual(await readFile(index), before);
  await run(git.fingerprint(Id.AbsolutePath.make(path)));
  assert.deepEqual(await readFile(index), before);
});
