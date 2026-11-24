import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { Deferred, Effect, Fiber } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrewError } from "../../src/domain.ts";
import * as Id from "@abracode/contracts/identities";
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

test("finder projects selected rows and uses only matching retained capacity", async (t) => {
  const { f, graph, queries } = await observation(t);
  const dependency = await run(graph.create(goal("dependency")));
  const item = await run(graph.create({ ...goal("selected-only"), dependencies: [dependency.id] }));
  await run(graph.create(goal("unrelated")));
  const expected = (await run(queries.ready())).find(({ issue }) => issue.id === item.id)!;
  await run(queries.refreshFinderReadiness());
  const view = new Visibility({ queries });
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  t.onTestFinished(() => prepare.mockRestore());
  const native = vi.spyOn(f.runtime, "session");
  t.onTestFinished(() => native.mockRestore());
  for (const method of ["projectScan", "executionScan", "setupScan"] as const)
    vi.spyOn(f.records, method).mockImplementation(() => {
      throw new Error("Finder must not scan whole record populations");
    });
  const initial = await run(view.find({ search: "selected-only" }));
  assert.equal(initial.total, 1);
  const [row] = initial.entries;
  assert.equal(row?.issue_id, item.id);
  assert.equal(row?.eligibility_observed, true);
  assert.equal(row?.eligible, expected.eligible);
  assert.deepEqual(row?.blockers, expected.blockers);
  assert.deepEqual(row?.dependencies, [dependency.id]);
  assert.equal(native.mock.calls.length, 0);
  assert.equal(prepare.mock.calls.filter(([sql]) => /SELECT \* FROM issues\b/.test(sql)).length, 1);
  assert.equal(
    prepare.mock.calls.some(([sql]) => /SELECT \* FROM issues ORDER BY/.test(sql)),
    false,
  );
  const project = await run(f.records.project(item.repository_id));
  assert.ok(project);
  await run(f.records.saveProject(project));
  const stale = await run(view.find({ search: "selected-only" }));
  assert.equal(stale.entries[0]?.eligibility_observed, false);
  assert.equal(stale.entries[0]?.eligible, false);
  assert.match(stale.entries[0]?.blockers.at(-1) ?? "", /Population readiness evidence/);
});

test("finder retries an overlapping graph commit and gives a bounded unavailable result", async (t) => {
  const { f, graph, queries } = await observation(t);
  await run(graph.create(goal("initial")));
  const evidence = graph.taskEvidence.bind(graph);
  let attempts = 0;
  graph.taskEvidence = (entries) =>
    evidence(entries).pipe(
      Effect.tap(() => (++attempts === 1 ? graph.create(goal("follow-up")) : Effect.void)),
    );
  const page = await run(queries.observeFinder({ limit: 1 }));
  assert.equal(attempts, 2);
  assert.equal(page.total, 2);
  assert.equal(page.workRevision, await run(graph.revision));
  graph.taskEvidence = (entries) =>
    evidence(entries).pipe(Effect.tap(() => graph.create(goal(`contention-${++attempts}`))));
  await assert.rejects(
    run(queries.observeFinder({ limit: 1 })),
    (error: unknown) => error instanceof CrewError && error.code === "OBSERVATION_UNAVAILABLE",
  );
  assert.equal(attempts, 5);
  assert.equal(f.locks.held, false);
});

test("a suspended fleet refresh cannot delay finder pages and keeps stale totals labeled", async (t) => {
  const { graph, queries } = await observation(t);
  const view = new Visibility({ queries });
  await run(graph.create(goal("before")));
  const initial = await run(view.find({}));
  assert.equal(initial.fleet_observation.state, "unavailable");
  await run(view.refreshFinder);
  const cached = await run(view.find({}));
  assert.equal(cached.fleet_observation.state, "current");
  assert.equal(cached.fleet?.total, 1);

  const added = await run(graph.create(goal("after")));
  await run(view.invalidateFinder({ finder: true, issues: [added.id] }));
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const snapshot = view.snapshot.bind(view);
  vi.spyOn(view, "snapshot").mockImplementation((...args) =>
    Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(snapshot(...args)),
    ),
  );
  await run(
    Effect.gen(function* () {
      const refresh = yield* view.refreshFinder.pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const page = yield* view.find({ search: "after" }).pipe(Effect.timeout("1 second"));
      assert.equal(page.total, 1);
      assert.equal(page.entries[0]?.issue_id, added.id);
      assert.equal(page.fleet?.total, 1);
      assert.equal(page.fleet_observation.state, "stale");
      assert.notEqual(page.fleet_observation.work_revision, page.work_revision);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(refresh);
    }),
  );
  const refreshed = await run(view.find({ state: "closed" }));
  assert.equal(refreshed.total, 0);
  assert.equal(refreshed.fleet?.total, 2);
  assert.equal(refreshed.fleet_observation.state, "current");
  assert.equal(refreshed.fleet_observation.work_revision, refreshed.work_revision);
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
