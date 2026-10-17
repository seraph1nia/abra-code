import { writeFile } from "../../src/filesystem.ts";
import { join } from "node:path";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber } from "effect";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";
import { consumesWorker } from "../../src/workflow/capacity.ts";
import { applying, fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

test("explicit completion observes a busy worker without admitting another prompt", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  const prompts = f.runtime.prompts;
  await assert.rejects(run(f.controller.advance(e.issue_id)), { code: "WRITER_BUSY" });
  assert.equal(f.runtime.prompts, prompts);
  assert.equal((await run(f.controller.get(e.issue_id))).prompt_id, e.prompt_id);
});

for (const outcome of [undefined, "interrupted", "future-outcome"]) {
  test(`explicit completion rejects ${outcome ?? "unknown"} outcome without recovering admission`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(applying(f));
    const state = f.runtime.sessions.get(e.apply_session_id!)!;
    state.busy = false;
    Reflect.set(state, "outcome", outcome);
    state.error = { type: "Fixture", message: "Unconfirmed completion" };
    await assert.rejects(run(f.controller.advance(e.issue_id)), {
      code: "SESSION_OUTCOME",
      message: `Worker outcome is ${outcome ?? "unknown"}`,
    });
    const saved = await run(f.controller.get(e.issue_id));
    assert.equal(saved.worker_failure, undefined);
    assert.equal(saved.prompt_id, e.prompt_id);
    assert.equal(f.runtime.prompts, 2);
  });
}

for (const route of ["advance", "reconcile"] as const) {
  test(`${route} retains structured worker failure diagnostics`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(applying(f));
    const state = f.runtime.sessions.get(e.apply_session_id!)!;
    state.busy = false;
    state.outcome = "failed";
    state.model = {
      providerID: Id.ProviderId.make("fixture"),
      id: Id.ModelId.make("failure-model"),
    };
    state.error = { type: "ProviderError", status: 403, message: "Access refused" };
    state.error_at = 1234567890000;
    if (route === "advance")
      await assert.rejects(run(f.controller.advance(e.issue_id)), { code: "WORKER_STOPPED" });
    else await run(f.controller.reconcile(e.issue_id));
    const saved = await run(f.controller.get(e.issue_id));
    assert.deepEqual(saved.worker_failure, {
      prompt_id: e.prompt_id,
      session_id: e.apply_session_id,
      role: "apply",
      model: state.model,
      error: state.error,
      at: new Date(state.error_at).toISOString(),
    });
    assert.match(
      saved.error_or_recovery_reason!,
      /failure-model.*ProviderError.*403.*Access refused/,
    );
    assert.equal(f.runtime.prompts, 2);
  });

  test(`${route} requires the completed Review's report before delivery`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(applying(f));
    f.spec.done = true;
    f.runtime.success(e.apply_session_id!);
    const reviewing = await run(f.controller.advance(e.issue_id));
    f.runtime.success(reviewing.review_session_id!);
    if (route === "advance")
      await assert.rejects(run(f.controller.advance(e.issue_id)), { code: "REVIEW_MISSING" });
    else await run(f.controller.reconcile(e.issue_id));
    const saved = await run(f.controller.get(e.issue_id));
    assert.match(saved.error_or_recovery_reason!, /Independent Review completed without/);
    assert.equal(saved.review_receipt, undefined);
    assert.equal(f.delivery.calls, 0);
    assert.equal(f.runtime.prompts, 3);
  });
}

test("reconciliation rejects a recorded session outside the owned worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  f.runtime.sessions.get(e.explore_session_id!)!.directory = f.root;
  const [saved] = await run(f.controller.reconcile(e.issue_id));
  assert.equal(saved.current_phase, "recovery_required");
  assert.match(saved.error_or_recovery_reason!, /moved out of owned worktree/);
  assert.equal(f.runtime.prompts, 2);
});

