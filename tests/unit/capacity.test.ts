import { verifiedSpec } from "../helpers/spec-review.ts";
import * as Id from "../../src/identities.ts";
import { Clock, Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { applying, delivered, fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { loadConfig } from "../../src/config/load.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

test("idle delivery and paused work retain claims/resources while releasing active capacity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.max_workers = 1;
  f.config.max_executions = 3;
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.max_executions = 3;
  await run(f.records.saveProject(p));
  const first = await run(delivered(f));
  assert.equal(first.capacity_reservation, undefined);
  f.work.add(Id.IssueId.make("abra-2"));
  assert.equal(
    (await run(f.controller.ready())).find((r) => r.issue.id === "abra-2")!.eligible,
    true,
  );
  await run(f.controller.start(Id.IssueId.make("abra-2")));
  f.work.add(Id.IssueId.make("abra-3"));
  const blocked = (await run(f.controller.ready())).find((r) => r.issue.id === "abra-3")!;
  assert.ok(
    blocked.blocker_details.some(
      (b) => b.capacity_kind === "active" && b.consuming?.includes(Id.IssueId.make("abra-2")),
    ),
  );
  await run(f.controller.control(Id.IssueId.make("abra-2"), "pause"));
  await run(f.controller.start(Id.IssueId.make("abra-3")));
  f.work.add(Id.IssueId.make("abra-4"));
  const retained = (await run(f.controller.ready())).find((r) => r.issue.id === "abra-4")!;
  assert.ok(
    retained.blocker_details.some(
      (b) => b.capacity_kind === "retained" && b.consuming?.length === 3,
    ),
  );
  assert.equal((await run(f.work.show(first.issue_id))).assignee, first.execution_id);
  assert.equal((await run(f.work.show(first.issue_id))).status, "in_progress");
});

test("Review capacity waits preserve verified content and do not rerun checks", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.max_executions = 4;
  f.config.review_capacity = 1;
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.max_workers = 2;
  p.max_executions = 4;
  await run(f.records.saveProject(p));
  const first = await run(applying(f));
  const second = await run(applying(f, Id.IssueId.make("abra-2")));
  let checks = 0;
  const original = f.git.runner.run.bind(f.git.runner);
  f.git.runner.run = (file, ...args) => {
    if (file === process.execPath) checks++;
    return original(file, ...args);
  };
  f.spec.done = true;
  f.runtime.success(first.apply_session_id!);
  const reviewing = await run(f.controller.advance(first.issue_id));
  f.runtime.success(second.apply_session_id!);
  const waiting = await run(f.controller.advance(second.issue_id));
  assert.equal(waiting.current_phase, "verifying");
  assert.equal(waiting.capacity_wait!.role, "review");
  assert.equal(waiting.review_session_id, undefined);
  assert.ok(waiting.verification_receipt);
  assert.equal(checks, 2);
  await run(
    f.controller.reviewReport(reviewing.review_session_id!, true, "Pass", undefined, verifiedSpec),
  );
  f.runtime.success(reviewing.review_session_id!);
  await run(f.controller.advance(first.issue_id));
  const clock = await run(TestClock.make());
  await run(clock.setTime(Date.now() + 5000));
  const resumed = (
    await run(
      f.controller.reconcile(second.issue_id).pipe(Effect.provideService(Clock.Clock, clock)),
    )
  )[0];
  assert.ok(resumed.review_session_id);
  assert.equal(resumed.active_role, "review");
  assert.equal(checks, 2);
});

test("uncertain prompt admission retains its active reservation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.max_workers = 1;
  f.config.max_executions = 2;
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.max_executions = 2;
  await run(f.records.saveProject(p));
  const entered = Deferred.makeUnsafe<void>();
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (id, text, messageID) =>
    prompt(id, text, messageID).pipe(
      Effect.andThen(Deferred.succeed(entered, undefined)),
      Effect.andThen(Effect.never),
    );
  f.work.add(Id.IssueId.make("abra-1"));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* f.controller
          .start(Id.IssueId.make("abra-1"))
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(admission);
      }),
    ),
  );
  const saved = await run(f.controller.get(Id.IssueId.make("abra-1")));
  assert.equal(saved.capacity_reservation!.status, "uncertain");
  assert.equal(saved.capacity_reservation!.prompt_id, saved.prompt_id);
  f.work.add(Id.IssueId.make("abra-2"));
  await assert.rejects(run(f.controller.start(Id.IssueId.make("abra-2"))), /active worker/);
  assert.equal(f.runtime.creates, 1);
});

test("legacy configuration retains its resource ceiling and validates explicit new limits", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  await writeFile(
    join(f.root, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nmax_workers: 3\n",
  );
  assert.equal((await run(loadConfig(f.root))).max_executions, 3);
  await writeFile(
    join(f.root, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nmax_workers: 3\nmax_executions: 8\n",
  );
  assert.equal((await run(loadConfig(f.root))).max_executions, 8);
  await writeFile(
    join(f.root, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nmax_executions: 0\n",
  );
  await assert.rejects(run(loadConfig(f.root)), /max_executions/);
});

for (const role of ["apply", "review"] as const) {
  test(`${role} capacity retry rejects changed admission evidence`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    f.config.max_executions = 3;
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.max_workers = 2;
    p.max_executions = 3;
    await run(f.records.saveProject(p));
    let waiting;
    if (role === "apply") {
      const e = await run(planned(f));
      f.work.add(Id.IssueId.make("abra-2"));
      await run(f.controller.start(Id.IssueId.make("abra-2")));
      f.config.max_workers = 1;
      const approval = await run(
        f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
      );
      assert.ok("form_id" in approval);
      f.runtime.forms.set(approval.form_id, "approved");
      const approved = await run(
        f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
      );
      assert.ok("current_phase" in approved);
      waiting = approved;
      await writeFile(
        join(waiting.worktree_directory!, "openspec/changes", waiting.openspec_change, "design.md"),
        "Changed approved design",
      );
    } else {
      f.config.review_capacity = 1;
      const first = await run(applying(f));
      const second = await run(applying(f, Id.IssueId.make("abra-2")));
      f.spec.done = true;
      f.runtime.success(first.apply_session_id!);
      await run(f.controller.advance(first.issue_id));
      f.runtime.success(second.apply_session_id!);
      waiting = await run(f.controller.advance(second.issue_id));
      await writeFile(join(waiting.worktree_directory!, "changed.ts"), "changed after checks");
    }
    assert.equal(waiting.capacity_wait!.role, role);
    const prompts = f.runtime.prompts;
    const clock = await run(TestClock.make());
    await run(clock.setTime(waiting.capacity_wait!.next_check_at + 1));
    const [recovered] = await run(
      f.controller.reconcile(waiting.issue_id).pipe(Effect.provideService(Clock.Clock, clock)),
    );
    assert.equal(recovered.current_phase, "recovery_required");
    assert.match(
      recovered.error_or_recovery_reason!,
      role === "apply" ? /plan.*changed/i : /Content changed/,
    );
    assert.equal(recovered[`${role}_session_id`], undefined);
    assert.equal(f.runtime.prompts, prompts);
  });
}
