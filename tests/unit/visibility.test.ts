import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned } from "../fixtures.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility } from "../../src/visibility/protocol.ts";
test("observer joins WorkGraph, blockers and role sessions without advancing a waiting plan", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  f.work.add(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"), [e.issue_id]);
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const snapshot = await run(view.snapshot());
  const active = snapshot.work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(active.issue_status, "in_progress");
  assert.equal(active.phase, "awaiting_plan_approval");
  assert.deepEqual(active.sessions, [{ id: e.explore_session_id, role: "explore" }]);
  assert.match(snapshot.work.find((w) => w.issue_id === "abra-2")!.blockers.join(" "), /abra-1/);
  const detail = await run(view.detail(e.issue_id));
  assert.equal(detail.change, e.openspec_change);
  assert.equal(detail.progress?.complete, 0);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.runtime.forms.size, 0);
  assert.ok("value" in (await visibility.methods.snapshot.output["~standard"].validate(snapshot)));
  assert.ok("value" in (await visibility.methods.detail.output["~standard"].validate(detail)));
});
test("proposal reads the owned worktree and schema artifact path, rejecting escaping symlinks", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  const view = new Visibility(f.controller);
  const path = join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md");
  assert.equal((await run(view.detail(e.issue_id))).proposal, await readFile(path, "utf8"));
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, "Do not expose this unrelated file");
  await rm(path);
  await symlink(outside, path);
  const denied = await run(view.detail(e.issue_id));
  assert.equal(denied.proposal, undefined);
  assert.match(denied.errors.join(" "), /escapes/);
  assert.ok(!JSON.stringify(denied).includes("Do not expose"));
  assert.throws(() => Id.IssueId.make("../outside"), /Schema validation/);
});
test("queued and retired work do not invoke OpenSpec; large proposals are bounded", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-queued"));
  const view = new Visibility(f.controller);
  assert.equal((await run(view.detail(Id.IssueId.make("abra-queued")))).change, undefined);
  const e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  await writeFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md"),
    "x".repeat(70 * 1024),
  );
  assert.equal(
    (await run(view.detail(e.issue_id))).proposal,
    "x".repeat(64 * 1024) + "\n[Proposal truncated at 64 KiB]",
  );
  e.archive_path = Id.RelativePath.make(`openspec/changes/archive/2026-10-14-${e.openspec_change}`);
  e.delivered_commit ??= await run(f.git.head(e.worktree_directory!));
  e.delivery_receipt = {
    commit: e.delivered_commit,
    target: e.target_branch!,
    at: Id.Timestamp.make(new Date().toISOString()),
  };
  e.current_phase = "completed";
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  f.spec.status = () =>
    domainEffect(
      Effect.fail(new CrewError("FIXTURE_FAILURE", "Retired worktree must not be read")),
    );
  const archived = await run(view.detail(e.issue_id));
  assert.equal(archived.archive, e.archive_path);
  assert.deepEqual(archived.errors, []);
  assert.equal(
    (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)?.issue_status,
    "closed",
  );
});

test("document selection stays inside the planning change and retired work is paged with conflicts visible", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const view = new Visibility(f.controller);
  const detail = await run(view.detail(e.issue_id));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("design.md")));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("specs/sample/spec.md")));
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("design.md")))).content,
    /Return a sample/,
  );
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("specs/sample/spec.md")))).content,
    /Sample behavior/,
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("../../../../source.txt"))),
    /owned change/,
  );
  const outside = join(f.root, "private.md");
  await writeFile(outside, "private planning content");
  await symlink(
    outside,
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "escape.md"),
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("escape.md"))),
    /owned change/,
  );
  for (let i = 0; i < 56; i++) {
    const id = `closed-${String(i).padStart(2, "0")}`;
    f.work.add(Id.IssueId.make(id));
    f.work.issues.get(id)!.status = "closed";
  }
  // A closed ticket with a live execution is attention work on every history page.
  f.work.issues.get(e.issue_id)!.status = "closed";
  const first = await run(view.snapshot());
  const second = await run(view.snapshot(1));
  assert.equal(first.closed_total, 56);
  assert.equal(first.work.filter((w) => w.issue_id.startsWith("closed-")).length, 50);
  assert.equal(second.work.filter((w) => w.issue_id.startsWith("closed-")).length, 6);
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.issue_status, "closed");
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.phase, "awaiting_plan_approval");
  assert.equal((await run(view.snapshot(100))).closed_page, 1);
});

test("bounded supervision projection preserves record history and exposes read-only report access", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  e.decisions = Array.from({ length: 25 }, (_, i) => ({
    schema_version: 1,
    key: Id.ObligationKey.make(`question-${i}`),
    generation: 0,
    scope: "Implementation",
    question: `Question ${i}`,
    owner: "user",
    session_id: e.explore_session_id!,
    opened_at: i,
    status: "open",
  }));
  e.progress = {
    schema_version: 1,
    generation: 0,
    session_id: e.explore_session_id!,
    at: 30,
    summary: "Meaningful progress",
    source: "worker",
  };
  await run(f.records.save(e));
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const item = (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(item.decisions!.length, 20);
  assert.equal(item.decision_count, 25);
  assert.equal(item.progress!.summary, "Meaningful progress");
  assert.ok(item.policy_summary);
  assert.ok(item.operation);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.deepEqual(Object.keys(visibility.methods).sort(), [
    "detail",
    "diff",
    "document",
    "feedback",
    "report",
    "snapshot",
    "worker",
  ]);
});

test("each observer request scans each durable collection once and later requests see new data", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const counts = { project: 0, execution: 0, setup: 0 };
  const project = f.records.projectScan.bind(f.records),
    execution = f.records.executionScan.bind(f.records),
    setup = f.records.setupScan.bind(f.records);
  f.records.projectScan = () => {
    counts.project++;
    return project();
  };
  f.records.executionScan = () => {
    counts.execution++;
    return execution();
  };
  f.records.setupScan = () => {
    counts.setup++;
    return setup();
  };
  const view = new Visibility(f.controller);
  await run(view.detail(e.issue_id));
  assert.deepEqual(counts, { project: 1, execution: 1, setup: 1 });
  f.work.add(Id.IssueId.make("later"));
  assert.ok((await run(view.snapshot())).work.some((w) => w.issue_id === "later"));
  assert.deepEqual(counts, { project: 2, execution: 2, setup: 2 });
});

test("commit invalidations observe durable evidence and failed writes do not enqueue", async (t) => {
  const { Invalidations } = await import("../../src/visibility/invalidations.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  let commits = 0;
  const events = {
    committed: f.records.execution(e.issue_id).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          assert.ok(saved);
          commits++;
        }),
      ),
      Effect.asVoid,
      Effect.orDie,
    ),
    take: Effect.never,
  };
  await run(f.records.save(e).pipe(Effect.provideService(Invalidations, events)));
  assert.equal(commits, 1);
  const stale = { ...e, control_generation: e.control_generation + 10 };
  await assert.rejects(
    run(f.records.save(stale).pipe(Effect.provideService(Invalidations, events))),
    /generation/,
  );
  assert.equal(commits, 1);
});
