import assert from "node:assert/strict";
import { test, type TestContext } from "vite-plus/test";
import { Effect } from "effect";
import { Agent } from "@opencode/schema/agent";
import { Scheduler } from "../../src/scheduler/scheduler.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

async function setup(t: TestContext) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.config.auto_schedule = true;
  await run(f.controller.recordSupervisor(supervisor));
  f.runtime.sessions.set(supervisor, {
    id: supervisor,
    directory: f.config.home,
    agent: Agent.ID.make("abra"),
    busy: false,
  });
  return { ...f, supervisor };
}

test("equal-priority repositories rotate fairly while failures do not block other admissions", async (t) => {
  const f = await setup(t),
    order: string[] = [];
  for (const repo of ["api", "frontend", "worker"])
    for (let index = 1; index <= 2; index++)
      f.work.add(Id.IssueId.make(`${repo}-${index}`), Id.RepositoryId.make(repo));
  f.controller.start = (id) =>
    Effect.sync(() => {
      order.push(id);
    }).pipe(
      Effect.andThen(Effect.fail(new CrewError("FIXTURE_ADMISSION", "Scripted failed admission"))),
    );
  const result = await run(f.scheduler.tick());
  assert.equal(result.length, 6);
  assert.deepEqual(order, ["api-1", "frontend-1", "worker-1", "api-2", "frontend-2", "worker-2"]);
  assert.equal(f.runtime.creates, 0);
});

test("highest priority wins; cursor crash does not duplicate a retained claim on restart", async (t) => {
  const f = await setup(t);
  f.config.max_workers = 1;
  f.config.max_executions = 4;
  f.work.add(Id.IssueId.make("api-one"));
  f.work.add(Id.IssueId.make("frontend-one"), Id.RepositoryId.make("frontend"));
  f.work.add(Id.IssueId.make("worker-one"), Id.RepositoryId.make("worker"));
  f.work.issues.get("worker-one")!.priority = 0;
  const set = f.records.store.set.bind(f.records.store);
  f.records.store.set = (key, value) =>
    key === "scheduler/rotation"
      ? Effect.die(new Error("Simulated cursor commit crash"))
      : set(key, value);
  await assert.rejects(run(f.scheduler.tick()), /Simulated cursor commit crash/);
  const first = await run(f.controller.get(Id.IssueId.make("worker-one")));
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.work.claims, 1);
  f.records.store.set = set;
  const resumed = new Scheduler(f.controller, f.records);
  await run(resumed.tick());
  assert.equal(f.runtime.creates, 1);
  await run(f.controller.control(first.issue_id, "pause"));
  await run(resumed.tick());
  assert.equal(f.runtime.creates, 2);
  const cursor = await run(f.records.store.get(Id.StorageKey.make("scheduler/rotation")));
  assert.deepEqual(cursor, { schema_version: 1, last: [{ priority: 1, repository_id: "api" }] });
  // A fresh scheduler keeps the confirmed fairness cursor, while the actual
  // retained executions and graph claims continue to own duplicate prevention.
  await run(f.controller.control(Id.IssueId.make("api-one"), "pause"));
  await run(new Scheduler(f.controller, f.records).tick());
  assert.equal(
    (await run(f.controller.get(Id.IssueId.make("frontend-one")))).active_role,
    "explore",
  );
  assert.equal(f.work.claims, 3);
});

test("automatic admission requires native central Abra and does not spend a cursor without it", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.auto_schedule = true;
  f.work.add(Id.IssueId.make("no-authority"));
  assert.deepEqual(await run(f.scheduler.tick()), []);
  assert.ok(
    (await run(f.controller.ready()))[0].blocker_details.some((b) => b.code === "authority"),
  );
  const supervisor = Id.SessionId.make("ses_missing");
  await run(f.controller.recordSupervisor(supervisor));
  assert.deepEqual(await run(f.scheduler.tick()), []);
  f.runtime.sessions.set(supervisor, {
    id: supervisor,
    directory: f.config.home,
    agent: Agent.ID.make("build"),
    busy: false,
  });
  assert.deepEqual(await run(f.scheduler.tick()), []);
  f.runtime.sessions.get(supervisor)!.agent = Agent.ID.make("abra");
  f.runtime.sessions.get(supervisor)!.directory = Id.AbsolutePath.make("/other");
  assert.deepEqual(await run(f.scheduler.tick()), []);
  assert.equal(await run(f.records.store.get(Id.StorageKey.make("scheduler/rotation"))), undefined);
  assert.equal(f.runtime.creates, 0);
});

test("overlapping scheduler ticks observe fresh capacity and never duplicate claims", async (t) => {
  const f = await setup(t);
  f.config.max_workers = 2;
  f.config.max_executions = 4;
  f.work.add(Id.IssueId.make("one"));
  f.work.add(Id.IssueId.make("two"), Id.RepositoryId.make("frontend"));
  f.work.add(Id.IssueId.make("three"), Id.RepositoryId.make("worker"));
  await Promise.all([run(f.scheduler.tick()), run(f.scheduler.tick())]);
  assert.equal(f.runtime.creates, 2);
  assert.equal(f.work.claims, 2);
  const queued = (await run(f.controller.ready())).find((row) => row.issue.id === "three")!;
  assert.ok(queued.blocker_details.some((b) => b.capacity_kind === "active"));
  const first = (await run(f.records.executions()))[0];
  await run(f.controller.control(first.issue_id, "pause"));
  await run(f.scheduler.tick());
  assert.equal(f.runtime.creates, 3);
  assert.equal(f.work.claims, 3);
  assert.equal((await run(f.controller.get(first.issue_id))).current_phase, "interrupted");
});

test("ambiguous native admission keeps capacity and a paused execution is not automatically resumed", async (t) => {
  const f = await setup(t);
  f.config.max_workers = 1;
  f.config.max_executions = 4;
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.max_executions = 3;
  await run(f.records.saveProject(project));
  f.work.add(Id.IssueId.make("first"));
  f.work.add(Id.IssueId.make("next"), Id.RepositoryId.make("frontend"));
  const prompt = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (...args) =>
    prompt(...args).pipe(
      Effect.andThen(Effect.fail(new CrewError("RESPONSE_LOST", "Native response lost"))),
    );
  await run(f.scheduler.tick());
  await run(f.scheduler.tick());
  const e = await run(f.controller.get(Id.IssueId.make("first")));
  assert.equal(e.capacity_reservation!.status, "uncertain");
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.work.claims, 1);
  f.runtime.prompt = prompt;
  await run(f.controller.control(e.issue_id, "pause"));
  await run(f.scheduler.tick());
  assert.equal(f.runtime.creates, 2);
  assert.equal(f.work.claims, 2);
  assert.equal((await run(f.controller.get(e.issue_id))).current_phase, "interrupted");
});