for (const admitted of [false, true]) {
  test(`restart retains prompt identity and progress when admission ${admitted ? "response" : "submission"} is lost`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const entered = Deferred.makeUnsafe<void>();
    const prompt = f.runtime.prompt.bind(f.runtime);
    const submissions: string[] = [];
    const payloads: string[] = [];
    f.runtime.prompt = (id, text, messageID) =>
      Effect.gen(function* () {
        submissions.push(messageID);
        payloads.push(text);
        if (admitted) yield* prompt(id, text, messageID);
        yield* Deferred.succeed(entered, undefined);
        return yield* Effect.never;
      });
    f.work.add(Id.IssueId.make("abra-1"));
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const starting = yield* f.controller
            .start(Id.IssueId.make("abra-1"))
            .pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          const saved = yield* f.controller.get(Id.IssueId.make("abra-1"));
          yield* f.controller.workerProgress(saved.explore_session_id!, 0, "Retained progress");
          yield* Fiber.interrupt(starting);
        }),
      ),
    );
    const saved = await run(f.controller.get(Id.IssueId.make("abra-1")));
    assert.equal(saved.capacity_reservation!.status, "uncertain");
    await run(
      writeFile(join(f.config.home, ".opencode/agents/explore.md"), "Changed Explore guidance"),
    );
    f.work.issues.get(saved.issue_id)!.description = "Changed request after interrupted admission";
    f.runtime.prompt = (id, text, messageID) => {
      payloads.push(text);
      submissions.push(messageID);
      return prompt(id, text, messageID);
    };
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
    const [recovered] = await run(restarted.reconcile(saved.issue_id));
    await run(restarted.reconcile(saved.issue_id));
    assert.equal(recovered.explore_session_id, saved.explore_session_id);
    assert.equal(recovered.prompt_id, saved.prompt_id);
    assert.equal(recovered.worker_started_at, saved.worker_started_at);
    assert.deepEqual(recovered.progress, saved.progress);
    assert.ok(submissions.every((id) => id === saved.prompt_id));
    assert.ok(payloads.every((text) => text === payloads[0]));
    assert.equal(submissions.length, admitted ? 1 : 2);
    assert.equal(f.runtime.creates, 1);
    assert.equal(f.runtime.prompts, 1);
    assert.equal(f.runtime.permissionRefreshes, 0);
    await run(f.runtime.interrupt(saved.explore_session_id!));
    assert.equal((await run(restarted.reconcile(saved.issue_id)))[0].current_phase, "interrupted");
    const resumed = await run(restarted.control(saved.issue_id, "resume"));
    assert.equal(resumed.explore_session_id, saved.explore_session_id);
    assert.equal(resumed.worktree_directory, saved.worktree_directory);
    assert.notEqual(resumed.prompt_id, saved.prompt_id);
    assert.equal(resumed.progress, undefined);
    assert.equal(f.runtime.creates, 1);
    assert.equal(f.runtime.prompts, 2);
    assert.equal(f.runtime.permissionRefreshes, 1);
  });
}

for (const failure of ["interrupt", "read"] as const) {
  test(`pending stop retains capacity across pause and restart when native ${failure} fails`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(applying(f));
    const entered = Deferred.makeUnsafe<void>(),
      release = Deferred.makeUnsafe<void>();
    const interrupt = f.runtime.interrupt.bind(f.runtime);
    const session = f.runtime.session.bind(f.runtime);
    const cancellations: { id: string; promptID?: string }[] = [];
    const unavailable = Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(Effect.fail(new CrewError("FIXTURE_NATIVE", "Native stop unavailable"))),
    );
    f.runtime.interrupt = (id, promptID?: string) => {
      cancellations.push({ id, promptID });
      return failure === "interrupt" && id === e.apply_session_id ? unavailable : interrupt(id);
    };
    f.runtime.session = (id) =>
      failure === "read" && id === e.apply_session_id ? unavailable : session(id);
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const pausing = yield* f.controller
            .control(e.issue_id, "pause")
            .pipe(Effect.result, Effect.forkScoped);
          yield* Deferred.await(entered);
          const pending = yield* f.controller.get(e.issue_id);
          assert.equal(pending.stop_status, "requested");
          assert.ok(consumesWorker(pending));
          assert.deepEqual(pending.capacity_reservation, e.capacity_reservation);
          yield* f.records
            .coordinate(f.locks)
            .with(() => Effect.void)
            .pipe(Effect.timeout("1 second"));
          const replacement = yield* Effect.result(f.controller.control(e.issue_id, "resume"));
          assert.equal(replacement._tag, "Failure");
          if (replacement._tag === "Failure") assert.equal(replacement.failure.code, "LOCKED");
          yield* Deferred.succeed(release, undefined);
          const result = yield* Fiber.join(pausing);
          assert.equal(result._tag, "Failure");
          if (result._tag === "Failure") assert.equal(result.failure.code, "FIXTURE_NATIVE");
        }),
      ),
    );
    await assert.rejects(run(f.controller.control(e.issue_id, "resume")), { code: "STOP_PENDING" });
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
    const [pending] = await run(restarted.reconcile(e.issue_id));
    assert.equal(pending.stop_status, "requested");
    assert.ok(consumesWorker(pending));
    assert.match(pending.error_or_recovery_reason!, /Native stop unavailable/);
    assert.equal(f.runtime.prompts, 2);
    f.runtime.interrupt = interrupt;
    f.runtime.session = session;
    const [stopped] = await run(restarted.reconcile(e.issue_id));
    assert.equal(stopped.stop_status, "confirmed");
    assert.equal(consumesWorker(stopped), false);
    assert.equal(stopped.active_role, undefined);
    assert.equal(stopped.capacity_reservation, undefined);
    assert.equal(stopped.current_phase, "interrupted");
    assert.equal(stopped.apply_session_id, e.apply_session_id);
    assert.equal(stopped.worktree_directory, e.worktree_directory);
    assert.ok(cancellations.some((c) => c.id === e.apply_session_id && c.promptID === e.prompt_id));
    assert.equal(f.runtime.creates, 2);
  });
}
