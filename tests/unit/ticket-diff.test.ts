import * as Id from "../../src/identities.ts";
import { applyPatch } from "diff";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../effects.ts";
import { fixture, planned } from "../fixtures.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility, type WorkItem } from "../../src/visibility/protocol.ts";
import { section } from "../../src/visibility/presentation.ts";

test("ticket diff covers commits, staged, unstaged and untracked files without mutating the index", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const tree = e.worktree_directory!;
  const view = new Visibility(f.controller);
  await writeFile(join(tree, "source.txt"), "committed\n");
  await run(f.git.run(tree, ["add", "source.txt"]));
  await run(f.git.run(tree, ["commit", "-m", "Implementation"]));
  await writeFile(join(tree, "source.txt"), "staged\n");
  await run(f.git.run(tree, ["add", "source.txt"]));
  await writeFile(join(tree, "source.txt"), "working\n");
  await writeFile(join(tree, "new.ts"), "export const added = true;\n");
  const index = await run(f.git.run(tree, ["rev-parse", "--git-path", "index"]));
  const before = await readFile(index);
  const all = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.match(all.patch!, /-original\n\+working/);
  assert.equal(all.base, e.base_commit);
  assert.ok(all.files.some((file) => file.path === "new.ts" && file.status === "added"));
  assert.ok(all.files.some((file) => file.path.endsWith("proposal.md")));
  const local = await run(view.diff(e.issue_id, "uncommitted", Id.RelativePath.make("source.txt")));
  assert.match(local.patch!, /-committed\n\+working/);
  const added = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("new.ts")));
  assert.match(added.patch!, /\+export const added = true;/);
  assert.deepEqual(await readFile(index), before);
  assert.ok("value" in (await visibility.methods.diff.output["~standard"].validate(added)));
  assert.equal(
    (await run(f.records.execution(e.issue_id)))?.current_phase,
    "awaiting_plan_approval",
  );
});

test("diff handles deletion, binary data, bounded patches and escaping untracked links", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const tree = e.worktree_directory!;
  const view = new Visibility(f.controller);
  await rm(join(tree, "source.txt"));
  const deleted = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.equal(deleted.files.find((f) => f.path === "source.txt")?.status, "deleted");
  assert.match(deleted.patch!, /-original/);
  await writeFile(join(tree, "source.txt"), Buffer.from([0, 1, 2]));
  const binary = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.ok(binary.files.find((f) => f.path === "source.txt")?.binary);
  assert.equal(binary.patch, undefined);
  assert.match(binary.message!, /Binary/);
  await writeFile(join(tree, "source.txt"), "large".repeat(15000));
  const large = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.equal(large.patch, undefined);
  assert.match(large.message!, /64 KiB/);
  const outside = join(f.root, "private.txt");
  await writeFile(outside, "unrelated-private-data");
  await symlink(outside, join(tree, "outside.md"));
  const link = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("outside.md")));
  assert.equal(link.patch, undefined);
  assert.ok(link.files.find((f) => f.path === "outside.md")?.limited);
  const denied = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("../../private.txt")));
  assert.equal(denied.patch, undefined);
  assert.ok(!JSON.stringify(denied).includes("unrelated-private-data"));
});

test("retired tickets use retained base/delivery objects; queued tickets have an explicit empty state", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-queued"));
  const view = new Visibility(f.controller);
  assert.match(
    (await run(view.diff(Id.IssueId.make("abra-queued"), "all"))).message!,
    /No worktree/,
  );
  const e = await run(planned(f));
  await writeFile(join(e.worktree_directory!, "source.txt"), "delivered\n");
  await run(f.git.run(e.worktree_directory!, ["add", "."]));
  await run(f.git.run(e.worktree_directory!, ["commit", "-m", "Delivered"]));
  e.delivered_commit = await run(f.git.head(e.worktree_directory!));
  e.delivered_commit ??= await run(f.git.head(e.worktree_directory!));
  e.delivery_receipt = {
    commit: e.delivered_commit,
    target: e.target_branch!,
    at: Id.Timestamp.make(new Date().toISOString()),
  };
  e.current_phase = "completed";
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  await run(f.runtime.removeWorktree((await run(f.records.project(e.repository_id)))!, e));
  const history = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.ok(history.historical);
  assert.match(history.patch!, /-original\n\+delivered/);
  assert.match((await run(view.diff(e.issue_id, "uncommitted"))).message!, /retirement/);
});

