import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Exit, Scope } from "effect";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../effects.ts";
import { SqliteWorkGraph, openWorkGraph, type NewIssue } from "../../src/work/graph.ts";
import { parseBeadsExport } from "../../src/work/import.ts";
import { FileLocks } from "../../src/storage/lock.ts";
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

const legacy = (id: string, dependencies: string[] = []) => ({
  id,
  title: id,
  description: `Goal: ${id}`,
  status: "open",
  priority: 2,
  metadata: { repository_id: "api", workflow_policy: "full-openspec", abracode_request_id: id },
  dependencies: dependencies.map((depends_on_id) => ({ depends_on_id, type: "blocks" })),
});
const exportText = (issues: unknown[]) => issues.map((issue) => JSON.stringify(issue)).join("\n");

test("Beads migration preserves identity, claims, dependencies, retry keys and raw evidence", async (t) => {
  const { graph, path } = await database(t);
  const source = exportText([
    {
      ...legacy("abra-a"),
      status: "in_progress",
      assignee: "execution-a",
      notes: "Historical blocker",
      comments: [{ text: "Evidence" }],
    },
    { ...legacy("abra-b", ["abra-a"]), metadata: undefined, labels: ["repo:frontend"] },
  ]);
  assert.equal(await run(graph.importIssues(parseBeadsExport(source), source)), 2);
  assert.equal((await run(graph.show(Id.IssueId.make("abra-b")))).repository_id, "frontend");
  assert.equal((await run(graph.show(Id.IssueId.make("abra-a")))).assignee, "execution-a");
  assert.equal((await run(graph.create({ ...goal("abra-a"), title: "abra-a" }))).id, "abra-a");
  await run(graph.close(Id.IssueId.make("abra-a"), Id.ExecutionId.make("execution-a")));
  assert.deepEqual(
    (await run(graph.ready)).map((i) => i.id),
    ["abra-b"],
  );
  assert.equal(await run(graph.importIssues(parseBeadsExport(source), source)), 0);
  assert.equal((await run(graph.show(Id.IssueId.make("abra-a")))).status, "closed");
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("SELECT source FROM imports").get()!.source, source);
  } finally {
    db.close();
  }
});

test("legacy assignees keep their original identity without becoming execution IDs", async (t) => {
  const { graph } = await database(t);
  const source = exportText([
    { ...legacy("legacy-owner"), status: "in_progress", assignee: "bart@example.invalid" },
  ]);
  await run(graph.importIssues(parseBeadsExport(source), source));
  assert.equal(
    (await run(graph.show(Id.IssueId.make("legacy-owner")))).assignee,
    "bart@example.invalid",
  );
  await assert.rejects(
    run(graph.close(Id.IssueId.make("legacy-owner"), Id.ExecutionId.make("unrelated"))),
    /owns issue/,
  );
});

test("migration rejects partial graphs, cycles, duplicate identities and unsupported semantics atomically", async (t) => {
  const { graph } = await database(t);
  for (const issues of [
    [legacy("a", ["missing"])],
    [legacy("a", ["b"]), legacy("b", ["a"])],
    [legacy("a", ["a"])],
    [legacy("a"), legacy("a")],
    [legacy("a"), { ...legacy("b"), metadata: legacy("a").metadata }],
    [{ ...legacy("a"), labels: ["repo:other"] }],
    [{ ...legacy("a"), status: "deferred" }],
    [{ ...legacy("a"), dependencies: [{ depends_on_id: "b", type: "related" }] }],
  ]) {
    const source = exportText(issues);
    await assert.rejects(
      run(Effect.suspend(() => graph.importIssues(parseBeadsExport(source), source))),
    );
    assert.deepEqual(await run(graph.list), []);
    assert.equal(await run(graph.hasImport()), false);
  }
});

test("legacy startup requires migration; import CLI refuses a live coordinator and permits safe retries", async (t) => {
  const { root, path, scope } = await database(t);
  const config = { home: Id.AbsolutePath.make(root), work_database: Id.AbsolutePath.make(path) };
  await mkdir(join(root, ".beads"));
  // Repeated preflight must keep refusing even though it already created the SQLite file.
  for (let i = 0; i < 2; i++) await assert.rejects(run(openWorkGraph(config)), /needs import/);
  await writeFile(
    join(root, "abracode.yaml"),
    `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nwork_database: ${path}\n`,
  );
  const file = join(root, "issues.jsonl");
  await writeFile(file, exportText([legacy("abra-import")]));
  const command = () =>
    new ProcessRunner().run(
      Id.Executable.make(process.execPath),
      ["--import", "tsx", resolve("scripts/import-work.ts"), file],
      Id.AbsolutePath.make(process.cwd()),
      { ABRACODE_HOME: root },
    );
  const lockScope = Scope.makeUnsafe();
  await run(
    new FileLocks(Id.AbsolutePath.make(join(root, ".abracode/locks")))
      .acquire(Id.LockKey.make("scheduler-leader"))
      .pipe(Effect.provideService(Scope.Scope, lockScope)),
  );
  try {
    await assert.rejects(run(command()), /owned by another controller/);
  } finally {
    await run(Scope.close(lockScope, Exit.void));
  }
  assert.match(await run(command()), /Imported 1 issues/);
  assert.match(await run(command()), /Imported 0 issues/);
  const imported = await run(openWorkGraph(config).pipe(Effect.provideService(Scope.Scope, scope)));
  assert.equal((await run(imported.show(Id.IssueId.make("abra-import")))).status, "open");
});

test("early SQLite schema upgrades preserve work and permit Beads import", async (t) => {
  const { graph, path, scope } = await database(t);
  const existing = await run(graph.create(goal("existing")));
  await run(graph.claim(existing.id, Id.ExecutionId.make("existing-owner")));
  await run(Scope.close(scope, Exit.void));
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "DROP TABLE imports; CREATE TABLE imports (digest TEXT PRIMARY KEY); PRAGMA user_version = 1",
    );
  } finally {
    db.close();
  }
  const source = exportText([legacy("abra-legacy")]);
  await run(
    Effect.gen(function* () {
      const upgraded = yield* SqliteWorkGraph.open(path);
      assert.equal((yield* upgraded.show(existing.id)).assignee, "existing-owner");
      assert.equal((yield* upgraded.history(existing.id)).length, 2);
      assert.equal(yield* upgraded.importIssues(parseBeadsExport(source), source), 1);
      assert.equal((yield* upgraded.show(Id.IssueId.make("abra-legacy"))).status, "open");
    }),
  );
  const verify = new DatabaseSync(path);
  try {
    assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 4);
    assert.equal(verify.prepare("SELECT source FROM imports").get()!.source, source);
    verify.exec("PRAGMA user_version = 5");
  } finally {
    verify.close();
  }
  await assert.rejects(run(SqliteWorkGraph.open(path)), /Unsupported work database version 5/);
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
