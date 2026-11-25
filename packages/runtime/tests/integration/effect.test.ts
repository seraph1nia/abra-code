import { goal as workGoal } from "../helpers/work-goal.ts";
import * as Id from "@abracode/contracts/identities";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Context as EffectContext,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schedule,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { type Context } from "@opencode/plugin/effect/plugin";
import plugin from "../../src/plugin/index.ts";
import { ProcessRunner } from "../../src/process.ts";
import { FileLocks } from "../../src/storage/lock.ts";
import { exists } from "../../src/filesystem.ts";
import { monitor } from "../../src/recovery/monitor.ts";
import { CrewError } from "../../src/domain.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Crew, applicationLayer } from "../../src/opencode/application.ts";

test("failed plugin setup releases scoped scheduler leadership", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-setup-failure-"));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("ABRACODE_HOME", home);
  t.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  // Missing skill files fail after leadership acquisition, before any native mutation.
  const context = {
    app: { version: "2.3.0" },
    location: { directory: home },
    storage: {},
  } as unknown as Context;
  const result = await run(Effect.exit(Effect.scoped(plugin.effect(context))));
  assert.equal(Exit.isFailure(result), true);
  await run(
    new FileLocks(Id.AbsolutePath.make(join(home, ".abracode/locks"))).acquire(
      Id.LockKey.make("scheduler-leader"),
    ),
  );
});

test("interrupting a command waits for an uncooperative child to stop", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-process-scope-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready");
  const runner = new ProcessRunner();
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* runner
          .run(
            Id.Executable.make(process.execPath),
            [
              "-e",
              `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`,
              ready,
            ],
            Id.AbsolutePath.make(root),
          )
          .pipe(Effect.forkScoped);
        yield* exists(ready).pipe(
          Effect.repeat({ schedule: Schedule.spaced(10), until: Boolean }),
          Effect.timeout("5 seconds"),
        );
        const pid = Number(yield* Effect.promise(() => readFile(ready, "utf8")));
        yield* Fiber.interrupt(fiber);
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        const error = yield* Effect.flip(
          runner.run(
            Id.Executable.make(process.execPath),
            ["-e", "process.stderr.write('expected failure');process.exit(7)"],
            Id.AbsolutePath.make(root),
          ),
        );
        assert.equal(error.code, "COMMAND_FAILED");
        assert.match(error.message, /expected failure/);
      }),
    ),
  );
});

test("application database stays open for callbacks until the host plugin scope closes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-application-scope-"));
  await writeFile(
    join(home, "abracode.yaml"),
    "version: 1\nmodels: { default: {providerID: fixture, id: fixture} }\n",
  );
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  await cp(".agents", join(home, ".agents"), { recursive: true });
  let registrations = 0;
  const register = () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        registrations++;
        return { dispose: Effect.void };
      }),
      () =>
        Effect.sync(() => {
          registrations--;
        }),
    );
  const context = {
    location: { directory: home },
    storage: { scan: () => Effect.succeed({ entries: [] }) },
    agent: { transform: register },
    skill: { transform: register },
    tool: { list: () => Effect.succeed([]), transform: register, hook: register },
  } as unknown as Context;
  const services = await run(
    Layer.build(applicationLayer(context, home)).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const work = EffectContext.get(services, Crew).controller.queries;
  assert.deepEqual(await run(work.issues()), []);
  assert.ok(registrations > 0);
  await run(Scope.close(scope, Exit.void));
  await assert.rejects(run(work.issues()), /database is not open/);
  assert.equal(registrations, 0);
});

test("interruption preserves provisioning intent and releases the controller lock for recovery", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id: cancel1Id } = await run(f.work.create(workGoal("cancel-1")));
  const entered = Deferred.makeUnsafe<void>();
  const provision = f.runtime.createWorktree;
  f.runtime.createWorktree = () =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* f.controller
          .start(cancel1Id, Id.SessionId.make("ses_supervisor"))
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
      }),
    ),
  );
  const saved = (await run(f.records.execution(cancel1Id)))!;
  assert.equal(saved.current_phase, "provisioning");
  assert.ok(saved.base_commit);
  assert.equal(f.locks.held, false);
  f.runtime.createWorktree = provision;
  const [recovered] = await run(f.controller.reconcile(cancel1Id));
  assert.equal(recovered.current_phase, "exploring");
  assert.equal(f.seed.countEvents("claimed"), 1);
  assert.equal(f.runtime.creates, 1);
});