test("display sections distinguish actionable gates, activity, dependency blocks, capacity and closure", () => {
  const item: WorkItem = {
    issue_id: Id.IssueId.make("abra-1"),
    title: "Example",
    priority: 2,
    issue_status: "open",
    sessions: [],
    eligible: true,
    blockers: [],
  };
  const classify = (changes: Partial<WorkItem>) => section({ ...item, ...changes });
  assert.equal(classify({}), "queued");
  assert.equal(
    classify({ eligible: false, blocker_details: [{ code: "capacity", message: "full" }] }),
    "queued",
  );
  assert.equal(
    classify({ eligible: false, blocker_details: [{ code: "dependency", message: "waiting" }] }),
    "blocked",
  );
  assert.equal(
    classify({
      phase: "applying",
      issue_status: "in_progress",
      eligible: false,
      blocker_details: [
        { code: "execution", message: "resume" },
        { code: "status", message: "in progress" },
      ],
    }),
    "working",
  );
  for (const phase of ["awaiting_plan_approval", "awaiting_merge", "recovery_required"] as const)
    assert.equal(classify({ phase }), "attention");
  for (const phase of ["failed", "interrupted", "blocked"] as const)
    assert.equal(classify({ phase }), "blocked");
  assert.equal(classify({ phase: "completed", issue_status: "closed" }), "done");
  assert.equal(classify({ phase: "applying", issue_status: "closed" }), "attention");
  const future = { phase: "queued" as const };
  Reflect.set(future, "phase", "future-phase");
  assert.equal(classify(future), "other");
  assert.equal(classify({ phase: "completed", issue_status: "in_progress" }), "attention");
});

test("diff preserves whitespace and merges a staged deletion with its recreated untracked file", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const tree = e.worktree_directory!;
  const view = new Visibility(f.controller);
  await run(f.git.run(tree, ["rm", "source.txt"]));
  await writeFile(join(tree, "source.txt"), "original\n");
  const same = await run(view.diff(e.issue_id, "all"));
  assert.ok(!same.files.some((file) => file.path === "source.txt"));
  await writeFile(join(tree, "source.txt"), "  original changed  \n\n");
  const recreated = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.equal(recreated.files.filter((file) => file.path === "source.txt").length, 1);
  assert.equal(recreated.files.find((file) => file.path === "source.txt")?.status, "modified");
  assert.equal(applyPatch("original\n", recreated.patch!), "  original changed  \n\n");
  await run(f.git.run(tree, ["add", "source.txt"]));
  const tracked = await run(view.diff(e.issue_id, "all", Id.RelativePath.make("source.txt")));
  assert.equal(applyPatch("original\n", tracked.patch!), "  original changed  \n\n");
});

test("routine CI waits stay out of recovery while durable questions and expired waits identify their owner", () => {
  const base: WorkItem = {
    issue_id: Id.IssueId.make("abra-1"),
    title: "Example",
    priority: 2,
    issue_status: "in_progress",
    phase: "awaiting_merge",
    sessions: [],
    eligible: false,
    blockers: [],
  };
  const waiting = {
    ...base,
    delivery_wait: {
      category: "waiting" as const,
      code: Id.ErrorCode.make("CI_PENDING"),
      reason: "Required check pending",
      owner: "CI",
      fingerprint: Id.Commit.make("a".repeat(40)),
      attempts: 1,
      observed_at: 0,
      next_check_at: 30000,
    },
  };
  assert.equal(section(waiting), "working");
  const question = {
    schema_version: 1 as const,
    key: Id.ObligationKey.make("format"),
    generation: 0,
    scope: "Persistence",
    question: "Which format?",
    owner: "user" as const,
    session_id: Id.SessionId.make("ses_worker"),
    opened_at: 0,
    status: "open" as const,
  };
  assert.equal(section({ ...waiting, decisions: [question] }), "attention");
  assert.equal(section({ ...base, phase: "researching", delivery_wait: undefined }), "working");
  assert.equal(
    section({
      ...base,
      waits: [
        {
          schema_version: 1,
          key: Id.ObligationKey.make("dep"),
          generation: 0,
          kind: "dependency",
          reference: Id.IssueId.make("abra-2"),
          condition: "Dependency closed",
          owner: "deployment owner",
          expires_in_ms: 1000,
          session_id: Id.SessionId.make("ses_worker"),
          started_at: 0,
          expires_at: 1000,
          next_check_at: 1000,
          status: "expired",
        },
      ],
    }),
    "attention",
  );
});
