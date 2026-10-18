import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import * as Id from "../../src/identities.ts";
import { fleetCounts, fleetState, localDay } from "../../src/visibility/fleet.ts";
import { type WorkItem, WorkSnapshotSchema } from "../../src/visibility/protocol.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { Schema } from "effect";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";

const item = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  issue_id: Id.IssueId.make("fleet-task"),
  title: "Task",
  priority: 1,
  issue_status: "open",
  sessions: [],
  eligible: false,
  blockers: [],
  ...overrides,
});
const observed = (activity: NonNullable<WorkItem["supervision"]>["native_activity"]) => ({
  primary: "pending_admission" as const,
  native_activity: activity,
  observed_at: Id.Timestamp.make("2026-10-18T10:00:00.000Z"),
});
test("fleet classes separate native queue, readiness, capacity and unknown execution", () => {
  const cases: Array<[WorkItem, ReturnType<typeof fleetState>]> = [
    [item({ eligible: true }), "ready"],
    [item({ supervision: observed("queued") }), "native_queued"],
    [item({ supervision: observed("running") }), "running"],
    [item({ phase: "applying", supervision: observed("unavailable") }), "unknown"],
    [item({ phase: "applying", supervision: observed("unknown") }), "unknown"],
    [item({ blocker_details: [{ code: "capacity", message: "Occupied" }] }), "capacity_wait"],
    [item({ blocker_details: [{ code: "dependency", message: "Parent" }] }), "dependency_wait"],
    [item({ phase: "awaiting_plan_approval", supervision: observed("running") }), "human_wait"],
    [item({ phase: "completed", issue_status: "open" }), "recovery_required"],
    [item({ issue_status: "closed", phase: "applying" }), "recovery_required"],
    [item({ issue_status: "closed" }), "completed"],
  ];
  for (const [work, state] of cases) assert.equal(fleetState(work), state);
  assert.equal(
    Object.values(fleetCounts(cases.map(([work]) => work))).reduce((n, count) => n + count, 0),
    cases.length,
  );
});
test("host-local completion day uses midnight and calendar DST boundaries", () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = "Europe/Amsterdam";
    for (const [at, hours] of [
      ["2026-03-29T12:00:00Z", 23],
      ["2026-10-25T12:00:00Z", 25],
    ] as const) {
      const day = localDay(Date.parse(at));
      assert.equal(Date.parse(day.day_end) - Date.parse(day.day_start), hours * 3600000);
      assert.equal(new Date(day.day_start).getHours(), 0);
      assert.equal(localDay(Date.parse(day.day_end) - 1).day_start, day.day_start);
      assert.equal(localDay(Date.parse(day.day_end)).day_start, day.day_end);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
test("fleet counts and closure evidence cover closed tickets outside the visible page", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  for (let n = 0; n < 56; n++) {
    const id = Id.IssueId.make(`done-${String(n).padStart(2, "0")}`);
    f.work.add(id);
    f.work.issues.get(id)!.status = "closed";
  }
  f.work.completions = () =>
    Effect.succeed([
      { issue_id: Id.IssueId.make("done-55"), at: Id.Timestamp.make(new Date().toISOString()) },
    ]);
  const view = new Visibility(f.controller);
  const first = await run(view.snapshot());
  const second = await run(view.snapshot(1));
  assert.equal(
    first.work.some((w) => w.issue_id === "done-55"),
    false,
  );
  assert.equal(first.fleet!.counts.completed, 56);
  assert.equal(first.fleet!.counts.human_wait, 1);
  assert.equal(first.fleet!.total, 57);
  assert.equal(first.fleet!.completed_today, 1);
  assert.deepEqual(first.fleet!.counts, second.fleet!.counts);
  assert.equal(second.fleet!.completed_today, 1);
  assert.equal(
    first.fleet!.attention.some((w) => w.issue_id === e.issue_id),
    true,
  );
  assert.equal(Schema.is(WorkSnapshotSchema)(first), true);
});
