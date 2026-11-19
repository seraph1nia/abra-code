import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Exit, Scope } from "effect";

import { test } from "vite-plus/test";
import * as Id from "../../src/identities.ts";
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
