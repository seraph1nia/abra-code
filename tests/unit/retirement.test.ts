import { ToolProgress, type ProgressUpdate } from "../../src/opencode/progress.ts";
import { TestClock } from "effect/testing";
import { Controller } from "../../src/workflow/controller.ts";
import { inspectCleanup } from "../../src/git/cleanup.ts";
import { deliveryAction } from "../../src/workflow/delivery-outcome.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, access, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { Schema, Effect, Clock } from "effect";
import { GeneratedPathsSchema } from "../../src/config/paths.ts";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { CrewError } from "../../src/domain.ts";

test("generated paths accept exact directories and reject roots, control paths, patterns and overlap", () => {
  const decode = Schema.decodeSync(GeneratedPathsSchema);
  assert.deepEqual(decode(["node_modules", "build output/cache"]), [
    "node_modules",
    "build output/cache",
  ]);
  for (const paths of [
    [""],
    ["."],
    ["/tmp"],
    ["../data"],
    ["a/../data"],
    ["a//b"],
    ["dist/*"],
    [".git"],
    ["foo/.opencode"],
    ["openspec"],
    ["a\\b"],
    ["dist", "dist/cache"],
    ["dist", "dist"],
  ])
    assert.throws(() => decode(paths));
});
async function prepare(f: Awaited<ReturnType<typeof runFixture>>, paths: string[]) {
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.generated_paths = paths.map((value) => Id.RelativePath.make(value));
  await run(f.records.saveProject(p));
  const exclude = await run(f.git.run(p.path, ["rev-parse", "--git-path", "info/exclude"]));
  await writeFile(join(p.path, exclude), "node_modules/\ndist/\nnotes/\n");
  const e = await run(delivered(f));
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  await run(f.records.save(e));
  return e;
}
const runFixture = () => run(fixture);

test("only configured generated leftovers retire, contained dependency links are safe and history survives", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, ["node_modules"]);
  await mkdir(join(e.worktree_directory!, "node_modules/pkg"), { recursive: true });
  await writeFile(join(e.worktree_directory!, "node_modules/pkg/index.js"), "generated");
  await symlink("pkg", join(e.worktree_directory!, "node_modules/link"));
  const done = await run(f.controller.finish(e.issue_id));
  assert.equal(done.current_phase, "completed");
  assert.equal(done.retirement!.native, "confirmed");
  assert.equal(done.retirement!.generated[0].state, "removed");
  assert.equal(done.explore_session_id, e.explore_session_id);
});

for (const kind of ["unapproved", "tracked", "escaping", "ancestor-link", "nested"] as const) {
  test(`cleanup preserves ${kind} paths`, async (t) => {
    const f = await runFixture();
    t.onTestFinished(() => run(f.close()));
    const e = await prepare(f, kind === "unapproved" ? [] : ["node_modules"]);
    const dir = join(e.worktree_directory!, "node_modules");
    if (kind === "ancestor-link") await symlink(f.root, dir);
    else {
      await mkdir(dir);
      await writeFile(join(dir, "note"), "retain");
      if (kind === "escaping") await symlink(f.root, join(dir, "escape"));
      if (kind === "nested") await mkdir(join(dir, ".git"));
      if (kind === "tracked") {
        await run(f.git.run(e.worktree_directory!, ["add", "-f", "node_modules/note"]));
        await run(f.git.run(e.worktree_directory!, ["commit", "-m", "Tracked descendant"]));
        e.delivered_commit = await run(f.git.head(e.worktree_directory!));
        f.delivery.pr!.headRefOid = e.delivered_commit;
        await run(f.records.save(e));
      }
    }
    if (kind === "unapproved") {
      const blocked = await run(f.controller.finish(e.issue_id));
      assert.equal(blocked.current_phase, "cleaning");
      assert.deepEqual(blocked.cleanup_blocker?.paths, [
        { path: "node_modules", kind: "directory", category: "ignored" },
      ]);
      assert.ok(blocked.delivery_receipt);
    } else await assert.rejects(run(f.controller.finish(e.issue_id)));
    await access(dir);
    assert.equal((await run(f.work.show(e.issue_id))).status, "in_progress");
  });
}

