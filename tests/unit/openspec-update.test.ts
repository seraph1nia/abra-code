import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { domainEffect } from "../../src/effect.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

const issue = Id.IssueId.make("abra-1");
const generated = ".opencode/commands/opsx-propose.md";

test("controller refreshes instructions before Explore and retains its baseline across restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let updates = 0;
  f.spec.update = (e) =>
    domainEffect(
      Effect.gen(function* () {
        assert.equal(f.runtime.creates, 0);
        updates++;
        yield* Effect.promise(() =>
          mkdir(join(e.worktree_directory!, ".opencode/commands"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          writeFile(join(e.worktree_directory!, generated), "Refreshed instructions\n"),
        );
      }),
    );
  f.work.add(issue);
  const e = await run(f.controller.start(issue));
  assert.equal(updates, 1);
  assert.ok(e.explore_session_id);
  assert.ok(e.openspec_update_commit);
  assert.notEqual(e.openspec_update_commit, e.base_commit);
  assert.equal(await run(f.git.head(e.worktree_directory!)), e.openspec_update_commit);
  assert.equal(
    await run(
      f.git.run(e.worktree_directory!, ["show", `${e.openspec_update_commit}:${generated}`]),
    ),
    "Refreshed instructions",
  );
  const p = (await run(f.records.project(e.repository_id)))!;
  assert.equal(await run(f.git.head(p.path)), e.base_commit);
  const restarted = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  await run(restarted.start(issue));
  assert.equal(updates, 1);
  assert.equal(f.runtime.creates, 1);
  f.spec.planned = true;
  f.runtime.success(e.explore_session_id!);
  assert.equal((await run(restarted.advance(issue))).current_phase, "awaiting_plan_approval");
  // Controller-generated instructions are allowed; subsequent worker source edits still fail.
  await writeFile(join(e.worktree_directory!, "source.txt"), "Unauthorized Explore edit\n");
  await run(restarted.control(issue, "replan"));
  f.runtime.success(e.explore_session_id!);
  await assert.rejects(run(restarted.advance(issue)), /outside assigned OpenSpec change/);
});

test("failed refresh retains provisioning and blocks all workers until explicit retry succeeds", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(issue);
  f.spec.update = () => Effect.fail(new CrewError("COMMAND_FAILED", "OpenSpec update failed"));
  await assert.rejects(run(f.controller.start(issue)), /OpenSpec update failed/);
  const failed = await run(f.controller.get(issue));
  assert.equal(failed.current_phase, "recovery_required");
  assert.equal(failed.resume_phase, "provisioning");
  assert.equal(failed.openspec_update_commit, undefined);
  assert.equal(f.runtime.creates, 0);
  await access(failed.worktree_directory!);
  await assert.rejects(
    access(join(failed.worktree_directory!, "openspec/changes", failed.openspec_change)),
  );
  f.spec.update = () => Effect.void;
  const resumed = await run(f.controller.control(issue, "retry"));
  assert.equal(resumed.current_phase, "exploring");
  assert.equal(resumed.worktree_directory, failed.worktree_directory);
  assert.equal(resumed.base_commit, failed.base_commit);
  assert.equal(resumed.openspec_update_commit, resumed.base_commit);
  assert.equal(f.runtime.trees.length, 1);
  assert.equal(f.runtime.creates, 1);
});

test("partial refresh is preserved and retry cannot silently commit unfinished changes", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(issue);
  let updates = 0;
  f.spec.update = (e) =>
    domainEffect(
      Effect.gen(function* () {
        updates++;
        yield* Effect.promise(() =>
          writeFile(join(e.worktree_directory!, "partial.md"), "Partial"),
        );
        return yield* new CrewError("COMMAND_FAILED", "OpenSpec update partially failed");
      }),
    );
  await assert.rejects(run(f.controller.start(issue)), /partially failed/);
  const e = await run(f.controller.get(issue));
  await assert.rejects(run(f.controller.control(issue, "retry")), /clean owned worktree/);
  assert.equal(updates, 1);
  assert.equal(f.runtime.creates, 0);
  assert.equal(await readFile(join(e.worktree_directory!, "partial.md"), "utf8"), "Partial");
  assert.equal(await run(f.git.head(e.worktree_directory!)), e.base_commit);
});

test("saved refresh is reused when change creation fails during provisioning", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(issue);
  let updates = 0;
  f.spec.update = () =>
    Effect.sync(() => {
      updates++;
    });
  const create = f.spec.create;
  f.spec.create = () => Effect.fail(new CrewError("COMMAND_FAILED", "Change creation failed"));
  await assert.rejects(run(f.controller.start(issue)), /Change creation failed/);
  assert.ok((await run(f.controller.get(issue))).openspec_update_commit);
  f.spec.create = create;
  const e = await run(f.controller.control(issue, "retry"));
  assert.equal(e.current_phase, "exploring");
  assert.equal(updates, 1);
});

test("short-policy workflows do not invoke OpenSpec update", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.spec.update = () =>
    Effect.fail(new CrewError("UNEXPECTED_SPEC", "No OpenSpec for short policies"));
  for (const policy of ["research-only", "lightweight-fix"] as const) {
    const id = Id.IssueId.make(policy);
    f.work.add(id, Id.RepositoryId.make(policy === "research-only" ? "api" : "frontend"));
    f.work.issues.get(id)!.workflow_policy = policy;
    f.work.issues.get(id)!.scope = { goal: "Inspect", acceptance: ["Evidence"], constraints: [] };
    const e = await run(f.controller.start(id));
    assert.equal(e.current_phase, "awaiting_plan_approval");
    assert.equal(e.openspec_update_commit, undefined);
  }
});
