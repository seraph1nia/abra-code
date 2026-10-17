import { deliveryAction } from "../../src/workflow/delivery-outcome.ts";
import { verifiedSpec } from "../helpers/spec-review.ts";
import * as Id from "../../src/identities.ts";
import { Deferred, Effect, Fiber } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixture, applying, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { FileLocks } from "../../src/storage/lock.ts";
import { Operations, ExecutionBusy } from "../../src/workflow/operations.ts";
import { CrewError } from "../../src/domain.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";

test("a held check does not monopolize approval/pause/resume, and stale success cannot replace a pause", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.verification = [["held-check"]];
  p.max_workers = 2;
  p.max_executions = 2;
  await run(f.records.saveProject(p));
  const first = await run(applying(f));
  const second = await run(planned(f, Id.IssueId.make("abra-2")));
  const approval = await run(
    f.controller.approve(second.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in approval);
  f.runtime.forms.set(approval.form_id, "approved");
  const entered = Deferred.makeUnsafe<void>(),
    stopped = Deferred.makeUnsafe<void>();
  const original = f.git.runner.run.bind(f.git.runner);
  f.git.runner.run = (file, ...args) =>
    file === "held-check"
      ? Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(stopped, undefined)),
        )
      : original(file, ...args);
  f.spec.done = true;
  f.runtime.success(first.apply_session_id!);
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const check = yield* f.controller.advance(first.issue_id).pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const intent = yield* f.controller.get(first.issue_id);
        assert.equal(intent.operation!.action, "advance");
        assert.ok(intent.operation!.fingerprint);
        assert.equal(intent.current_phase, "verifying");
        const applied = yield* f.controller
          .approve(second.issue_id, "plan", Id.SessionId.make("ses_supervisor"))
          .pipe(Effect.timeout("1 second"));
        assert.ok("current_phase" in applied && applied.current_phase === "applying");
        const paused = yield* f.controller
          .control(second.issue_id, "pause")
          .pipe(Effect.timeout("1 second"));
        assert.equal(paused.stop_status, "confirmed");
        assert.equal(
          (yield* f.controller.control(second.issue_id, "resume").pipe(Effect.timeout("1 second")))
            .current_phase,
          "applying",
        );
        const duplicate = yield* Effect.result(f.controller.advance(first.issue_id));
        assert.equal(duplicate._tag, "Failure");
        yield* f.controller.control(first.issue_id, "pause");
        yield* Deferred.await(stopped);
        yield* Fiber.await(check);
        const current = (yield* f.controller.reconcile(first.issue_id))[0];
        assert.equal(current.current_phase, "interrupted");
        assert.equal(current.stop_status, "confirmed");
        assert.equal(current.verification_receipt, undefined);
        const stale = yield* Effect.result(f.records.save(intent));
        assert.equal(stale._tag, "Failure");
        if (stale._tag === "Failure") assert.equal(stale.failure.code, "STALE_OPERATION");
        assert.equal((yield* f.controller.get(first.issue_id)).current_phase, "interrupted");
      }),
    ),
  );
});

