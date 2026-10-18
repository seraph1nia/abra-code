import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Exit, Scope } from "effect";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../effects.ts";
import { SqliteWorkGraph, openWorkGraph, type NewIssue } from "../../src/work/graph.ts";
import { ProcessRunner } from "../../src/process.ts";

const goal = (request_id: string, dependencies: string[] = []): NewIssue => ({
  repository_id: Id.RepositoryId.make("api"),
  title: request_id,
  description: `Goal: ${request_id}`,
  priority: 2,
  dependencies: dependencies.map((value) => Id.IssueId.make(value)),
  request_id: Id.RequestId.make(request_id),
});
async function database(t: { onTestFinished: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "abracode-work-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  const path = Id.AbsolutePath.make(join(root, "work.sqlite"));
  const graph = await run(
    SqliteWorkGraph.open(path).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return { root, path, graph, scope };
}

test("durable dependency chain, ownership guards, idempotent transitions and history", async (t) => {
  const { graph } = await database(t);
  const a = await run(graph.create(goal("api")));
  const b = await run(
    graph.create({
      ...goal("frontend", [a.id]),
      repository_id: Id.RepositoryId.make("frontend"),
      priority: 0,
    }),
  );
  const c = await run(
    graph.create({ ...goal("worker", [b.id]), repository_id: Id.RepositoryId.make("worker") }),
  );
  assert.deepEqual(
    (await run(graph.ready)).map((i) => i.id),
    [a.id],
  );
  assert.equal(
    (await run(graph.explain)).blocked.find((i) => i.id === c.id)!.blocked_by[0].id,
    b.id,
  );
  await assert.rejects(run(graph.claim(b.id, Id.ExecutionId.make("actor-b"))), /dependencies/);
  await run(graph.claim(a.id, Id.ExecutionId.make("actor-a")));
  await run(graph.claim(a.id, Id.ExecutionId.make("actor-a")));
  for (const operation of [
    graph.claim(a.id, Id.ExecutionId.make("other")),
    graph.block(a.id, Id.ExecutionId.make("other"), "reason"),
    graph.resume(a.id, Id.ExecutionId.make("other")),
    graph.close(a.id, Id.ExecutionId.make("other")),
  ]) {
    await assert.rejects(run(operation), /owns issue/);
  }
  await run(graph.block(a.id, Id.ExecutionId.make("actor-a"), "Provider failed"));
  await run(graph.block(a.id, Id.ExecutionId.make("actor-a"), "Provider failed"));
  await assert.rejects(run(graph.claim(a.id, Id.ExecutionId.make("actor-a"))), /owns issue/);
  await assert.rejects(
    run(graph.close(a.id, Id.ExecutionId.make("actor-a"))),
    /Expected in_progress/,
  );
  await run(graph.resume(a.id, Id.ExecutionId.make("actor-a")));
  await run(graph.resume(a.id, Id.ExecutionId.make("actor-a")));
  await run(graph.close(a.id, Id.ExecutionId.make("actor-a")));
  await run(graph.close(a.id, Id.ExecutionId.make("actor-a")));
  await assert.rejects(run(graph.claim(a.id, Id.ExecutionId.make("other"))), /owns issue/);
  assert.deepEqual(
    (await run(graph.ready)).map((i) => i.id),
    [b.id],
  );
  assert.deepEqual(
    (await run(graph.history(a.id))).map((event) => event.kind),
    ["created", "claimed", "blocked", "in_progress", "closed"],
  );
  assert.equal((await run(graph.history(a.id)))[2].reason, "Provider failed");
});

test("creation survives reopen and response loss; failed transaction leaves no request behind", async (t) => {
  const { graph, path, scope } = await database(t);
  const first = await run(graph.create(goal("retry")));
  await run(graph.claim(first.id, Id.ExecutionId.make("owner")));
  await run(Scope.close(scope, Exit.void));
  await run(
    Effect.gen(function* () {
      const reopened = yield* SqliteWorkGraph.open(path);
      assert.equal((yield* reopened.create(goal("retry"))).id, first.id);
      assert.equal((yield* reopened.show(first.id)).assignee, "owner");
      assert.equal((yield* reopened.history(first.id)).length, 2);
    }),
  );
  await assert.rejects(
    run(
      Effect.gen(function* () {
        const reopened = yield* SqliteWorkGraph.open(path);
        yield* reopened.create({ ...goal("retry"), description: "Different goal" });
      }),
    ),
    /different goal/,
  );
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON work_events BEGIN SELECT RAISE(ABORT, 'Injected failure'); END",
    );
    await assert.rejects(
      run(
        Effect.gen(function* () {
          const reopened = yield* SqliteWorkGraph.open(path);
          yield* reopened.create(goal("rollback"));
        }),
      ),
      /Injected failure/,
    );
    db.exec("DROP TRIGGER fail_event");
  } finally {
    db.close();
  }
  await run(
    Effect.gen(function* () {
      const reopened = yield* SqliteWorkGraph.open(path);
      assert.equal((yield* reopened.list).length, 1);
      yield* reopened.create(goal("rollback"));
      assert.equal((yield* reopened.list).length, 2);
    }),
  );
});

