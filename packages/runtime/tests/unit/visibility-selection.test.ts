import { Schema } from "effect";
import { goal as workGoal } from "../helpers/work-goal.ts";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { rename } from "node:fs/promises";

import { fixture, planned, applying } from "../fixtures.ts";
import * as documents from "../../src/workflow/read-model/documents.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility } from "../../src/visibility/protocol.ts";
test("overview observes one ticket without reading planning evidence, even with a missing worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f)),
    view = new Visibility(f.controller);
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    status(execution).pipe(
      Effect.map((s) => ({
        ...s,
        artifacts: [
          {
            id: Id.ArtifactId.make("proposal"),
            status: "done" as const,
            outputPath: Id.RelativePath.make("proposal.md"),
          },
        ],
      })),
    );
  const task = vi.spyOn(f.controller.queries, "observeTask");
  const planning = [
    vi.spyOn(f.controller.queries, "specStatus"),
    vi.spyOn(f.controller.queries, "specApply"),
    vi.spyOn(f.controller.queries, "planDocuments"),
    vi.spyOn(documents, "changeDocument"),
  ];
  t.onTestFinished(() => {
    for (const spy of planning) spy.mockRestore();
  });
  const overview = await run(view.overview(e.issue_id));
  assert.deepEqual(Object.keys(overview).sort(), ["description", "errors", "intent", "work"]);
  assert.ok(Schema.is(visibility.methods.overview.output)(overview));
  assert.equal(task.mock.calls.length, 1);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [0, 0, 0, 0],
  );
  const full = await run(view.detail(e.issue_id));
  assert.equal(task.mock.calls.length, 2);
  assert.equal(full.description, overview.description);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [1, 1, 1, 1],
  );
  await rename(e.worktree_directory!, e.worktree_directory! + "-unavailable");
  assert.deepEqual((await run(view.overview(e.issue_id))).errors, []);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [1, 1, 1, 1],
  );
});

test("task detail avoids collection scans and fleet observations scan once with fresh data", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const counts = { project: 0, execution: 0, setup: 0 };
  for (const [key, method] of [
    ["project", "projectScan"],
    ["execution", "executionScan"],
    ["setup", "setupScan"],
  ] as const) {
    const read = f.records[method];
    vi.spyOn(f.records, method, "get").mockImplementation(() => {
      counts[key]++;
      return read;
    });
  }
  const view = new Visibility(f.controller);
  await run(view.detail(e.issue_id));
  assert.deepEqual(counts, { project: 0, execution: 0, setup: 0 });
  f.seed.named(Id.IssueId.make("later"));
  assert.ok((await run(view.snapshot())).work.some((w) => w.issue_id === "later"));
  assert.deepEqual(counts, { project: 1, execution: 1, setup: 1 });
});

test("commit invalidations observe durable evidence and failed writes do not enqueue", async (t) => {
  const { Invalidations } = await import("../../src/invalidations.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  let commits = 0;
  const events = {
    committed: f.records.execution(e.issue_id).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          assert.ok(saved);
          commits++;
        }),
      ),
      Effect.asVoid,
      Effect.orDie,
    ),
    publish: () => events.committed,
    take: Effect.never,
  };
  await run(f.records.save(e).pipe(Effect.provideService(Invalidations, events)));
  assert.equal(commits, 1);
  const stale = { ...e, control_generation: e.control_generation + 10 };
  await assert.rejects(
    run(f.records.save(stale).pipe(Effect.provideService(Invalidations, events))),
    /generation/,
  );
  assert.equal(commits, 1);
});