test("independent operation owners use kernel exclusion and preserve intent before slow submission", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const root = join(f.root, "operation-locks");
  const coordination = f.records.coordinate(f.locks);
  const a = new Operations(f.records, new FileLocks(Id.AbsolutePath.make(root)), coordination);
  const b = new Operations(f.records, new FileLocks(Id.AbsolutePath.make(root)), coordination);
  const entered = Deferred.makeUnsafe<void>();
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const owner = yield* a
          .owned(e.issue_id, Id.OperationAction.make("probe"), () =>
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const saved = yield* f.controller.get(e.issue_id);
        assert.equal(saved.operation!.action, "probe");
        const peer = yield* Effect.result(
          b.owned(e.issue_id, Id.OperationAction.make("duplicate"), () => Effect.void),
        );
        assert.equal(peer._tag, "Failure");
        if (peer._tag === "Failure") assert.equal(peer.failure.code, "LOCKED");
        for (const action of ["approve", "finish"] as const) {
          let entered = false;
          const busy = yield* deliveryAction(
            f.controller.queries,
            e.issue_id,
            action,
            b.owned(e.issue_id, Id.OperationAction.make(action), () => {
              entered = true;
              return Effect.succeed(e);
            }),
          );
          assert.ok("category" in busy);
          assert.equal(busy.category, "operation_in_progress");
          assert.equal(busy.performed, false);
          assert.equal(busy.operation!.id, saved.operation!.id);
          assert.equal(entered, false);
          assert.equal((yield* f.controller.get(e.issue_id)).operation!.id, saved.operation!.id);
        }
        yield* Fiber.interrupt(owner);
      }),
    ),
  );
  await run(b.owned(e.issue_id, Id.OperationAction.make("recovered"), () => Effect.void));
  await assert.rejects(
    run(
      deliveryAction(
        f.controller.queries,
        e.issue_id,
        "finish",
        b.owned(e.issue_id, Id.OperationAction.make("finish"), () =>
          Effect.fail(new CrewError("LOCKED", "Downstream lock failed")),
        ),
      ),
    ),
    /Downstream lock failed/,
  );
  await assert.rejects(
    run(
      deliveryAction(
        f.controller.queries,
        e.issue_id,
        "finish",
        b.owned(e.issue_id, Id.OperationAction.make("finish"), () =>
          Effect.fail(new ExecutionBusy(e.issue_id)),
        ),
      ),
    ),
    /already owns/,
  );
  const binary = process.env.ABRACODE_NODE_BINARY;
  try {
    process.env.ABRACODE_NODE_BINARY = "/missing/abracode-test-node";
    await assert.rejects(
      run(
        deliveryAction(
          f.controller.queries,
          e.issue_id,
          "finish",
          b.owned(e.issue_id, Id.OperationAction.make("finish"), () => Effect.succeed(e)),
        ),
      ),
      /Lock helper failed/,
    );
  } finally {
    if (binary === undefined) delete process.env.ABRACODE_NODE_BINARY;
    else process.env.ABRACODE_NODE_BINARY = binary;
  }
});

test("operation commits preserve newer independent diagnostic observations", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  const stale = await run(f.controller.get(e.issue_id));
  await run(
    f.controller.recordWorkerFailure(e.apply_session_id!, {
      type: "Fixture",
      message: "Retain this observation",
    }),
  );
  await run(f.records.save(stale));
  assert.equal(
    (await run(f.controller.get(e.issue_id))).worker_failure!.error.message,
    "Retain this observation",
  );
});

test("Review can publish during prompt admission without competing for execution ownership", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  const entered = Deferred.makeUnsafe<void>(),
    release = Deferred.makeUnsafe<void>();
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (id, text, messageID) =>
    prompt(id, text, messageID).pipe(
      Effect.andThen(Deferred.succeed(entered, undefined)),
      Effect.andThen(Deferred.await(release)),
    );
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* f.controller.advance(e.issue_id).pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const assigned = yield* f.controller.get(e.issue_id);
        yield* f.controller
          .reviewReport(assigned.review_session_id!, true, "Pass", undefined, verifiedSpec)
          .pipe(Effect.timeout("1 second"));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(admission);
        assert.equal((yield* f.controller.get(e.issue_id)).review_receipt!.passed, true);
      }),
    ),
  );
});

for (const during of ["decision recheck", "native completion read"] as const)
  test(`a concurrent Review report survives ${during} after a worker question`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(applying(f));
    const key = Id.ObligationKey.make("inventory");
    await run(
      f.controller.workerQuestion(e.apply_session_id!, {
        key,
        generation: e.control_generation,
        scope: "Inventory",
        question: "Provide inventory",
        owner: "supervisor",
      }),
    );
    await run(
      f.controller.decision(
        e.issue_id,
        key,
        e.control_generation,
        Id.SessionId.make("ses_supervisor"),
        "answer",
        "Retained inventory",
      ),
    );
    f.spec.done = true;
    f.runtime.success(e.apply_session_id!);
    const reviewing = await run(f.controller.advance(e.issue_id));
    f.runtime.success(reviewing.review_session_id!);
    let published = false;
    const report = () =>
      Effect.gen(function* () {
        if (published) return;
        published = true;
        yield* f.controller.reviewReport(
          reviewing.review_session_id!,
          true,
          "Pass",
          undefined,
          verifiedSpec,
        );
      });
    if (during === "decision recheck") {
      const validate = f.git.validate.bind(f.git);
      f.git.validate = (...args) => validate(...args).pipe(Effect.tap(report));
    } else {
      const session = f.runtime.session.bind(f.runtime);
      let reads = 0;
      f.runtime.session = (id) =>
        session(id).pipe(
          // The first read validates location; the next observes completion.
          Effect.tap(() =>
            id === reviewing.review_session_id && ++reads === 2 ? report() : Effect.void,
          ),
        );
    }
    const result = (await run(f.controller.reconcile(e.issue_id)))[0];
    assert.equal(published, true);
    assert.equal(result.current_phase, "awaiting_merge");
    assert.equal(result.review_receipt?.passed, true);
    assert.equal(result.decisions![0].status, "answered");
  });

