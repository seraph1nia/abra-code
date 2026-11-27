import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { IssueId, RepositoryId } from "@abracode/contracts/identities";
import { Visibility } from "../../src/visibility/read-model.ts";
import { WorkPageSchema } from "@abracode/contracts/visibility/discovery-contracts";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";

test("work discovery searches all retained tasks and keeps fleet totals independent of pages", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));

  for (let i = 0; i < 56; i++) {
    const id = IssueId.make(`history-${String(i).padStart(2, "0")}`);
    f.seed.named(id, RepositoryId.make(i % 2 ? "docs" : "frontend"), [], {
      title: `Retained result ${i}`,
    });
    f.seed.close(id);
  }
  const execution = await run(planned(f, undefined, {}, [IssueId.make("history-55")]));
  const formsBeforeRead = [...f.runtime.forms];
  const view = new Visibility(f.controller);
  const first = Schema.decodeSync(WorkPageSchema)(
    await run(view.find({ state: "closed", limit: 20 })),
  );
  const second = await run(view.find({ state: "closed", limit: 20, offset: first.next_offset }));
  const last = await run(view.find({ state: "closed", limit: 20, offset: second.next_offset }));
  assert.equal(first.total, 56);
  assert.equal(first.entries.length, 20);
  assert.equal(second.entries.length, 20);
  assert.equal(last.entries.length, 16);
  assert.equal(last.next_offset, undefined);
  assert.equal(
    new Set([...first.entries, ...second.entries, ...last.entries].map((work) => work.issue_id))
      .size,
    56,
  );
  assert.deepEqual(first.fleet?.counts, last.fleet?.counts);
  assert.equal(first.fleet?.total, last.fleet?.total);
  assert.equal(first.fleet?.completed_today, last.fleet?.completed_today);
  const byID = await run(view.find({ state: "all", search: "HISTORY-55" }));
  assert.equal(byID.total, 1);
  assert.equal(byID.entries[0].issue_id, "history-55");
  const byTitle = await run(
    view.find({ state: "closed", repository_id: RepositoryId.make("docs"), search: "result 55" }),
  );
  assert.equal(byTitle.entries[0].issue_id, "history-55");
  assert.equal(
    (await run(view.find({ state: "closed", repository_id: RepositoryId.make("frontend") }))).total,
    28,
  );
  const detail = await run(view.detail(IssueId.make("history-55")));
  assert.equal(detail.work.title, "Retained result 55");
  assert.equal(detail.work.repository_id, "docs");
  assert.equal(detail.work.supervision?.primary, "completed");
  const dependent = await run(view.detail(execution.issue_id));
  assert.deepEqual(dependent.work.dependencies, ["history-55"]);
  assert.equal(dependent.work.dependency_count, 1);
  assert.deepEqual(detail.work.dependencies, []);
  assert.deepEqual([...f.runtime.forms], formsBeforeRead);
});

test("discovery bounds are checked before observation and do not silently clamp invalid requests", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const view = new Visibility(f.controller);
  for (const query of [{ limit: 51 }, { limit: 0 }, { offset: -1 }, { search: "x".repeat(257) }]) {
    await assert.rejects(run(view.find(query)), /Work discovery/);
  }
  const page = await run(view.find({ offset: 200, state: "closed" }));
  assert.equal(page.total, 0);
  assert.equal(page.entries.length, 0);
  assert.equal(page.next_offset, undefined);
});
