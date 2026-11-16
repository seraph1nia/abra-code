import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect, Fiber } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { workGraphAt } from "../helpers/work-database.ts";
import { Queries } from "../../src/workflow/queries.ts";
import { Coordination } from "../../src/workflow/coordination.ts";
import { FileLocks } from "../../src/storage/lock.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { fixture, applying } from "../fixtures.ts";
import { run } from "../effects.ts";

const goal = (id: string) => ({
  request_id: Id.RequestId.make(id),
  repository_id: Id.RepositoryId.make("api"),
  title: id,
  description: "A concurrent intake commit",
  priority: 2,
  dependencies: [],
});
async function observation(t: { onTestFinished: (cleanup: () => Promise<void>) => void }) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { graph } = await workGraphAt(t);
  const queries = new Queries(f.config, f.records, graph, f.spec, f.git, f.runtime);
  return { f, graph, queries };
}

test("independent shared captures coexist while commits remain exclusive and read-to-write upgrades fail", async (t) => {
  const root = Id.AbsolutePath.make(await mkdtemp(join(tmpdir(), "abra-shared-capture-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const first = new Coordination(new FileLocks(root));
  const second = new Coordination(new FileLocks(root));
  const writer = new Coordination(new FileLocks(root));
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* first
          .with(
            () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
            { shared: true, waitSeconds: 0 },
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* second
          .with(() => Effect.void, { shared: true, waitSeconds: 0 })
          .pipe(Effect.timeout("1 second"));
        const refused = yield* writer
          .with(() => Effect.void, { waitSeconds: 0 })
          .pipe(Effect.result);
        assert.equal(refused._tag, "Failure");
        if (refused._tag === "Failure") assert.equal(refused.failure.code, "LOCKED");
        const upgrade = yield* second
          .with(() => second.with(() => Effect.void), { shared: true, waitSeconds: 0 })
          .pipe(Effect.result);
        assert.equal(upgrade._tag, "Failure");
        if (upgrade._tag === "Failure") assert.equal(upgrade.failure.code, "COORDINATION_UPGRADE");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(reader);
        yield* writer.with(() => Effect.void, { waitSeconds: 0 });
      }),
    ),
  );
});

test("retained capture retries a graph commit between issue and record observations", async (t) => {
  const { f, graph, queries } = await observation(t);
  const first = await run(graph.create(goal("before-capture")));
  const scan = f.records.projectScan.bind(f.records);
  let attempts = 0;
  f.records.projectScan = () =>
    scan().pipe(
      Effect.tap(() => {
        attempts++;
        return attempts === 1
          ? Effect.gen(function* () {
              yield* graph.create(goal("intervening-intake"));
              const actor = Id.ExecutionId.make("intervening-owner");
              yield* graph.claim(first.id, actor);
              yield* graph.close(first.id, actor);
            })
          : Effect.void;
      }),
    );
  f.runtime.session = () =>
    Effect.fail(new CrewError("UNEXPECTED_NATIVE", "Capture must not inspect sessions"));
  const captured = await run(queries.observe({ state: "all", limit: 1 }));
  assert.equal(attempts, 2);
  assert.equal(captured.issues.length, 2);
  assert.ok(captured.issues.some((issue) => issue.id === first.id));
  assert.equal(captured.issues.find((issue) => issue.id === first.id)!.status, "closed");
  assert.equal(captured.page!.total, 2);
  assert.equal(captured.page!.entries.length, 1);
  assert.equal(captured.closures[first.id], (await run(graph.history(first.id))).at(-1)!.at);
  assert.ok(captured.completions.some((completion) => completion.issue_id === first.id));
  assert.equal(captured.source.work_revision, await run(graph.revision));
  assert.equal(captured.source.projects.length, 3);
  f.records.projectScan = scan;
  const listing = await run(queries.workList(true));
  assert.deepEqual(listing.issues, captured.issues);
  assert.equal(listing.retained_source.work_revision, captured.source.work_revision);
  assert.equal(listing.records?.format, "abracode-plugin-records-v1");
  assert.equal(listing.record_diagnostics.length, captured.diagnostics.length);
  const selected = await run(queries.observeTask(first.id, true));
  assert.equal(selected.issue.status, "closed");
  assert.equal(selected.history?.at(-1)?.kind, "closed");
  assert.equal(selected.source.work_revision, captured.source.work_revision);

  await assert.rejects(
    run(queries.observeTask(Id.IssueId.make("missing"))),
    (error: unknown) => error instanceof CrewError && error.code === "ISSUE_MISSING",
  );

  assert.equal(f.locks.held, false);
});

test("continuous graph contention yields bounded unavailable evidence and releases coordination", async (t) => {
  const { f, graph, queries } = await observation(t);
  const scan = f.records.projectScan.bind(f.records);
  let attempts = 0;
  f.records.projectScan = () =>
    scan().pipe(Effect.tap(() => graph.create(goal(`contention-${++attempts}`))));
  await assert.rejects(
    run(queries.observe()),
    (error: unknown) => error instanceof CrewError && error.code === "OBSERVATION_UNAVAILABLE",
  );
  assert.equal(attempts, 3);
  assert.equal(f.locks.held, false);
  f.records.projectScan = scan;
  assert.equal((await run(queries.observe())).issues.length, 3);
});

test("a slow retained scan times out without starving pause or retaining its lock", async (t) => {
  const { f, queries } = await observation(t);
  const execution = await run(applying(f));
  const entered = Deferred.makeUnsafe<void>();
  const scan = f.records.projectScan.bind(f.records);
  f.records.projectScan = () =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* queries.observe().pipe(Effect.result, Effect.forkScoped);
        yield* Deferred.await(entered);
        const paused = yield* f.controller
          .control(execution.issue_id, "pause")
          .pipe(Effect.timeout("2 seconds"));
        assert.equal(paused.current_phase, "interrupted");
        assert.equal(paused.stop_status, "confirmed");
        const result = yield* Fiber.join(reader);
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") assert.equal(result.failure.code, "OBSERVATION_UNAVAILABLE");
      }),
    ),
  );
  assert.equal(f.locks.held, false);
  f.records.projectScan = scan;
  await run(queries.observe());
});

test("native observations after retained capture leave pause independently available", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(applying(f));
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const session = f.runtime.session.bind(f.runtime);
  let first = true;
  f.runtime.session = (id) =>
    Effect.gen(function* () {
      if (first) {
        first = false;
        assert.equal(f.locks.held, false, "Native reads must be outside capture coordination");
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      }
      return yield* session(id);
    });
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* new Visibility(f.controller).snapshot().pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const paused = yield* f.controller
          .control(execution.issue_id, "pause")
          .pipe(Effect.timeout("1 second"));
        assert.equal(paused.stop_status, "confirmed");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(reader);
      }),
    ),
  );
});