test("lost native session creation response reuses the retained intent without a second worker", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const entered = Deferred.makeUnsafe<void>();
  const create = f.runtime.createSession.bind(f.runtime);
  f.runtime.createSession = (...args) =>
    create(...args).pipe(
      Effect.andThen(Deferred.succeed(entered, undefined)),
      Effect.andThen(Effect.never),
    );
  f.work.add(Id.IssueId.make("abra-1"));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const start = yield* f.controller.start(Id.IssueId.make("abra-1")).pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(start);
      }),
    ),
  );
  const saved = await run(f.controller.get(Id.IssueId.make("abra-1")));
  assert.ok(saved.session_intent);
  f.runtime.createSession = create;
  const recovered = (await run(f.controller.reconcile(Id.IssueId.make("abra-1"))))[0];
  assert.equal(recovered.explore_session_id, saved.session_intent.id);
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.runtime.prompts, 1);
});

test("restart after push rediscovers the exact remote ref and creates one PR", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const entered = Deferred.makeUnsafe<void>();
  let interrupted = true,
    creates = 0,
    pushes = 0;
  let pr: PR | undefined;
  const gitRun = f.git.run.bind(f.git);
  f.git.run = (cwd, args, options) => {
    if (args[0] === "push") pushes++;
    return gitRun(cwd, args, options);
  };
  const delivery = new GitHubDelivery(
    f.git,
    {
      run: (_file, args) =>
        Effect.gen(function* () {
          if (args[1] === "list" && interrupted)
            return yield* Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
          if (args[1] === "create") {
            creates++;
            const e = yield* f.records.execution(Id.IssueId.make("abra-1"));
            pr = {
              url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
              state: "OPEN",
              headRefOid: yield* f.git.head(e!.worktree_directory!),
              baseRefName: Id.BranchName.make("main"),
              body: "",
              isDraft: false,
              mergeable: "MERGEABLE",
              mergeStateStatus: "CLEAN",
            };
          }
          return JSON.stringify(pr ? [pr] : []);
        }),
    },
    Id.Executable.make("fake-forge"),
  );
  const controller = () =>
    new Controller(f.config, f.records, f.work, f.spec, f.git, f.runtime, delivery, f.locks);
  f.controller = controller();
  const e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  const reviewing = await run(f.controller.advance(e.issue_id));
  await run(
    f.controller.reviewReport(reviewing.review_session_id!, true, "Pass", undefined, verifiedSpec),
  );
  f.runtime.success(reviewing.review_session_id!);
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const advancing = yield* f.controller.advance(e.issue_id).pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(advancing);
      }),
    ),
  );
  assert.equal((await run(f.controller.get(e.issue_id))).current_phase, "delivering");
  assert.equal(pushes, 1);
  interrupted = false;
  const restarted = controller();
  assert.equal((await run(restarted.reconcile(e.issue_id)))[0].current_phase, "awaiting_merge");
  await run(restarted.reconcile(e.issue_id));
  assert.equal(pushes, 1);
  assert.equal(creates, 1);
  assert.equal(f.runtime.creates, 3);
});

test("replan cannot replace the explicit resume of a paused execution", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  await run(f.controller.start(Id.IssueId.make("abra-1")));
  await run(f.controller.control(Id.IssueId.make("abra-1"), "pause"));
  const prompts = f.runtime.prompts;
  await assert.rejects(
    run(f.controller.control(Id.IssueId.make("abra-1"), "replan", "Reconsider requirements")),
    /Resume paused/,
  );
  assert.equal(
    (await run(f.controller.get(Id.IssueId.make("abra-1")))).current_phase,
    "interrupted",
  );
  assert.equal(f.runtime.prompts, prompts);
});