test("independent processes cannot claim the same issue or duplicate a request", async (t) => {
  const { graph, path } = await database(t);
  const runner = new ProcessRunner();
  const execute = (operation: string) =>
    runner.run(
      Id.Executable.make(process.execPath),
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import { Effect } from 'effect';
    import { SqliteWorkGraph } from ${JSON.stringify(resolve("src/work/graph.ts"))};
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const graph = yield* SqliteWorkGraph.open(${JSON.stringify(path)});
      ${operation}
    })));
  `,
      ],
      Id.AbsolutePath.make(process.cwd()),
    );
  const created = await Promise.all(
    [1, 2].map(() =>
      run(execute(`console.log((yield* graph.create(${JSON.stringify(goal("competing"))})).id);`)),
    ),
  );
  assert.equal(created[0].trim(), created[1].trim());
  assert.equal((await run(graph.list)).length, 1);
  const attempts = await Promise.allSettled(
    [1, 2].map((actor) =>
      run(execute(`yield* graph.claim(${JSON.stringify(created[0].trim())}, 'actor-${actor}');`)),
    ),
  );
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal((await run(graph.show(Id.IssueId.make(created[0].trim())))).status, "in_progress");
});

test("invalid creation, missing dependencies and normalized retries do not change the graph", async (t) => {
  const { graph } = await database(t);
  for (const input of [
    goal("missing", ["absent"]),
    { ...goal("priority"), priority: 5 },
    { ...goal("title"), title: " " },
    { ...goal("description"), description: "" },
    (() => {
      const input = goal("repo");
      Reflect.set(input, "repository_id", "../escape");
      return input;
    })(),
  ]) {
    await assert.rejects(run(graph.create(input)));
  }
  assert.deepEqual(await run(graph.list), []);
  const a = await run(graph.create(goal("a")));
  const b = await run(graph.create(goal("b")));
  const first = await run(
    graph.create({ ...goal("normalized", [b.id, a.id, a.id]), title: " normalized " }),
  );
  assert.equal((await run(graph.create(goal("normalized", [a.id, b.id])))).id, first.id);
  assert.deepEqual(first.dependencies, [a.id, b.id].sort());
});

test("early SQLite schema upgrades preserve work, ownership and history", async (t) => {
  const { graph, path, scope } = await database(t);
  const existing = await run(graph.create(goal("existing")));
  await run(graph.claim(existing.id, Id.ExecutionId.make("existing-owner")));
  await run(Scope.close(scope, Exit.void));
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "DROP TABLE batch_items; DROP TABLE work_batches; ALTER TABLE issues DROP COLUMN scope_json; ALTER TABLE issues DROP COLUMN report_reference_json; ALTER TABLE issues DROP COLUMN quality_profile; ALTER TABLE issues DROP COLUMN dispatch_json; PRAGMA user_version = 1",
    );
  } finally {
    db.close();
  }
  await run(
    Effect.gen(function* () {
      const upgraded = yield* openWorkGraph({ work_database: path });
      assert.equal((yield* upgraded.show(existing.id)).assignee, "existing-owner");
      assert.equal((yield* upgraded.history(existing.id)).length, 2);
      const created = yield* upgraded.create(goal("after-upgrade"));
      assert.equal(created.status, "open");
      assert.equal((yield* upgraded.list).length, 2);
    }),
  );
  const verify = new DatabaseSync(path);
  try {
    assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 6);
    verify.exec("PRAGMA user_version = 7");
  } finally {
    verify.close();
  }
  await assert.rejects(run(SqliteWorkGraph.open(path)), /Unsupported work database version 7/);
});

test("workflow/scope/report identities are persisted and cannot rebind a request; legacy full-spec input retries compatibly", async (t) => {
  const { graph, path } = await database(t);
  const scope = {
    goal: "Investigate ownership",
    acceptance: ["Identify owners"],
    constraints: ["Read only"],
  };
  const input = { ...goal("research-policy"), workflow_policy: "research-only" as const, scope };
  const issue = await run(graph.create(input));
  assert.equal(issue.workflow_policy, "research-only");
  assert.deepEqual((await run(graph.show(issue.id))).scope, scope);
  await assert.rejects(
    run(graph.create({ ...input, workflow_policy: "lightweight-fix" })),
    /different goal/,
  );
  await assert.rejects(
    run(graph.create({ ...input, scope: { ...scope, goal: "Changed" } })),
    /different goal/,
  );
  const old = goal("legacy-identity");
  const legacy = await run(graph.create(old));
  const db = new DatabaseSync(path);
  const raw = JSON.stringify(old);
  db.prepare("UPDATE issues SET request_input = ? WHERE id = ?").run(raw, legacy.id);
  db.close();
  assert.equal((await run(graph.create(old))).id, legacy.id);
  assert.equal((await run(graph.show(legacy.id))).workflow_policy, "full-openspec");
});

const batchGoal = (request = "atomic-batch") => ({
  request_id: Id.RequestId.make(request),
  tasks: [
    {
      client_key: "a",
      repository_id: Id.RepositoryId.make("api"),
      title: "Dependent",
      description: "Implement dependent work",
      dependencies: [{ type: "local" as const, client_key: "A" }],
    },
    {
      client_key: "A",
      repository_id: Id.RepositoryId.make("frontend"),
      title: "Prerequisite",
      description: "Establish the prerequisite",
    },
  ],
});

test("atomic batches resolve forward references and retain the same receipt across reopen and conflicting single-item intake", async (t) => {
  const { graph, path, scope } = await database(t);
  const result = await run(graph.createBatch(batchGoal()));
  assert.deepEqual(
    result.tasks.map((t) => t.client_key),
    ["A", "a"],
  );
  assert.deepEqual(result.tasks[1].issue.dependencies, [result.tasks[0].issue.id]);
  for (const task of result.tasks)
    assert.equal((await run(graph.history(task.issue.id))).length, 1);
  const owner = Id.ExecutionId.make("batch-owner");
  await run(graph.claim(result.tasks[0].issue.id, owner));
  await assert.rejects(
    run(
      graph.create({
        ...goal(result.tasks[0].issue.request_id),
        title: "Conflicting batch adoption",
      }),
    ),
    { code: "REQUEST_REBIND" },
  );
  await run(Scope.close(scope, Exit.void));
  await run(
    Effect.gen(function* () {
      const reopened = yield* SqliteWorkGraph.open(path);
      const retry = yield* reopened.createBatch({
        ...batchGoal(),
        tasks: batchGoal().tasks.toReversed(),
      });
      assert.deepEqual(
        retry.tasks.map((t) => t.issue.id),
        result.tasks.map((t) => t.issue.id),
      );
      assert.equal(retry.tasks[0].issue.assignee, owner);
      for (const changed of [
        { ...batchGoal(), tasks: [batchGoal().tasks[1]] },
        {
          ...batchGoal(),
          tasks: batchGoal().tasks.map((t) => ({ ...t, description: "Changed goal" })),
        },
        { ...batchGoal(), tasks: batchGoal().tasks.map((t) => ({ ...t, dependencies: [] })) },
      ])
        yield* reopened.createBatch(changed).pipe(
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => assert.equal(error.code, "REQUEST_REBIND"))),
        );
      assert.equal((yield* reopened.list).length, 2);
    }),
  );
});

test("invalid batch references, cycles and mid-transaction failures leave no receipt, issue or event", async (t) => {
  const { graph, path } = await database(t);
  const input = batchGoal();
  for (const tasks of [
    [{ ...input.tasks[0], dependencies: [{ type: "local" as const, client_key: "missing" }] }],
    [
      {
        ...input.tasks[0],
        dependencies: [{ type: "existing" as const, issue_id: Id.IssueId.make("missing") }],
      },
    ],
    [{ ...input.tasks[0], dependencies: [{ type: "local" as const, client_key: "a" }] }],
    [
      input.tasks[0],
      { ...input.tasks[1], dependencies: [{ type: "local" as const, client_key: "a" }] },
    ],
  ]) {
    await assert.rejects(run(graph.createBatch({ ...input, tasks })));
    assert.equal((await run(graph.list)).length, 0);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TRIGGER fail_batch_event BEFORE INSERT ON work_events WHEN (SELECT count(*) FROM work_events) = 1 BEGIN SELECT RAISE(ABORT, 'Injected second batch event failure'); END",
    );
    await assert.rejects(run(graph.createBatch(input)), /Injected second batch event failure/);
    for (const table of ["issues", "dependencies", "work_events", "work_batches", "batch_items"])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    db.exec("DROP TRIGGER fail_batch_event");
    assert.equal((await run(graph.createBatch(input))).tasks.length, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM work_batches").get()!.n, 1);
  } finally {
    db.close();
  }
});

test("separate processes commit one batch and return identical local-key mappings", async (t) => {
  const { graph, path } = await database(t);
  const runner = new ProcessRunner();
  const source = `import { Effect } from 'effect'; import { SqliteWorkGraph } from ${JSON.stringify(resolve("src/work/graph.ts"))}; const result=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){const graph=yield* SqliteWorkGraph.open(${JSON.stringify(path)}); return yield* graph.createBatch(${JSON.stringify(batchGoal())});})));console.log(JSON.stringify(result.tasks.map(t=>[t.client_key,t.issue.id])));`;
  const call = () =>
    run(
      runner.run(
        Id.Executable.make(process.execPath),
        ["--import", "tsx", "--input-type=module", "-e", source],
        Id.AbsolutePath.make(resolve(".")),
      ),
    );
  const [first, second] = await Promise.all([call(), call()]);
  assert.deepEqual(JSON.parse(first), JSON.parse(second));
  assert.equal((await run(graph.list)).length, 2);
  for (const issue of await run(graph.list))
    assert.equal((await run(graph.history(issue.id))).length, 1);
});

for (const version of [3, 4, 5])
  test(`schema ${version} batch migration preserves original request identity`, async (t) => {
    const { graph, path, scope } = await database(t);
    const issue = await run(graph.create(goal("historical")));
    await run(Scope.close(scope, Exit.void));
    const db = new DatabaseSync(path);
    let original: unknown;
    try {
      original = db
        .prepare("SELECT request_input FROM issues WHERE id = ?")
        .get(issue.id)!.request_input;
      db.exec(
        "DROP TABLE batch_items; DROP TABLE work_batches; ALTER TABLE issues DROP COLUMN dispatch_json;",
      );
      if (version === 3) db.exec("ALTER TABLE issues DROP COLUMN quality_profile");
      db.exec(`PRAGMA user_version = ${version}`);
    } finally {
      db.close();
    }
    await run(
      Effect.gen(function* () {
        const upgraded = yield* SqliteWorkGraph.open(path);
        assert.equal((yield* upgraded.create(goal("historical"))).id, issue.id);
        assert.equal((yield* upgraded.createBatch(batchGoal())).tasks.length, 2);
      }),
    );
    const verify = new DatabaseSync(path);
    try {
      assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 6);
      assert.equal(
        verify.prepare("SELECT request_input FROM issues WHERE id = ?").get(issue.id)!
          .request_input,
        original,
      );
    } finally {
      verify.close();
    }
  });

test("failed batch receipt migration rolls back preceding column additions and schema version", async (t) => {
  const { graph, path, scope } = await database(t);
  await run(graph.create(goal("preserved")));
  await run(Scope.close(scope, Exit.void));
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "DROP TABLE batch_items; DROP TABLE work_batches; ALTER TABLE issues DROP COLUMN quality_profile; ALTER TABLE issues DROP COLUMN dispatch_json; CREATE INDEX work_batches ON issues(title); PRAGMA user_version = 3",
    );
    await assert.rejects(run(SqliteWorkGraph.open(path)), /work_batches|index/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 3);
    assert.equal(
      db
        .prepare("PRAGMA table_info(issues)")
        .all()
        .some((row) => row.name === "quality_profile"),
      false,
    );
    assert.equal(
      db
        .prepare("PRAGMA table_info(issues)")
        .all()
        .some((row) => row.name === "dispatch_json"),
      false,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM issues").get()!.n, 1);
    db.exec("DROP INDEX work_batches");
  } finally {
    db.close();
  }
  await run(
    Effect.gen(function* () {
      const upgraded = yield* SqliteWorkGraph.open(path);
      assert.equal((yield* upgraded.createBatch(batchGoal())).tasks.length, 2);
    }),
  );
});

test("intake request identities cannot change between a batch and an ordinary issue", async (t) => {
  const { graph } = await database(t);
  await run(graph.create(goal("already-single")));
  await assert.rejects(run(graph.createBatch(batchGoal("already-single"))), {
    code: "REQUEST_REBIND",
  });
  await run(graph.createBatch(batchGoal("already-batch")));
  await assert.rejects(run(graph.create(goal("already-batch"))), { code: "REQUEST_REBIND" });
  assert.equal((await run(graph.list)).length, 3);
});

test("schema-5 batch receipts keep original mapping while new task dispatch is durable and immutable", async (t) => {
  const { graph, path, scope } = await database(t);
  const old = await run(graph.createBatch(batchGoal()));
  await run(Scope.close(scope, Exit.void));
  const db = new DatabaseSync(path);
  const receipt = db.prepare("SELECT request_input FROM work_batches").get()!.request_input;
  db.exec("ALTER TABLE issues DROP COLUMN dispatch_json; PRAGMA user_version = 5");
  db.close();
  await run(
    Effect.gen(function* () {
      const current = yield* SqliteWorkGraph.open(path);
      const retry = yield* current.createBatch(batchGoal());
      assert.deepEqual(
        retry.tasks.map((t) => t.issue.id),
        old.tasks.map((t) => t.issue.id),
      );
      const input = {
        ...goal("model-selection"),
        dispatch: {
          apply: {
            model: { providerID: Id.ProviderId.make("fixture"), id: Id.ModelId.make("selected") },
          },
        },
      };
      const created = yield* current.create(input);
      assert.equal((yield* current.show(created.id)).dispatch?.apply?.model?.id, "selected");
      assert.equal((yield* current.create(input)).id, created.id);
      yield* Effect.promise(() =>
        assert.rejects(
          run(
            current.create({
              ...input,
              dispatch: { apply: { profile: Id.DispatchProfileId.make("different") } },
            }),
          ),
          /different/,
        ),
      );
    }),
  );
  const verify = new DatabaseSync(path);
  try {
    assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 6);
    assert.equal(
      verify.prepare("SELECT request_input FROM work_batches").get()!.request_input,
      receipt,
    );
  } finally {
    verify.close();
  }
});
