import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "@opencode/schema/agent";
import { Deferred, Effect, Fiber } from "effect";
import { test } from "vite-plus/test";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { ExecutionTransitions } from "../../src/workflow/transitions.ts";
import { InboxIndex, inboxTables } from "../../src/work/inbox-index.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { workDatabase } from "../helpers/work-database.ts";
import { goal } from "../helpers/work-goal.ts";

test("ExecutionTransitions.fail preserves prior resume_phase from blocked, failed, recovery_required and interrupted", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = f.seed.named(Id.IssueId.make("resume-phase-keep"), Id.RepositoryId.make("api"));
  const started = await run(f.controller.start(issue.id));
  assert.ok("execution_id" in started);
  const e = started;
  const initialPhase = e.current_phase;
  assert.equal(initialPhase, "exploring");

  const transitions = new ExecutionTransitions(
    f.records,
    f.work,
    f.runtime,
    f.records.coordination,
    f.controller.queries,
    {} as never,
    {} as never,
  );

  await run(transitions.fail(e, new Error("first failure"), "blocked"));
  assert.equal(e.current_phase, "blocked");
  assert.equal(e.resume_phase, initialPhase);

  await run(transitions.fail(e, new Error("second failure"), "failed"));
  assert.equal(e.current_phase, "failed");
  assert.equal(e.resume_phase, initialPhase);

  await run(transitions.fail(e, new Error("third failure"), "recovery_required"));
  assert.equal(e.current_phase, "recovery_required");
  assert.equal(e.resume_phase, initialPhase);

  await run(f.records.commitOwned(e, { current_phase: "interrupted" }));
  await run(transitions.fail(e, new Error("fourth failure"), "blocked"));
  assert.equal(e.current_phase, "blocked");
  assert.equal(e.resume_phase, initialPhase);
});

test("Queries.refreshFinderReadiness discards a delayed older scan instead of clobbering newer state", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.auto_schedule = true;
  const supervisor = Id.SessionId.make("ses_finder-supervisor");
  f.runtime.sessions.set(supervisor, {
    id: supervisor,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(supervisor));

  const gate = Deferred.makeUnsafe<void>();
  const startedFirst = Deferred.makeUnsafe<void>();
  let calls = 0;
  const originalSession = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id) => {
    calls++;
    if (calls === 1) {
      return Deferred.succeed(startedFirst, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.andThen(Effect.fail(new CrewError("UNAVAILABLE", "stale authority failure"))),
      );
    }
    return originalSession(id);
  };

  const result = await run(
    Effect.gen(function* () {
      const firstFiber = yield* Effect.forkChild(f.controller.queries.refreshFinderReadiness());
      yield* Deferred.await(startedFirst);
      // Advance record revision before the second (newer) scan.
      const project = (yield* f.records.project(Id.RepositoryId.make("api")))!;
      yield* f.records.saveProject({ ...project, diagnostic_turns: project.diagnostic_turns + 1 });
      const secondChanged = yield* f.controller.queries.refreshFinderReadiness();
      yield* Deferred.succeed(gate, undefined);
      const firstChanged = yield* Fiber.join(firstFiber);
      const population = yield* f.controller.queries.bindingPopulation();
      const finder = yield* f.controller.queries.observeFinder({ state: "all" });
      return { firstChanged, secondChanged, population, finder };
    }),
  );

  assert.equal(result.secondChanged, true);
  assert.equal(result.firstChanged, false);
  assert.ok(
    result.population.capacity,
    "Newer finder capacity must remain active at current revision",
  );
  assert.ok(result.finder.capacity, "ObserveFinder must still observe newer cached capacity");
});

test("Queries.readinessFor and WorkAdmission.createWork do not fetch external authority while holding coordination locks", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.auto_schedule = true;
  const supervisor = Id.SessionId.make("ses_lock-check-supervisor");
  f.runtime.sessions.set(supervisor, {
    id: supervisor,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(supervisor));

  const heldStates: boolean[] = [];
  const originalSession = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id) =>
    Effect.sync(() => {
      heldStates.push(f.locks.held);
    }).pipe(Effect.andThen(originalSession(id)));

  const created = await run(
    f.controller.createWork(
      {
        repository_id: Id.RepositoryId.make("api"),
        title: "Lock-free readiness check",
        description: "Verify external calls run outside controller lock",
        request_id: Id.RequestId.make("lock-free-create"),
      },
      supervisor,
    ),
  );
  await run(f.controller.queries.readinessFor([created.issue.id]));

  assert.ok(heldStates.length >= 2);
  assert.deepEqual(
    heldStates,
    heldStates.map(() => false),
  );
});

test("CrewError.from falls back to UNEXPECTED when code is empty or whitespace without throwing a defect", () => {
  const empty = CrewError.from({ code: "", message: "x" });
  assert.ok(empty instanceof CrewError);
  assert.equal(empty.code, "UNEXPECTED");
  assert.equal(empty.message, "x");

  const whitespace = CrewError.from({ code: "   \t\n ", message: "y" });
  assert.ok(whitespace instanceof CrewError);
  assert.equal(whitespace.code, "UNEXPECTED");
  assert.equal(whitespace.message, "y");

  const valid = CrewError.from({ code: "CUSTOM_ERR", message: "z" });
  assert.equal(valid.code, "CUSTOM_ERR");
  assert.equal(valid.message, "z");
});

test("SQLite rollback guards in SqliteWorkGraph and InboxIndex preserve the original error after auto-rollback", async (t) => {
  const { graph, path } = await workDatabase(t);
  const db = new DatabaseSync(path);
  t.onTestFinished(() => db.close());

  db.exec(`
    CREATE TRIGGER fail_issue_insert BEFORE INSERT ON issues
    BEGIN
      SELECT RAISE(ROLLBACK, 'original_graph_trigger_error');
    END;
  `);

  await assert.rejects(run(graph.create(goal("auto-rollback-graph"))), (error: unknown) => {
    assert.ok(error instanceof CrewError);
    assert.match(error.message, /original_graph_trigger_error/);
    assert.doesNotMatch(error.message, /no transaction is active/);
    return true;
  });

  const inboxDb = new DatabaseSync(":memory:");
  t.onTestFinished(() => inboxDb.close());
  inboxDb.exec(`
    CREATE TABLE issues (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    ${inboxTables}
    CREATE TRIGGER fail_scan_insert BEFORE INSERT ON github_scans
    BEGIN
      SELECT RAISE(ROLLBACK, 'original_inbox_trigger_error');
    END;
  `);
  const inbox = new InboxIndex(inboxDb);
  assert.throws(
    () =>
      inbox.failedScan("stream-1", {
        mode: "open",
        start: 1,
        last: 1,
        full: 1,
        watermark: 1,
        high: 1,
        repo: "org/repo",
        viewer: "bot",
        attempt: 1,
        retry: 2,
        denied: false,
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /original_inbox_trigger_error/);
      assert.doesNotMatch(message, /no transaction is active/);
      return true;
    },
  );
});
