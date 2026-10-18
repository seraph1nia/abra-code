import * as Id from "../../src/identities.ts";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { type Context } from "@opencode/plugin/effect/plugin";
import plugin from "../../.opencode/plugins/abracode/index.ts";
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
    app: { version: "2.0.28" },
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
  const context = { storage: {} } as unknown as Context;
  const services = await run(
    Layer.build(applicationLayer(context, home)).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const work = EffectContext.get(services, Crew).controller.queries;
  assert.deepEqual(await run(work.issues()), []);
  await run(Scope.close(scope, Exit.void));
  await assert.rejects(run(work.issues()), /database is not open/);
});

test("interruption preserves provisioning intent and releases the controller lock for recovery", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("cancel-1"));
  const entered = Deferred.makeUnsafe<void>();
  const provision = f.runtime.createWorktree;
  f.runtime.createWorktree = () =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* f.controller
          .start(Id.IssueId.make("cancel-1"), Id.SessionId.make("ses_supervisor"))
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
      }),
    ),
  );
  const saved = (await run(f.records.execution(Id.IssueId.make("cancel-1"))))!;
  assert.equal(saved.current_phase, "provisioning");
  assert.ok(saved.base_commit);
  assert.equal(f.locks.held, false);
  f.runtime.createWorktree = provision;
  const [recovered] = await run(f.controller.reconcile(Id.IssueId.make("cancel-1")));
  assert.equal(recovered.current_phase, "exploring");
  assert.equal(f.work.claims, 1);
  assert.equal(f.runtime.creates, 1);
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
          subscriptions++;
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
  await run(Effect.sleep(1100));
  assert.ok(calls >= 3);
  assert.ok(subscriptions >= 2);
  assert.equal(f.runtime.prompts, prompts);
});

test("duplicate and reordered worker events preserve prompt-bound failure and required replies", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("event-order"),
    supervisor = Id.SessionId.make("ses_supervisor");
  f.work.add(issue);
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