test("selected task among unrelated active workers performs no scans, fleet readiness or unrelated native/lead reads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const base = await run(applying(f));
  for (let index = 0; index < 75; index++) {
    const id = Id.IssueId.make(`unrelated-${index}`);
    f.seed.named(id);
    await run(
      f.records.create({
        ...structuredClone(base),
        issue_id: id,
        execution_id: Id.ExecutionId.make(`exec-unrelated-${index}`),
        apply_session_id: Id.SessionId.make(`ses_unrelated-${index}`),
      }),
    );
  }
  const session = f.runtime.session.bind(f.runtime);
  const sessions: string[] = [];
  f.runtime.session = (id) => {
    sessions.push(id);
    assert.equal(
      id,
      base.apply_session_id,
      "Only the selected task's active native session may be observed",
    );
    return session(id);
  };
  f.records.store.entries = () =>
    Effect.fail(new CrewError("UNRELATED_SCAN", "Task detail must not scan unrelated records"));
  f.controller.queries.ready = () =>
    Effect.fail(new CrewError("FLEET_READY", "Task detail must not compute fleet readiness"));
  f.controller.queries.leadOverview = () =>
    Effect.fail(new CrewError("LEAD_SCAN", "Task detail must not read lead history"));
  const detail = await run(new Visibility(f.controller).detail(base.issue_id));
  assert.equal(detail.work.issue_id, base.issue_id);
  assert.equal(detail.work.phase, "applying");
  assert.equal(detail.work.eligibility_observed, false);
  assert.equal(detail.work.eligible, false);
  assert.deepEqual(sessions, [base.apply_session_id]);
  assert.ok(Schema.is(visibility.methods.detail.output)(detail));
});

test("selected detail keeps unavailable native activity and malformed retained evidence local", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const base = await run(applying(f));
  const session = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id) =>
    id === base.apply_session_id
      ? Effect.fail(new CrewError("WORKER_UNAVAILABLE", "Selected native activity unavailable"))
      : session(id);
  const view = new Visibility(f.controller);
  const unavailable = await run(view.detail(base.issue_id));
  assert.equal(unavailable.work.phase, "applying");
  assert.equal(unavailable.work.supervision?.native_activity, "unavailable");
  const { id: healthy } = await run(f.work.create(workGoal("healthy-unstarted")));
  const key = Id.StorageKey.make(`execution/${base.issue_id}`);
  const future = { ...structuredClone(base), schema_version: 99 };
  await run(f.records.store.set(key, future));
  const malformed = await run(view.detail(base.issue_id));
  assert.equal(malformed.work.phase, "recovery_required");
  assert.equal(malformed.work.supervision?.native_activity, "unavailable");
  assert.match(malformed.errors.join(" "), /Unsupported record version/);
  assert.equal((await run(view.detail(healthy))).work.issue_id, healthy);
  assert.deepEqual(await run(f.records.store.get(key)), future);
});

test("binding summaries resolve off-page retained tasks without fleet, worker or planning reads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  for (let i = 0; i < 55; i++) {
    const id = Id.IssueId.make(`abra-closed-${String(i).padStart(2, "0")}`);
    f.seed.named(id);
    f.seed.close(id);
  }
  const view = new Visibility(f.controller);
  assert.equal(
    (await run(view.snapshot())).work.some((row) => row.issue_id === "abra-closed-54"),
    false,
  );
  let unrelated = 0;
  const forbidden = () => {
    unrelated++;
    return Effect.fail(new CrewError("TEST", "Unrelated read"));
  };
  f.controller.queries.ready = forbidden;
  f.controller.queries.supervisionAggregate = forbidden;
  f.controller.queries.inspectWorker = forbidden;
  f.controller.queries.planDocuments = forbidden;
  const id = Id.IssueId.make("abra-closed-54"),
    missing = Id.IssueId.make("abra-foreign");
  const result = await run(view.binding({ issue_ids: [id, id, missing] }));
  assert.deepEqual(
    result.work.map((row) => row.issue_id),
    [id],
  );
  assert.equal(result.work[0]!.issue_status, "closed");
  assert.deepEqual(result.coverage.unavailable_ids, [missing]);
  assert.equal(result.coverage.status, "unavailable");
  assert.deepEqual(
    result.results.map((entry) => entry.status),
    ["available", "missing"],
  );
  await run(f.controller.queries.refreshFinderReadiness());
  const all = await run(view.binding({ issue_ids: [id], include_population: true }));
  assert.deepEqual(all.capacity, {
    workers: 0,
    worker_limit: f.config.max_workers,
    retained: 0,
    retained_limit: f.config.max_executions,
    auto_schedule: f.config.auto_schedule,
    setups: [],
    setup_count: 0,
  });
  const { capacity, project_capacity, entries } = await run(
    view.find({
      repository_id: Id.RepositoryId.make("api"),
      search: "nothing-matches-this",
    }),
  );
  assert.equal(entries.length, 0);
  assert.equal(capacity?.worker_limit, f.config.max_workers);
  assert.equal(capacity?.retained, 0);
  const registered = await run(f.records.project(Id.RepositoryId.make("api")));
  assert.equal(project_capacity?.retained_limit, registered!.max_executions);
  assert.equal(all.work.length, 55);
  assert.equal(all.coverage.total, 55);
  assert.equal(unrelated, 0);
  await assert.rejects(
    run(view.binding({ issue_ids: Array.from({ length: 101 }, () => id) })),
    /binding read/,
  );
  const observe = f.controller.queries.observeTask;
  const broken = Id.IssueId.make("abra-closed-53");
  f.controller.queries.observeTask = (id, history) =>
    id === broken
      ? Effect.fail(new CrewError("STORAGE", "Unavailable retained evidence"))
      : observe(id, history);
  const partial = await run(view.binding({ issue_ids: [id, broken] }));
  assert.equal(partial.work.length, 1);
  assert.equal(partial.coverage.status, "unavailable");
  assert.deepEqual(
    partial.results.map((entry) => entry.status),
    ["available", "unavailable"],
  );
  assert.equal(f.runtime.prompts, 0);
});