test("only a supervisor step reaching 200k tokens requests native compaction", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const ended = (sessionID: string, input: number, assistantMessageID: string) => ({
    type: "session.step.ended",
    data: {
      sessionID,
      assistantMessageID,
      tokens: { input, cache: { read: 96_000, write: 2_000 }, output: 1_500, reasoning: 500 },
    },
  });
  const steps = [
    ended(supervisor, 99_999, "msg_below"),
    ended("ses_worker", 150_000, "msg_worker"),
    ended("ses_fork", 150_000, "msg_fork"),
    ended("ses_untagged", 150_000, "msg_untagged"),
    ended("ses_revert", 150_000, "msg_revert"),
    ended(supervisor, 100_000, "msg_boundary"),
    ended(supervisor, 130_000, "msg_above"),
  ];
  const drained = Deferred.makeUnsafe<void>();
  const home = f.controller.queries.settings.home;
  const get = vi.fn(({ sessionID }: { sessionID: string }) =>
    Effect.succeed({
      agent: sessionID === "ses_worker" ? "apply" : "abra",
      location: { directory: home },
      metadata: sessionID === "ses_untagged" ? {} : { abracode_supervisor_home: home },
      fork: sessionID === "ses_fork" ? { sessionID: supervisor } : undefined,
      revert: sessionID === "ses_revert" ? {} : undefined,
      time: {},
    }),
  );
  const compact = vi.fn(() => Effect.void);
  const ctx = {
    event: {
      subscribe: () =>
        Stream.fromIterable(steps).pipe(
          Stream.concat(Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(Stream.drain)),
        ),
    },
    session: { get, compact },
  } as unknown as Context;
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        yield* monitor(ctx, f.controller, f.scheduler);
        yield* Deferred.await(drained).pipe(Effect.timeout("5 seconds"));
      }),
    ),
  );
  assert.equal(get.mock.calls.length, steps.length - 1);
  assert.deepEqual(
    compact.mock.calls,
    ["msg_boundary", "msg_above"].map((step) => [
      { sessionID: supervisor, id: `${step}_abra_compact`, delivery: "steer" },
    ]),
  );
});

test("monitor scope interrupts reconciliation and closes the event subscription", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const entered = Deferred.makeUnsafe<void>();
  let reconciliations = 0;
  let stopped = false;
  let unsubscribed = false;
  f.controller.reconcile = () =>
    Effect.sync(() => {
      reconciliations++;
    }).pipe(
      Effect.andThen(Deferred.succeed(entered, undefined)),
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          stopped = true;
        }),
      ),
    );
  const ctx = {
    event: {
      subscribe: () =>
        Stream.never.pipe(
          Stream.ensuring(
            Effect.sync(() => {
              unsubscribed = true;
            }),
          ),
        ),
    },
  } as unknown as Context;
  const scope = await run(Scope.make());
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  await run(
    monitor(ctx, f.controller, f.scheduler).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  await run(Deferred.await(entered).pipe(Effect.timeout("5 seconds")));
  await run(Scope.close(scope, Exit.void));
  assert.equal(reconciliations, 1);
  assert.equal(stopped, true);
  assert.equal(unsubscribed, true);
});

