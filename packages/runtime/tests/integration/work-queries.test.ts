import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Exit, Scope } from "effect";

import { test } from "vite-plus/test";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { workDatabase, workGraphAt } from "../helpers/work-database.ts";

import { goal } from "../helpers/work-goal.ts";

test("file-backed legacy identifier ordering and normalized request bytes survive paged queries", async (t) => {
  const { graph: initial, path, scope } = await workDatabase(t);
  const inputs = ["a-A", "a_a", "A", "a", "Z", "z-9"].map(goal);
  const ids = inputs.map((_, index) =>
    Id.IssueId.make(["a-A", "a_a", "A", "a", "Z", "z-9"][index]!),
  );
  const created = [];
  for (const input of inputs) created.push(await run(initial.create(input)));
  await run(Scope.close(scope, Exit.void));
  const db = new DatabaseSync(path);
  try {
    db.exec("DROP INDEX issues_repository_priority; PRAGMA user_version = 7");
    db.exec("BEGIN; PRAGMA defer_foreign_keys = ON");
    for (const [index, issue] of created.entries()) {
      db.prepare("UPDATE issues SET id = ? WHERE id = ?").run(ids[index]!, issue.id);
      db.prepare("UPDATE work_events SET issue_id = ? WHERE issue_id = ?").run(
        ids[index]!,
        issue.id,
      );
    }
    db.exec("COMMIT");
    const { graph } = await workGraphAt(t, path);
    const requests = db
      .prepare("SELECT request_id, request_input FROM issues ORDER BY request_id")
      .all();
    const expected = [...ids].sort();
    const observed = [];
    for (let offset = 0; offset < ids.length; offset += 2) {
      const page = await run(graph.find({ state: "all", limit: 2, offset }));
      observed.push(...page.entries.map((issue) => issue.id));
      assert.equal(page.total, ids.length);
    }
    assert.deepEqual(observed, expected);
    assert.deepEqual(
      db.prepare("SELECT request_id, request_input FROM issues ORDER BY request_id").all(),
      requests,
    );
    assert.equal((await run(graph.create(inputs[0]!))).id, ids[0]);
    assert.deepEqual(
      (await run(graph.find({ state: "all", search: "ÉTUDE" }))).entries.map((issue) => issue.id),
      expected,
    );
  } finally {
    db.close();
  }
});

test("a legacy dangling dependency cannot become eligible through batched claim reads", async (t) => {
  const { graph, path } = await workDatabase(t);
  const issue = await run(graph.create(goal("dangling")));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("INSERT INTO dependencies(issue_id, dependency_id) VALUES (?, ?)").run(
      issue.id,
      "missing-dependency",
    );
  } finally {
    db.close();
  }
  const observed = await run(graph.task(issue.id));
  assert.equal(observed.dependencies[0]!.status, "unavailable");
  await assert.rejects(
    run(graph.claim(issue.id, Id.ExecutionId.make("actor"))),
    (error: unknown) => error instanceof CrewError && error.code === "ISSUE_MISSING",
  );
  assert.equal((await run(graph.show(issue.id))).status, "open");
});

test("exact closed ID leads every title match before filtered pagination", async (t) => {
  const { graph } = await workDatabase(t);
  const exact = await run(graph.create({ ...goal("exact"), priority: 3 }));
  const owner = Id.ExecutionId.make("exact-owner");
  await run(graph.claim(exact.id, owner));
  await run(graph.close(exact.id, owner));
  const others = [];
  for (let i = 0; i < 4; i++) {
    others.push(
      (await run(graph.create({ ...goal("prefix-" + i), title: "See " + exact.id, priority: 1 })))
        .id,
    );
  }
  const observed = [];
  for (const offset of [0, 2, 4]) {
    const page = await run(graph.find({ search: exact.id, state: "all", offset, limit: 2 }));
    assert.equal(page.total, 5);
    observed.push(...page.entries.map((entry) => entry.id));
  }
  assert.deepEqual(observed, [exact.id, ...others.sort()]);
  assert.deepEqual(
    (await run(graph.find({ search: exact.id, state: "closed" }))).entries.map((entry) => entry.id),
    [exact.id],
  );
});