test("worker inspection reads only its ticket and admitted native session", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(applying(f));
  const foreign = Id.SessionId.make("ses_foreign");
  await run(
    f.records.create({
      ...e,
      issue_id: Id.IssueId.make("other-ticket"),
      execution_id: Id.ExecutionId.make("exec-other"),
      apply_session_id: foreign,
    }),
  );
  const current = e.apply_session_id!;
  const historical = e.explore_session_id!;
  e = { ...e, explore_session_id: undefined };
  e = {
    ...e,
    rounds: [
      {
        schema_version: 1,
        id: Id.RoundId.make("round-1"),
        ordinal: 1,
        generation: e.control_generation,
        source: "review",
        starting_head: e.base_commit!,
        plan_fingerprint: e.plan_fingerprint!,
        findings: [],
        instructions: "Apply review feedback",
        openspec_change: e.openspec_change,
        approval_receipts: e.approval_receipts,
        worker_sessions: [{ id: historical, role: "explore" }],
        created_at: 1,
      },
    ],
  };
  await run(f.records.save(e));

  const read = vi.spyOn(f.records, "execution");
  const scans = vi.spyOn(f.records.store, "entries");
  const native = vi.spyOn(f.runtime, "session");
  const inspect = f.controller.queries.inspectWorker;
  for (const [id, role] of [
    [current, "apply"],
    [historical, "explore"],
  ] as const) {
    assert.equal((await run(inspect(e.issue_id, id))).role, role);
    assert.deepEqual(read.mock.calls, [[e.issue_id]]);
    assert.deepEqual(native.mock.calls, [[id]]);
    read.mockClear();
    native.mockClear();
  }
  const missing = Id.IssueId.make("missing-ticket");
  assert.equal((await run(Effect.flip(inspect(e.issue_id, foreign)))).code, "NOT_FOUND");
  assert.equal((await run(Effect.flip(inspect(missing, current)))).code, "EXECUTION_MISSING");
  assert.deepEqual(read.mock.calls, [[e.issue_id], [missing]]);
  assert.deepEqual(native.mock.calls, []);
  native.mockReturnValueOnce(Effect.fail(new CrewError("SESSION_MISSING", "Gone")));
  assert.equal((await run(Effect.flip(inspect(e.issue_id, current)))).code, "WORKER_UNAVAILABLE");
  assert.deepEqual(native.mock.calls, [[current]]);
  assert.deepEqual(scans.mock.calls, []);
});
