import * as Id from "../../src/identities.ts";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { run } from "../effects.ts";
import { delivered, fixture } from "../fixtures.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { forgeFixture } from "../forge.ts";
import { CrewError } from "../../src/domain.ts";

for (const mode of ["standing", "human", "review"] as const) {
  test(`${mode}: pending delivery resumes after restart without new authorization`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    project.merge_approval = mode === "human";
    await run(f.records.saveProject(project));
    const e = await run(delivered(f));
    let pr: PR = {
      url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
      state: "OPEN",
      headRefOid: e.delivered_commit!,
      baseRefName: Id.BranchName.make("main"),
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: mode === "review" ? "REVIEW_REQUIRED" : "APPROVED",
      statusCheckRollup: [{ status: "IN_PROGRESS" }],
    };
    let reads = 0,
      merges = 0;
    e.pull_request_reference = pr.url;
    await run(f.records.save(e));
    const forge = forgeFixture(
      (await run(f.records.project(Id.RepositoryId.make("api"))))!,
      () => pr,
    );
    forge.config.onMerge = () => {
      merges++;
      pr = { ...pr, state: "MERGED" };
    };
    const delivery = new GitHubDelivery(
      f.git,
      {
        run: (...args) => {
          reads++;
          return forge.runner.run(...args);
        },
      },
      Id.Executable.make("fake-forge"),
    );
    // Preservation is a separate seam: no real forge or user remote is touched.
    delivery.evidence = () =>
      Effect.succeed({
        commit: e.delivered_commit!,
        target: Id.BranchName.make("main"),
        at: Id.Timestamp.make("2026-10-16T10:00:00.000Z"),
      });
    const controller = () =>
      new Controller(f.config, f.records, f.work, f.spec, f.git, f.runtime, delivery, f.locks);
    const clock = await run(TestClock.make());
    const observe = () =>
      run(controller().reconcile(e.issue_id).pipe(Effect.provideService(Clock.Clock, clock)));
    if (mode === "human") {
      const pending = await run(
        controller().approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
      );
      assert.ok("form_id" in pending);
      f.runtime.forms.set(pending.form_id, "approved");
    }
    const first = (await observe())[0];
    assert.equal(first.current_phase, "awaiting_merge");
    assert.ok(first.delivery_wait);
    assert.equal(f.work.issues.get(e.issue_id)!.status, "in_progress");
    const receipts = structuredClone(first.approval_receipts);
    const count = reads;
    await observe();
    assert.equal(reads, count, "unchanged wait must respect next observation time");
    await run(clock.setTime(first.delivery_wait.next_check_at));
    pr.statusCheckRollup = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
    pr.reviewDecision = "APPROVED";
    const done = (await observe())[0];
    assert.equal(done.current_phase, "completed");
    assert.deepEqual(done.approval_receipts, receipts);
    assert.equal(merges, 1);
    assert.equal(done.delivery_wait, undefined);
  });
}

test("delivery waits preserve pauses, retry transient observations and refuse changed heads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.merge_approval = false;
  await run(f.records.saveProject(project));
  const e = await run(delivered(f));
  let broken = true;
  let reads = 0;
  const pr: PR = {
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [{ status: "IN_PROGRESS" }],
  };
  e.pull_request_reference = pr.url;
  await run(f.records.save(e));
  const forge = forgeFixture(
    (await run(f.records.project(Id.RepositoryId.make("api"))))!,
    () => pr,
  );
  const delivery = new GitHubDelivery(
    f.git,
    {
      run: (...args) => {
        reads++;
        return broken
          ? Effect.fail(new CrewError("COMMAND_FAILED", "Transport unavailable"))
          : forge.runner.run(...args);
      },
    },
    Id.Executable.make("fake-forge"),
  );
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    delivery,
    f.locks,
  );
  const clock = await run(TestClock.make());
  const observe = () =>
    run(c.reconcile(e.issue_id).pipe(Effect.provideService(Clock.Clock, clock)));
  let current = (await observe())[0];
  assert.equal(current.current_phase, "awaiting_merge");
  assert.equal(current.delivery_wait?.category, "retryable");
  broken = false;
  await run(clock.setTime(current.delivery_wait!.next_check_at));
  current = (await observe())[0];
  assert.equal(current.delivery_wait?.category, "waiting");
  await run(c.control(e.issue_id, "pause"));
  const count = reads;
  await run(clock.setTime(current.delivery_wait!.next_check_at));
  assert.equal((await observe())[0].current_phase, "interrupted");
  assert.equal(reads, count);
  current = await run(c.get(e.issue_id));
  current.current_phase = "awaiting_merge";
  await run(f.records.save(current));
  pr.headRefOid = Id.Commit.make("f".repeat(40));
  const refused = (await observe())[0];
  assert.equal(refused.current_phase, "recovery_required");
  assert.match(refused.error_or_recovery_reason!, /head/);
});