test("a broadened registration cannot authorize old cleanup; removal retry refuses replacement directories", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, ["node_modules"]);
  await mkdir(join(e.worktree_directory!, "node_modules"));
  await mkdir(join(e.worktree_directory!, "notes"));
  await writeFile(join(e.worktree_directory!, "notes/private"), "retain");
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.generated_paths = [Id.RelativePath.make("node_modules"), Id.RelativePath.make("notes")];
  await run(f.records.saveProject(p));
  const blocked = await run(f.controller.finish(e.issue_id));
  assert.equal(blocked.current_phase, "cleaning");
  assert.deepEqual(blocked.effective_policy.generated_paths, ["node_modules"]);
  assert.equal(blocked.cleanup_blocker?.paths[0].path, "notes");
  await access(join(e.worktree_directory!, "notes/private"));
  await rm(join(e.worktree_directory!, "notes"), { recursive: true });
  await mkdir(join(e.worktree_directory!, "node_modules"));
  await assert.rejects(run(f.controller.finish(e.issue_id)), /replaced/);
});

test("lost native removal response reconciles absence without another removal and closes original claim", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, []);
  const remove = f.runtime.removeWorktree;
  let calls = 0;
  f.runtime.removeWorktree = (p, record) =>
    Effect.gen(function* () {
      calls++;
      yield* remove(p, record);
      return yield* new CrewError("LOST", "Removal response lost");
    });
  await assert.rejects(run(f.controller.finish(e.issue_id)), /lost/);
  const done = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(done.current_phase, "completed");
  assert.equal(calls, 1);
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
  assert.ok(done.delivery_receipt);
  assert.equal(done.apply_session_id, e.apply_session_id);
});

test("a replacement worktree at the original path is retained", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, []),
    moved = `${e.worktree_directory}-original`;
  await rename(e.worktree_directory!, moved);
  await mkdir(e.worktree_directory!);
  await writeFile(join(e.worktree_directory!, "private"), "retain");
  await assert.rejects(run(f.controller.finish(e.issue_id)));
  await access(join(e.worktree_directory!, "private"));
});

test("cleanup waits back off, deduplicate attention, survive restart and finish without another merge", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, []);
  e.supervisor_session_id = Id.SessionId.make("ses_supervisor");
  f.runtime.sessions.set(e.supervisor_session_id, {
    id: e.supervisor_session_id,
    directory: f.config.home,
    busy: false,
  });
  await run(f.records.save(e));
  await mkdir(join(e.worktree_directory!, "notes"));
  await writeFile(join(e.worktree_directory!, "notes/private"), "retain secret contents");
  let merges = 0;
  f.delivery.merge = () => {
    merges++;
    return Effect.fail(new CrewError("DUPLICATE", "Must not merge again"));
  };
  const clock = await run(TestClock.make());
  const updates: ProgressUpdate[] = [];
  const timed = <A>(effect: Effect.Effect<A, CrewError>) =>
    run(
      effect.pipe(
        Effect.provideService(Clock.Clock, clock),
        Effect.provideService(ToolProgress, (update) =>
          Effect.sync(() => {
            updates.push(update);
          }),
        ),
      ),
    );
  const first = await timed(
    deliveryAction(f.controller.queries, e.issue_id, "finish", f.controller.finish(e.issue_id)),
  );
  assert.ok("current_phase" in first);
  assert.equal(first.current_phase, "cleaning");
  assert.equal(first.outcome.delivery.state, "verified");
  assert.equal(first.outcome.cleanup.state, "blocked");
  assert.equal(first.outcome.closure, "open");
  assert.ok(!updates.some((u) => u.stage === "cleanup" && u.status === "completed"));
  assert.equal(first.cleanup_blocker!.next_check_at - first.cleanup_blocker!.observed_at, 30000);
  assert.equal(first.error_or_recovery_reason, undefined);
  await timed(f.controller.supervise());
  const prompts = f.runtime.prompts;
  await timed(f.controller.supervise());
  assert.equal(f.runtime.prompts, prompts);
  assert.equal(
    (await run(f.controller.get(e.issue_id))).attention!.filter((a) => a.code === "decision_pending")
      .length,
    1,
  );
  const restart = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(restart.close()));
  const skipped = (await timed(restart.reconcile(e.issue_id)))[0];
  assert.equal(skipped.cleanup_blocker!.attempts, 1);
  let current = skipped;
  for (const delay of [60000, 120000, 240000, 300000]) {
    await run(clock.setTime(current.cleanup_blocker!.next_check_at));
    current = (await timed(restart.reconcile(e.issue_id)))[0];
    assert.equal(current.current_phase, "cleaning");
    assert.equal(
      current.cleanup_blocker!.next_check_at - current.cleanup_blocker!.observed_at,
      delay,
    );
    await timed(restart.supervise());
    assert.equal(f.runtime.prompts, prompts);
  }
  const detail = await timed(new Visibility(restart).detail(e.issue_id));
  assert.equal(detail.work.outcome!.delivery.state, "verified");
  assert.equal(detail.work.outcome!.cleanup.state, "blocked");
  assert.ok(!JSON.stringify(detail.work.outcome).includes("retain secret contents"));
  const refreshed = await timed(restart.finish(e.issue_id));
  assert.ok(
    refreshed.cleanup_blocker!.attempts > current.cleanup_blocker!.attempts,
    "explicit finish bypasses backoff",
  );
  await timed(restart.control(e.issue_id, "pause"));
  const paused = await run(restart.get(e.issue_id));
  await run(clock.setTime(paused.cleanup_blocker!.next_check_at + 1));
  assert.equal((await timed(restart.reconcile(e.issue_id)))[0].current_phase, "interrupted");
  await timed(restart.control(e.issue_id, "resume"));
  await rm(join(e.worktree_directory!, "notes"), { recursive: true });
  await writeFile(join(e.worktree_directory!, "new-output"), "not authorized by old sample");
  current = await timed(restart.finish(e.issue_id));
  assert.equal(current.current_phase, "cleaning");
  assert.equal(current.cleanup_blocker!.paths[0].path, "new-output");
  assert.equal(current.cleanup_blocker!.paths[0].category, "untracked");
  await rm(join(e.worktree_directory!, "new-output"));
  const done = await timed(restart.finish(e.issue_id));
  assert.equal(done.current_phase, "completed");
  assert.equal(done.cleanup_blocker, undefined);
  assert.ok(updates.some((u) => u.stage === "cleanup" && u.status === "completed"));
  assert.equal(done.retirement!.native, "confirmed");
  assert.ok(
    done
      .attention!.filter((a) => a.code === "cleanup_blocked")
      .every((a) => a.status === "superseded"),
  );
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
  assert.equal(merges, 0);
});

