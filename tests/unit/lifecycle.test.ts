import { failedSpec } from "../helpers/spec-review.ts";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned, applying, delivered } from "../fixtures.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { Scheduler } from "../../src/scheduler/scheduler.ts";
test("onboards three independent repositories, preserving instructions and stable identity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  assert.equal((await run(f.records.projects())).length, 3);
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await writeFile(join(p.path, "AGENTS.md"), "Existing instructions");
  const r = await run(f.onboarding.inspect(p));
  assert.equal(r.inspection.agents_md, true);
  assert.equal(r.project.path, p.path);
  await assert.rejects(
    run(f.onboarding.register({ ...p, id: Id.RepositoryId.make("duplicate") }, false)),
    /already registered/,
  );
});
test("cross-repository dependency readiness and deterministic priority", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"), Id.RepositoryId.make("api"));
  f.work.add(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"), [
    Id.IssueId.make("abra-1"),
  ]);
  f.work.add(Id.IssueId.make("abra-3"), Id.RepositoryId.make("worker"), [
    Id.IssueId.make("abra-2"),
  ]);
  assert.deepEqual(
    (await run(f.controller.ready())).filter((x) => x.eligible).map((x) => x.issue.id),
    ["abra-1"],
  );
  await assert.rejects(
    run(f.controller.start(Id.IssueId.make("abra-2"))),
    (error) =>
      (
        error as {
          code: string;
        }
      ).code === "NOT_READY",
  );
  assert.equal(
    (await run(f.controller.ready()))
      .find((x) => x.issue.id === "abra-2")!
      .dependencies.map(
        (d) =>
          (
            d as {
              id: string;
            }
          ).id,
      )
      .join(","),
    "abra-1",
  );
});
test("duplicate starts and concurrent supervisors cannot create two writers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const results = await Promise.allSettled([
    run(f.controller.start(Id.IssueId.make("abra-1"))),
    run(f.controller.start(Id.IssueId.make("abra-1"))),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.work.claims, 1);
  const e = await run(f.controller.start(Id.IssueId.make("abra-1")));
  assert.equal(f.runtime.trees.length, 1);
  assert.equal(f.runtime.creates, 1);
  assert.ok(e.explore_session_id);
});
test("native-owned issue worktree survives Explore and Apply", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  assert.equal(e.current_phase, "applying");
  assert.equal(
    f.runtime.sessions.get(e.explore_session_id!)!.directory,
    f.runtime.sessions.get(e.apply_session_id!)!.directory,
  );
  assert.equal(await run(f.git.run(e.worktree_directory!, ["branch", "--show-current"])), e.branch);
  assert.equal(f.runtime.trees.length, 1);
});
test("rejects incomplete or invalid planning artifacts", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1")));
  f.runtime.success(e.explore_session_id!);
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /incomplete/);
  assert.equal((await run(f.controller.get(Id.IssueId.make("abra-1")))).current_phase, "blocked");
  assert.equal(f.runtime.creates, 1);
});
test("strict validation failure prevents plan approval", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1")));
  f.spec.planned = true;
  f.spec.valid = false;
  f.runtime.success(e.explore_session_id!);
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /Invalid OpenSpec/);
  assert.equal(f.runtime.creates, 1);
});
test("pending human form does not authorize Apply and workers cannot self-approve", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /approval/);
  await run(f.controller.control(Id.IssueId.make("abra-1"), "retry")).catch(() => {});
  const record = await run(f.controller.get(Id.IssueId.make("abra-1")));
  record.current_phase = "awaiting_plan_approval";
  await run(f.records.save(record));
  await assert.rejects(
    run(f.controller.approve(Id.IssueId.make("abra-1"), "plan", e.explore_session_id!)),
    /cannot authorize/,
  );
  const pending = (await run(
    f.controller.approve(Id.IssueId.make("abra-1"), "plan", Id.SessionId.make("ses_supervisor")),
  )) as {
    approval_required: boolean;
  };
  assert.equal(pending.approval_required, true);
  assert.equal(f.runtime.creates, 1);
});
test("unfinished implementation tasks reject false completion and retain worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /unfinished/);
  await access(e.worktree_directory!);
  assert.equal(f.work.issues.get("abra-1")!.status, "blocked");
});
test("failed repository checks block review, archive, and delivery", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.verification = [[process.execPath, "-e", "process.exit(7)"]];
  await run(f.records.saveProject(p));
  const e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(
    run(f.controller.advance(Id.IssueId.make("abra-1"))),
    /COMMAND|Command|node/,
  );
  assert.equal(f.delivery.calls, 0);
  assert.equal(f.runtime.creates, 2);
});
test("failed independent Review blocks delivery", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(Id.IssueId.make("abra-1")));
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "Missing error handling",
      "in_scope",
      failedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /Review failed/);
  assert.equal(f.delivery.calls, 0);
});
test("server restart reconciles interrupted session, reuses session and worktree on resume", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  await run(f.runtime.interrupt(e.apply_session_id!));
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
  assert.equal(
    (await run(restarted.reconcile(Id.IssueId.make("abra-1"))))[0].current_phase,
    "interrupted",
  );
  const resumed = await run(restarted.control(Id.IssueId.make("abra-1"), "resume"));
  assert.equal(resumed.apply_session_id, e.apply_session_id);
  assert.equal(resumed.worktree_directory, e.worktree_directory);
  assert.equal(f.runtime.creates, 2);
});
test("claim recovery handles rollback, lost response and a crash before claiming without duplicating workers", async (t) => {
  for (const checkpoint of ["before", "after", "crash"] as const) {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    f.work.add(Id.IssueId.make("claim-recovery"));
    const claim = f.work.claim;
    f.work.claim = (id, actor) =>
      domainEffect(
        Effect.gen(function* () {
          if (checkpoint === "after") yield* claim(id, actor);
          return yield* new CrewError("FIXTURE_FAILURE", "Claim response lost");
        }),
      );
    await assert.rejects(
      run(
        f.controller.start(Id.IssueId.make("claim-recovery"), Id.SessionId.make("ses_supervisor")),
      ),
      /Claim response lost/,
    );
    f.work.claim = claim;
    const saved = (await run(f.records.execution(Id.IssueId.make("claim-recovery"))))!;
    let recovered;
    if (checkpoint === "crash") {
      saved.current_phase = "claiming";
      await run(f.records.save(saved));
      [recovered] = await run(f.controller.reconcile(saved.issue_id));
    } else recovered = await run(f.controller.control(saved.issue_id, "retry"));
    assert.equal(recovered.current_phase, "exploring");
    assert.equal((await run(f.work.show(saved.issue_id))).assignee, saved.execution_id);
    assert.equal(f.work.claims, 1);
    assert.equal(f.runtime.creates, 1);
  }
});
test("merge authorization required and incomplete delivery preserves worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  await assert.rejects(run(f.controller.finish(Id.IssueId.make("abra-1"))), /authorization/);
  await access(e.worktree_directory!);
  assert.equal(f.work.issues.get("abra-1")!.status, "in_progress");
  assert.equal(f.delivery.merged, false);
});
test("merge, safe cleanup and WorkGraph closure unblock cross-repository dependent work", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"), [
    Id.IssueId.make("abra-1"),
  ]);
  const e = await run(delivered(f));
  const pending = (await run(
    f.controller.approve(Id.IssueId.make("abra-1"), "merge", Id.SessionId.make("ses_supervisor")),
  )) as {
    form_id: string;
  };
  f.runtime.forms.set(Id.FormId.make(pending.form_id), "approved");
  const accepted = await run(
    f.controller.approve(Id.IssueId.make("abra-1"), "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("current_phase" in accepted);
  assert.equal(accepted.current_phase, "awaiting_merge");
  assert.equal(f.delivery.merged, false);
  const done = (await run(f.controller.reconcile(Id.IssueId.make("abra-1"))))[0];
  assert.equal(done.current_phase, "completed");
  await assert.rejects(access(e.worktree_directory!));
  assert.equal(f.work.issues.get("abra-1")!.status, "closed");
  assert.equal(
    (await run(f.controller.ready())).find((x) => x.issue.id === "abra-2")!.eligible,
    true,
  );
  assert.equal(f.runtime.sessions.size, 3);
});
test("untracked or ignored work prevents cleanup after externally confirmed merge", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  await writeFile(join(e.worktree_directory!, "unpreserved.txt"), "keep");
  const waiting = await run(f.controller.finish(Id.IssueId.make("abra-1")));
  assert.equal(waiting.current_phase, "awaiting_merge");
  assert.ok(
    waiting.decisions?.some((d) => d.status === "open" && d.finishing_target?.kind === "follow_on"),
  );
  assert.equal(f.work.issues.get("abra-1")!.status, "in_progress");
  await access(e.worktree_directory!);
});
test("cleanup failure remains cleaning, recovery never repeats merge", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  await run(delivered(f));
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  const remove = f.runtime.removeWorktree.bind(f.runtime);
  f.runtime.removeWorktree = () =>
    domainEffect(Effect.fail(new CrewError("FIXTURE_FAILURE", "Removal unavailable")));
  await assert.rejects(run(f.controller.finish(Id.IssueId.make("abra-1"))), /unavailable/);
  assert.equal((await run(f.controller.get(Id.IssueId.make("abra-1")))).current_phase, "cleaning");
  f.runtime.removeWorktree = remove;
  await assert.rejects(run(f.controller.finish(Id.IssueId.make("abra-1"))), {
    code: "CLEANUP_UNKNOWN",
  });
  const pending = await run(f.controller.get(Id.IssueId.make("abra-1")));
  assert.equal(pending.retirement!.native, "requested");
  assert.equal((await run(f.work.show(pending.issue_id))).status, "in_progress");
  // Model the original native request completing; the controller never resubmits it.
  await run(remove((await run(f.records.project(pending.repository_id)))!, pending));
  assert.equal(
    (await run(f.controller.finish(Id.IssueId.make("abra-1")))).current_phase,
    "completed",
  );
});
test("scheduler is opt-in and respects global/per-project capacity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  f.work.add(Id.IssueId.make("abra-2"));
  f.work.add(Id.IssueId.make("abra-3"), Id.RepositoryId.make("frontend"));
  const scheduler = new Scheduler(f.controller);
  assert.equal((await run(scheduler.tick())).length, 0);
  f.config.auto_schedule = true;
  await run(scheduler.tick());
  assert.equal((await run(f.records.executions())).length, 2);
  assert.equal(f.runtime.trees.length, 2);
});
test("phase advancement refuses a simultaneous writer in the same worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  f.runtime.sessions.get(e.explore_session_id!)!.busy = true;
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))), /still runs/);
  assert.equal(f.runtime.creates, 2);
});
test("approval invalidated by changed specifications", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  await writeFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "design.md"),
    "Changed design",
  );
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(
    run(f.controller.advance(Id.IssueId.make("abra-1"))),
    /planning artifacts changed/,
  );
  assert.equal(f.delivery.calls, 0);
});
test("human rejection is durable, blocks WorkGraph, and retry reuses Explore to revise planning", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const pending = (await run(
    f.controller.approve(Id.IssueId.make("abra-1"), "plan", Id.SessionId.make("ses_supervisor")),
  )) as {
    form_id: string;
  };
  f.runtime.forms.set(Id.FormId.make(pending.form_id), "rejected");
  await assert.rejects(
    run(
      f.controller.approve(Id.IssueId.make("abra-1"), "plan", Id.SessionId.make("ses_supervisor")),
    ),
    /rejected/,
  );
  const blocked = await run(f.controller.get(Id.IssueId.make("abra-1")));
  assert.ok(blocked.approval_receipts[0].rejected_at);
  assert.equal(f.work.issues.get("abra-1")!.status, "blocked");
  const resumed = await run(f.controller.control(Id.IssueId.make("abra-1"), "retry"));
  assert.equal(resumed.explore_session_id, e.explore_session_id);
  assert.equal(resumed.current_phase, "planning");
});
test("failed review retry returns findings to existing Apply without simultaneous writers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(Id.IssueId.make("abra-1")));
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "Missing boundary condition",
      "in_scope",
      failedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(Id.IssueId.make("abra-1"))));
  const retry = await run(f.controller.control(Id.IssueId.make("abra-1"), "retry"));
  assert.equal(retry.current_phase, "applying");
  assert.equal(retry.apply_session_id, e.apply_session_id);
  assert.equal(retry.retry_instructions, "Missing boundary condition");
  assert.equal(f.runtime.creates, 3);
});