test("ticks during report recovery reserve one follow-up that reads current state", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.reconcile_interval_ms = 1000;
  let ticks = 0;
  f.scheduler.tick = () =>
    Effect.sync(() => {
      ticks++;
      return [];
    });
  const release = Deferred.makeUnsafe<void>();
  const key = Id.StorageKey.make("test/pending-report");
  const seen: unknown[] = [];
  let active = 0;
  let peak = 0;
  f.controller.reconcileReports = () =>
    Effect.gen(function* () {
      peak = Math.max(peak, ++active);
      seen.push(yield* f.records.store.get(key));
      if (seen.length === 1) yield* Deferred.await(release);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          active--;
        }),
      ),
    );
  const ctx = { event: { subscribe: () => Stream.never } } as unknown as Context;
  await run(
    Effect.gen(function* () {
      yield* monitor(ctx, f.controller, f.scheduler);
      yield* TestClock.adjust("3100 millis");
      assert.equal(ticks, 4);
      assert.deepEqual(seen, [undefined]);
      yield* f.records.store.set(key, "new report");
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust("0 millis");
      assert.deepEqual(seen, [undefined, "new report"]);
      assert.equal(peak, 1);
      assert.equal(active, 0);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("report recovery survives failure and a fresh monitor rediscovers interrupted work", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.reconcile_interval_ms = 1000;
  let ticks = 0;
  f.scheduler.tick = () =>
    Effect.sync(() => {
      ticks++;
      return [];
    });
  const key = Id.StorageKey.make("test/pending-report");
  const completed: unknown[] = [];
  let passes = 0;
  let interrupted = false;
  f.controller.reconcileReports = () =>
    Effect.gen(function* () {
      passes++;
      if (passes === 1) return yield* new CrewError("TEST", "Report read failed");
      const pending = yield* f.records.store.get(key);
      if (passes === 3)
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        );
      completed.push(pending);
    });
  const ctx = { event: { subscribe: () => Stream.never } } as unknown as Context;
  await run(
    Effect.gen(function* () {
      yield* f.records.store.set(key, "first report");
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* monitor(ctx, f.controller, f.scheduler);
          yield* TestClock.adjust("1100 millis");
          assert.deepEqual(completed, ["first report"]);
          yield* f.records.store.set(key, "unfinished report");
          yield* TestClock.adjust("2 seconds");
          assert.equal(ticks, 4);
          assert.equal(passes, 3);
        }),
      );
      assert.equal(interrupted, true);
      yield* TestClock.adjust("2 seconds");
      assert.equal(passes, 3);
      assert.deepEqual(completed, ["first report"]);
      yield* monitor(ctx, f.controller, f.scheduler);
      yield* TestClock.adjust("100 millis");
      assert.equal(passes, 4);
      assert.deepEqual(completed, ["first report", "unfinished report"]);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("a failed critical section releases its real process lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-lock-failure-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const locks = new FileLocks(Id.AbsolutePath.make(root));
  await assert.rejects(
    run(
      locks.with(Id.LockKey.make("controller"), () =>
        Effect.fail(new CrewError("EXPECTED", "critical section failed")),
      ),
    ),
    /critical section failed/,
  );
  await run(locks.acquire(Id.LockKey.make("controller")));
});

test("command interruption also stops a package manager's surviving descendants", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-process-tree-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const ready = join(root, "descendant");
  const descendant =
    "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},process.argv[1]],{stdio:'inherit'});setInterval(()=>{},1000)`;
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* new ProcessRunner()
          .run(
            Id.Executable.make(process.execPath),
            ["-e", parent, ready],
            Id.AbsolutePath.make(root),
          )
          .pipe(Effect.forkScoped);
        yield* exists(ready).pipe(
          Effect.repeat({ schedule: Schedule.spaced(10), until: Boolean }),
          Effect.timeout("5 seconds"),
        );
        const pid = Number(yield* Effect.promise(() => readFile(ready, "utf8")));
        yield* Fiber.interrupt(fiber);
        // A killed orphan can briefly remain a zombie until PID 1 reaps it.
        const stat = yield* Effect.tryPromise({
          try: () => readFile(`/proc/${pid}/stat`, "utf8"),
          catch: CrewError.from,
        }).pipe(
          Effect.catchIf(
            (error) => error.code === "ENOENT" || error.code === "ESRCH",
            () => Effect.succeed(null),
          ),
        );
        assert.ok(
          stat === null || stat.split(") ")[1].startsWith("Z "),
          "descendant is still running",
        );
      }),
    ),
  );
});

