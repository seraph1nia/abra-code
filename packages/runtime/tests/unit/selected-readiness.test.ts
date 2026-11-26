import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { goal } from "../helpers/work-goal.ts";
import * as Id from "@abracode/contracts/identities";

test("selected controller reads hydrate only requested work at both population sizes", async (t) => {
  for (const size of [0, 1000]) {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    for (let i = 0; i < size; i++) await run(f.work.create(goal(`unrelated-${i}`)));
    const hydrated: string[] = [];
    let related = 0;
    const hydrate = f.work["queries"].hydrate.bind(f.work["queries"]);
    f.work["queries"].hydrate = (rows, links) => {
      hydrated.push(...rows.map((row) => String(row.id)));
      return hydrate(rows, links);
    };
    const evidence = f.work["queries"].taskRows.bind(f.work["queries"]);
    f.work["queries"].taskRows = (issues) => {
      const rows = evidence(issues);
      related += rows.reduce((sum, row) => sum + row.dependencies.length, 0);
      return rows;
    };
    const sql = vi.spyOn(f.seed.db, "prepare");
    const projects = vi.spyOn(f.records, "projectScan", "get");
    const executions = vi.spyOn(f.records, "executionScan", "get");
    const setups = vi.spyOn(f.records, "setupScan", "get");
    function verify(
      ids: string[],
      edgeCount: number,
      expectedRows: number,
      expectedScans = [1, 1, 1],
    ) {
      assert.deepEqual(
        [projects, executions, setups].map((s) => s.mock.calls.length),
        expectedScans,
      );
      assert.ok(
        hydrated.every((id) => ids.includes(id)),
        "Unrelated issue was hydrated",
      );
      assert.equal(hydrated.length, expectedRows);
      assert.equal(related, edgeCount);
      assert.equal(
        sql.mock.calls.filter(([query]) => /ROW_NUMBER\(\) OVER|MAX\(e\.at\)/.test(query)).length,
        0,
      );
      for (const scan of [projects, executions, setups]) {
        scan.mockClear();
      }
      hydrated.length = related = 0;
      sql.mockClear();
    }
    const sender = Id.SessionId.make("ses_supervisor");
    const input = goal("selected");
    const single = await run(f.controller.createWork(input, sender));
    verify([single.issue.id], 0, 1);
    const task = {
      client_key: "one",
      repository_id: input.repository_id,
      title: "One",
      description: "One request",
    };
    const one = await run(
      f.controller.createWorkBatch(
        { request_id: Id.RequestId.make("one-item"), tasks: [task] },
        sender,
      ),
    );
    verify([one.tasks[0]!.issue.id], 0, 1);
    const batch = await run(
      f.controller.createWorkBatch(
        {
          request_id: Id.RequestId.make("multi"),
          tasks: [
            { ...task, dependencies: [{ type: "local", client_key: "two" }] },
            { ...task, client_key: "two" },
          ],
        },
        sender,
      ),
    );
    verify(
      batch.tasks.map((t) => t.issue.id),
      1,
      2,
    );
    const fleet = await run(f.controller.ready());
    for (const item of [single, ...one.tasks, ...batch.tasks])
      assert.deepEqual(
        item.readiness,
        fleet.find((r) => r.issue.id === item.issue.id),
      );
    hydrated.length = related = 0;
    sql.mockClear();
    for (const scan of [projects, executions, setups]) scan.mockClear();
    f.config.max_workers = 1;
    const active = await run(f.controller.start(single.issue.id));
    // Configured admission also supplies this issue to its definition preparation without redundant re-reads.
    verify([single.issue.id], 0, 3, [1, 2, 2]);
    await assert.rejects(run(f.controller.start(one.tasks[0]!.issue.id)), { code: "NOT_READY" });
    verify([one.tasks[0]!.issue.id], 0, 1);
    f.config.max_workers = 2;
    await run(f.records.store.set(Id.StorageKey.make("execution/broken"), { bad: true }));
    await assert.rejects(
      run(f.controller.start(one.tasks[0]!.issue.id)),
      /Unavailable durable records/,
    );
    verify([one.tasks[0]!.issue.id], 0, 1);
    await run(f.work.close(single.issue.id, active.execution_id));
    hydrated.length = 0;
    const closed = await run(f.controller.createWork(input, sender));
    assert.equal(closed.issue.id, single.issue.id);
    assert.equal(closed.readiness, undefined);
    verify([single.issue.id], 0, 2);
  }
});
