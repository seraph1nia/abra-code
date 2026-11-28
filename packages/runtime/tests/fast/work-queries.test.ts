import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, vi } from "vite-plus/test";
import * as Id from "@abracode/contracts/identities";
import type { WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
import { run } from "../effects.ts";
import { workGraphAt, workDatabase } from "../helpers/work-database.ts";
import { goal } from "../helpers/work-goal.ts";

const selectsIssueRows = (sql: string) => /^SELECT \*.* FROM issues\b/i.test(sql);

test("real in-memory finder pages preserve search, totals, ordering, dependencies and complete-population readiness with constant SQL calls", async (t) => {
  const { graph } = await workGraphAt(t);
  const dependency = await run(graph.create(goal("dependency")));
  await run(graph.claim(dependency.id, Id.ExecutionId.make("dependency-owner")));
  await run(graph.close(dependency.id, Id.ExecutionId.make("dependency-owner")));
  for (let index = 0; index < 160; index++)
    await run(
      graph.create({
        ...goal(`item-${index}`),
        priority: index % 5,
        repository_id: Id.RepositoryId.make(index % 2 ? "api" : "docs"),
        dependencies: [dependency.id],
        title: index === 155 ? "Literal 100%_completed" : `ÉTUDE item-${index}`,
      }),
    );
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  t.onTestFinished(() => {
    prepare.mockRestore();
  });
  const all = await run(graph.list);
  const counts = {
    issues: all.length,
    list_sql: prepare.mock.calls.length,
    pages: [] as Array<{ query: WorkDiscovery; sql: number; total: number; returned: number }>,
  };
  assert.ok(
    prepare.mock.calls.length <= 4,
    "List must not load issues or dependencies one row at a time",
  );
  const queries: WorkDiscovery[] = [
    { state: "all", limit: 20, offset: 75 },
    { state: "active", search: " étude ", limit: 17, offset: 51 },
    { state: "closed", limit: 10 },
    { state: "all", repository_id: Id.RepositoryId.make("docs"), search: "item-1", limit: 7 },
    { state: "all", search: "100%_", limit: 1 },
    { state: "all", search: "%' OR 1=1 --" },
    { state: "all", offset: 500, limit: 50 },
  ];
  for (const query of queries) {
    prepare.mockClear();
    const actual = await run(graph.find(query));
    counts.pages.push({
      query,
      sql: prepare.mock.calls.length,
      total: actual.total,
      returned: actual.entries.length,
    });
    assert.ok(prepare.mock.calls.length <= 6, "Page must use a bounded number of SQL operations");
    for (const [sql] of prepare.mock.calls) {
      assert.doesNotMatch(sql, /^SELECT id FROM issues/);
      if (selectsIssueRows(sql)) assert.match(sql, /ORDER BY .*priority, id LIMIT \? OFFSET \?/);
    }
    const state = query.state ?? "active",
      search = query.search?.trim().toLowerCase() ?? "";
    const expected = all
      .filter(
        (issue) =>
          (!query.repository_id || issue.repository_id === query.repository_id) &&
          (state === "all" ||
            (state === "closed" ? issue.status === "closed" : issue.status !== "closed")) &&
          (!search ||
            issue.title.toLowerCase().includes(search) ||
            issue.id.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : Number(a.id > b.id)));
    const offset = query.offset ?? 0,
      limit = query.limit ?? 50;
    assert.equal(actual.total, expected.length);
    assert.deepEqual(actual.entries, expected.slice(offset, offset + limit));
    assert.equal(actual.next_offset, offset + limit < expected.length ? offset + limit : undefined);
  }
  await assert.rejects(run(graph.find({ limit: 51 })), /Work discovery/);
  await assert.rejects(run(graph.find({ offset: -1 })), /Work discovery/);
  assert.equal((await run(graph.ready)).length, 160);
  assert.equal(
    (await run(graph.closureTimes))[dependency.id],
    (await run(graph.history(dependency.id))).at(-1)!.at,
  );
  const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "sql-query-counts.json"), JSON.stringify(counts, null, 2));
  }
});

test("1,000 inserts use no rank allocator and each finder page uses an ordering index", async (t) => {
  const { graph, path } = await workDatabase(t);
  const db = new DatabaseSync(path);
  t.onTestFinished(() => db.close());
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  t.onTestFinished(() => {
    prepare.mockRestore();
  });
  for (let i = 0; i < 1000; i++) await run(graph.create(goal(`indexed-${i}`)));
  assert.equal(
    prepare.mock.calls.filter(([sql]) => /finder_rank|finder_order/.test(sql)).length,
    0,
  );
  const closed = (await run(graph.find({ limit: 1 }))).entries[0]!;
  const owner = Id.ExecutionId.make("index-owner");
  await run(graph.claim(closed.id, owner));
  await run(graph.close(closed.id, owner));
  for (const [query, index] of [
    [{ state: "all" }, "issues_priority"],
    [{ state: "closed" }, "issues_status"],
    [{ state: "active", repository_id: Id.RepositoryId.make("api") }, "issues_repository_priority"],
    [{ state: "closed", repository_id: Id.RepositoryId.make("api") }, "issues_repository_status"],
  ] as const) {
    prepare.mockClear();
    await run(graph.find(query));
    const sql = prepare.mock.calls.find(([sql]) => selectsIssueRows(sql))?.[0];
    assert.ok(sql, "Expected a finder page query selecting issue rows");
    const plan = db
      .prepare("EXPLAIN QUERY PLAN " + sql)
      .all(...("repository_id" in query ? [query.repository_id] : []), 5, 0);
    const detail = plan.map((row) => String(row.detail)).join(" ");
    assert.match(detail, new RegExp(index));
    assert.doesNotMatch(detail, /TEMP B-TREE/);
  }
});