test("cleanup samples preserve odd filenames, bound output and refuse failed inspection", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, []);
  const odd = "$(touch never)\n\u001b[31m note";
  await writeFile(join(e.worktree_directory!, odd), "private");
  await symlink(f.root, join(e.worktree_directory!, "external-link"));
  let sample = (await run(inspectCleanup(f.git, e.worktree_directory!)))!;
  assert.ok(sample.paths.some((p) => p.path === odd));
  assert.ok(sample.paths.some((p) => p.path === "external-link"));
  await Promise.all(
    Array.from({ length: 70 }, (_, i) =>
      writeFile(join(e.worktree_directory!, `output-${i}`), "private"),
    ),
  );
  sample = (await run(inspectCleanup(f.git, e.worktree_directory!)))!;
  assert.equal(sample.truncated, true);
  assert.ok(sample.paths.length <= 64);
  assert.ok(Buffer.byteLength(JSON.stringify(sample.paths)) <= 16384);
  // Enter cleanup with preservation already verified; pre-preservation drift remains a refusal.
  e.delivery_receipt = {
    commit: e.delivered_commit!,
    target: e.target_branch!,
    at: Id.timestampAt(0),
  };
  e.current_phase = "cleaning";
  await run(f.records.save(e));
  const original = f.git.run.bind(f.git);
  for (const error of ["COMMAND_OUTPUT_LIMIT", "COMMAND_FAILED"]) {
    f.git.run = (root, args, options) =>
      args.includes("ls-files")
        ? Effect.fail(new CrewError(error, "Inventory unavailable"))
        : original(root, args, options);
    await assert.rejects(run(f.controller.finish(e.issue_id)), /Inventory unavailable/);
    await access(e.worktree_directory!);
  }
  f.git.run = original;
  await writeFile(join(e.worktree_directory!, "source.txt"), "tracked drift");
  await assert.rejects(run(f.controller.finish(e.issue_id)), /changed/);
});

test("legacy unsafe recovery is not resumed from ignored-file error text", async (t) => {
  const f = await runFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await prepare(f, []);
  e.delivery_receipt = {
    commit: e.delivered_commit!,
    target: e.target_branch!,
    at: Id.timestampAt(0),
  };
  e.current_phase = "recovery_required";
  e.resume_phase = "cleaning";
  e.error_or_recovery_reason = "Unapproved ignored files prevent cleanup";
  await run(f.records.save(e));
  const observed = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(observed.current_phase, "recovery_required");
  assert.equal(observed.cleanup_blocker, undefined);
  await access(e.worktree_directory!);
});
