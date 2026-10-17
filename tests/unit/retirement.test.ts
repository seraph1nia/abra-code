import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, access, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { Schema, Effect } from "effect";
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
  const e = await run(delivered(f));
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  await writeFile(join(e.worktree_directory!, ".gitignore"), "node_modules/\ndist/\nnotes/\n");
  await run(f.git.run(e.worktree_directory!, ["add", ".gitignore"]));
  await run(f.git.run(e.worktree_directory!, ["commit", "-m", "Ignore fixture leftovers"]));
  e.delivered_commit = await run(f.git.head(e.worktree_directory!));
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
        await run(f.records.save(e));
      }
    }
    await assert.rejects(run(f.controller.finish(e.issue_id)));
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
  await assert.rejects(run(f.controller.finish(e.issue_id)), /ignored/i);
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