test("native event bursts coalesce while a dropped stream retains periodic reconciliation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.reconcile_interval_ms = 1000;
  const supervisor = Id.SessionId.make("ses_supervisor");
  await run(f.controller.recordSupervisor(supervisor));
  const entered = Deferred.makeUnsafe<void>(),
    drained = Deferred.makeUnsafe<void>(),
    released = Deferred.makeUnsafe<void>(),
    twice = Deferred.makeUnsafe<void>();
  let calls = 0,
    subscriptions = 0;
  const resubscribed = Deferred.makeUnsafe<void>();
  const prompts = f.runtime.prompts;
  f.controller.reconcile = () =>
    Effect.gen(function* () {
      calls++;
      if (calls === 1) {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(released);
      } else yield* Deferred.succeed(twice, undefined);
      return [];
    });
  const ctx = {
    event: {
      subscribe: () =>
        Stream.suspend(() => {
          if (++subscriptions === 2) Effect.runSync(Deferred.succeed(resubscribed, undefined));
          return Stream.fromIterable(
            Array.from({ length: 100 }, () => ({
              type: "session.tool.success",
              data: { sessionID: supervisor },
            })),
          ).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(Stream.drain),
            ),
          );
        }),
    },
  } as unknown as Context;
  const scope = await run(Scope.make());
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  await run(
    monitor(ctx, f.controller, f.scheduler).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  await run(Deferred.await(entered).pipe(Effect.timeout("5 seconds")));
  await run(Deferred.await(drained).pipe(Effect.timeout("5 seconds")));
  assert.equal(calls, 1);
  await run(Deferred.succeed(released, undefined));
  await run(Deferred.await(twice).pipe(Effect.timeout("5 seconds")));
  assert.equal(calls, 2);
  // EOF does not remove fallback ticks or prevent subscription recovery.
  await run(Deferred.await(resubscribed).pipe(Effect.timeout("5 seconds")));
  assert.ok(calls >= 3);
  assert.ok(subscriptions >= 2);
  assert.equal(f.runtime.prompts, prompts);
});

test("duplicate and reordered worker events preserve prompt-bound failure and required replies", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("event-order"),
    supervisor = Id.SessionId.make("ses_supervisor");
  f.seed.named(issue);
  const e = await run(f.controller.start(issue, supervisor));
  const request = await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("event-answer"),
        role: "explore",
        body: "Which check applies?",
        response: "answer",
      },
      supervisor,
    ),
  );
  Object.assign(f.runtime.sessions.get(e.explore_session_id!)!, {
    busy: false,
    executing: false,
    outcome: "failed",
    outcome_prompt_id: request.prompt_id,
    error: { type: "Provider", message: "Observed failure bound to retained input" },
    error_at: 1,
  });
  await run(f.controller.reconcile(issue));
  const failure = (await run(f.controller.get(issue))).worker_failure;
  assert.equal(failure?.prompt_id, request.prompt_id);
  await run(f.controller.supervise());
  const prompts = f.runtime.prompts;
  const drained = Deferred.makeUnsafe<void>(),
    reconciled = Deferred.makeUnsafe<void>();
  const reconcile = f.controller.reconcile.bind(f.controller);
  f.controller.reconcile = (...args) =>
    reconcile(...args).pipe(Effect.tap(() => Deferred.succeed(reconciled, undefined)));
  const ctx = {
    event: {
      subscribe: () =>
        Stream.fromIterable(
          [
            "session.execution.succeeded",
            "session.tool.progress",
            "session.idle",
            "session.execution.failed",
            "session.execution.succeeded",
            "session.idle",
          ].map((type) => ({
            type,
            data: {
              sessionID: e.explore_session_id,
              error: { type: "Provider", message: "Late event without prompt identity" },
            },
          })),
        ).pipe(
          Stream.concat(Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(Stream.drain)),
          Stream.concat(Stream.never),
        ),
    },
  } as unknown as Context;
  const scope = await run(Scope.make());
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  await run(
    monitor(ctx, f.controller, f.scheduler).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  await run(Deferred.await(drained).pipe(Effect.timeout("5 seconds")));
  await run(Deferred.await(reconciled).pipe(Effect.timeout("5 seconds")));
  await run(Scope.close(scope, Exit.void));
  const saved = await run(f.controller.get(issue));
  assert.equal(saved.current_phase, "failed");
  assert.deepEqual(saved.worker_failure, failure);
  assert.equal((await run(f.controller.queries.messages(issue))).outstanding, 1);
  assert.equal(f.runtime.prompts, prompts);
});
