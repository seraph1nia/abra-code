import { TestClock } from "effect/testing";
import { InboxDetailCache } from "../../src/work/inbox-cache.ts";
import { freshMs } from "../../src/work/inbox-index.ts";
import { workBriefing } from "../../src/visibility/briefing.ts";
import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { Clock, ConfigProvider, Deferred, Effect, SynchronizedRef } from "effect";
import { githubHosts } from "../../src/git/inbox.ts";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { removeFixture } from "../helpers/resources.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { createWorkflow } from "../../src/opencode/application.ts";
import { Git } from "../../src/git/repository.ts";
import {
  GitRemote,
  ProviderId,
  ModelId,
  RepositoryId,
  SessionId,
  RequestId,
  StorageKey,
} from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import type { Runner } from "../../src/process.ts";
import type { InboxQuery, InboxTarget } from "@abracode/contracts/visibility/github-inbox";
import { workDatabase, workGraphAt } from "../helpers/work-database.ts";
import { DatabaseSync } from "node:sqlite";
import { dayMs, indexEffect } from "../../src/work/inbox-index.ts";
import { Visibility } from "../../src/visibility/read-model.ts";

test("GitHub hosts follow the effect configuration including the XDG fallback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-inbox-config-"));
  t.onTestFinished(() => removeFixture(root));
  await mkdir(join(root, "gh"));
  await writeFile(join(root, "gh/hosts.yml"), "file.example: {}");
  const hosts = await run(
    githubHosts.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ XDG_CONFIG_HOME: root, GH_HOST: "ENV.example" }),
      ),
    ),
  );
  assert.deepEqual([...hosts].sort(), ["env.example", "file.example", "github.com"]);
});

async function setup(t: Parameters<typeof workDatabase>[0]) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { path, graph } = await workDatabase(t);
  const id = RepositoryId.make("api");
  const url = "https://github.com/fixture/api";
  const project = (await run(f.records.project(id)))!;
  await run(
    f.records.store.set(StorageKey.make("project/api"), {
      ...project,
      remote: GitRemote.make(url),
      dispatch: {
        review: {
          model: {
            providerID: ProviderId.make("fixture"),
            id: ModelId.make("cheap-review"),
            variant: "low",
          },
        },
      },
      delivery: "branch",
    }),
  );
  const account = {
    id: "user-1",
    token: "first",
    fail: "",
    pages: false,
    repeat: false,
    shortPatch: false,
    partialLabels: false,
    closed: false,
    changed: false,
    afterFiles: false,
    partial: false,
    malformed: false,
    repositoryURL: "",
  };
  const calls: string[][] = [];
  const pageInfo = { hasNextPage: false, endCursor: null };
  const row = (pr: boolean, n: number, origin: string) => ({
    number: n,
    id: (pr ? "pr" : "issue") + n,
    state: account.closed && !pr ? "CLOSED" : "OPEN",
    title: pr ? "Fix export" : "Retry export",
    url: origin + (pr ? "/pull/" : "/issues/") + n,
    author: pr ? { login: "colleague" } : null,
    updatedAt: new Date().toISOString(),
    labels: { nodes: [], pageInfo: { ...pageInfo, hasNextPage: account.partialLabels } },
    ...(pr ? { isDraft: true } : {}),
  });
  const runner: Runner = {
    run: (bin, argv, cwd, env, opts) => {
      if (bin !== "gh") return f.git.runner.run(bin, argv, cwd, env, opts);
      assert.equal(env?.GH_REPO, undefined);
      assert.equal(env?.GH_HOST, undefined);
      assert.equal(argv[argv.indexOf("--hostname") + 1], "github.com");
      if (argv[0] === "auth") return Effect.succeed(account.token);
      calls.push(argv);
      if (account.malformed) return Effect.succeed("{");
      if (account.fail) return Effect.fail(new CrewError("COMMAND_FAILED", account.fail));
      const query = argv.find((a) => a.startsWith("query=")) ?? "";
      const pr = query.includes("pullRequest");
      const name = argv.find((a) => a.startsWith("name="))?.slice(5) ?? "api";
      const origin = "https://github.com/fixture/" + name;
      if (name === "denied") return Effect.fail(new CrewError("COMMAND_FAILED", "HTTP 404"));
      const n = pr ? 91 : 42;
      if (argv.some((a) => a.includes("/files?"))) {
        account.afterFiles = true;
        return Effect.succeed(
          JSON.stringify([
            {
              filename: "src.ts",
              additions: account.shortPatch ? 3 : 2,
              deletions: 0,
              patch: "@@ -0,0 +1,2 @@\n+one\n+two",
            },
          ]),
        );
      }
      const detail = query.includes("item:");
      const next = argv.includes("cursor=second");
      return Effect.succeed(
        JSON.stringify({
          ...(account.partial ? { errors: [{ message: "partial" }] } : {}),
          data: {
            viewer: { id: account.id },
            repository: {
              id: name === "api" ? "repo" : name,
              url: account.repositoryURL || origin,
              ...(detail
                ? {
                    item: {
                      ...row(pr, n, origin),
                      body: "Issue content",
                      comments: { nodes: [], totalCount: 0 },
                      ...(pr
                        ? {
                            headRefOid: (account.afterFiles && account.changed ? "c" : "a").repeat(
                              40,
                            ),
                            baseRefOid: "b".repeat(40),
                            changedFiles: 1,
                          }
                        : {}),
                    },
                  }
                : {
                    items: {
                      nodes: [row(pr, next ? 43 : n, origin)],
                      pageInfo:
                        account.pages && !pr && (!next || account.repeat)
                          ? { hasNextPage: true, endCursor: "second" }
                          : pageInfo,
                    },
                  }),
            },
          },
        }),
      );
    },
  };
  const open = async (work: typeof graph) =>
    (
      await run(
        createWorkflow(
          f.catalog,
          f.config,
          f.records,
          work,
          f.spec,
          new Git(runner),
          f.runtime,
          f.delivery,
          f.locks,
        ),
      )
    ).controller;
  const c = await open(graph);
  t.onTestFinished(() => run(c.close()));
  const target = (pr = false): InboxTarget => ({
    repository_id: id,
    kind: pr ? "pr" : "issue",
    number: pr ? 91 : 42,
    item_node: pr ? "pr91" : "issue42",
    repo_node: "repo",
  });
  return {
    f,
    c,
    graph,
    path,
    open,
    target,
    account,
    calls,
    id,
    list: (q?: InboxQuery) => run(c.inbox.list(q)),
  };
}
const session = SessionId.make("ses_supervisor");
test("warm inbox shares bounded reads, resolves private review and keeps remote state independent", async (t) => {
  const { c, graph, target, calls, list, account } = await setup(t);
  await run(new Visibility(c).snapshot());
  assert.equal(calls.length, 0);
  const [first] = await Promise.all([list(), list()]);
  assert.equal(first.total, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    first.entries.map((r) => r.links),
    [[], []],
  );
  await list({ role: "unassigned" });
  await list({ search: "Retry" });
  await list({ label: "bug" });
  assert.equal(calls.length, 2);
  assert.equal((await run(graph.list)).length, 0);
  await run(c.inbox.detail(target(true)));
  await run(c.inbox.detail(target(true)));
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((a) => a.some((x) => x.includes("/files?"))));
  assert.equal((await run(workBriefing(c))).github.total, 0);
  const wide = await run(workBriefing(c, { include_open_github: true }));
  assert.equal(wide.github.total, 2);
  assert.equal(wide.decisions.total, 0);
  const discussed = wide.github.entries.find((entry) => entry.kind === "pr")!;
  const issue = await run(c.inbox.assign(target(), session));
  const review = await run(c.inbox.assign(discussed, session));
  assert.equal((await run(graph.show(review))).workflow_policy, "research-only");
  const requested = await run(graph.show(review));
  assert.deepEqual(requested.dispatch?.research?.model, {
    providerID: "fixture",
    id: "cheap-review",
    variant: "low",
  });
  assert.match(requested.scope!.constraints!.join(" "), /abra-open-code-review-delegate/);
  assert.match(requested.description, /\+one/);
  assert.equal(await run(c.inbox.assign(target(true), session)), review);
  assert.equal((await list({ role: "pickup" })).entries[0]?.links[0]?.issue_id, issue);
  assert.equal((await list({ role: "review" })).entries[0]?.author, "colleague");
  assert.equal((await list({ role: "unassigned" })).total, 0);
  assert.equal((await run(workBriefing(c))).github.total, 2);

  account.closed = true;
  assert.equal(await run(c.inbox.assign(target(), session)), issue);
  assert.equal((await run(graph.show(issue))).status, "open");
  await assert.rejects(
    run(c.inbox.assign(target(), session, "different goal")),
    /different instructions/,
  );
});
test("partial pages survive restart and concurrent source pickup uses one SQL transaction", async (t) => {
  const { c, graph, path, open, target, account, list, calls } = await setup(t);
  account.pages = true;
  const first = await list({ kind: "issue" });
  assert.equal(first.coverage[0]?.status, "loading");
  const other = await workGraphAt(t, path),
    restarted = await open(other.graph);
  t.onTestFinished(() => run(restarted.close()));
  await run(restarted.inbox.list({ kind: "issue" }));
  await expectPage(
    () => run(restarted.inbox.list({ kind: "issue" })),
    (page) => page.total === 2,
  );
  assert.ok(calls.some((a) => a.includes("cursor=second")));
  assert.equal(
    (await run(restarted.inbox.list({ kind: "issue", search: "api#43" }))).entries[0]?.number,
    43,
  );
  const ids = await Promise.all([
    run(c.inbox.assign(target(), session)),
    run(restarted.inbox.assign(target(), session)),
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal((await run(graph.list)).length, 1);
  account.changed = true;
  await assert.rejects(run(c.inbox.assign(target(true), session)), /changed during the diff/);
  assert.equal((await run(graph.list)).length, 1);
});
test("all-state catch-up, account isolation, rate limits and revocation", async (t) => {
  const { c, graph, target, account, list, calls } = await setup(t);
  await list();
  const id = await run(c.inbox.assign(target(), session));
  account.closed = true;
  await list({ refresh: true });
  await expectPage(list, (p) => p.coverage.every((s) => s.status === "current") && p.total === 1);
  assert.ok(calls.some((a) => a.some((x) => x.includes("items:issues") && !x.includes("states:"))));
  assert.equal((await run(graph.show(id))).status, "open");
  account.fail = "HTTP 403 rate limit";
  await list({ refresh: true });
  await expectPage(list, (p) => p.coverage.some((s) => s.message?.includes("rate limit") === true));
  const n = calls.length;
  await list({ refresh: true });
  await list({ state: "MERGED", refresh: true });
  assert.equal(calls.length, n);
  account.token = "second";
  account.id = "user-2";
  account.fail = "HTTP 404";
  const isolated = await list();
  assert.equal(isolated.total, 0);
  assert.ok(isolated.coverage.every((c) => c.status === "unavailable"));
  assert.equal((await run(graph.show(id))).status, "open");
});
async function expectPage<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const row = await read();
    if (accept(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Inbox did not settle");
}

test("repository identities isolate equal numbers and unreadable projects while paging fairly", async (t) => {
  const { f, id, list, c, target } = await setup(t);
  const project = (await run(f.records.project(id)))!;
  for (const name of ["other", "denied", "nongithub"]) {
    const repo = RepositoryId.make(name);
    await run(
      f.records.store.set(StorageKey.make("project/" + name), {
        ...project,
        id: repo,
        remote: GitRemote.make(
          "https://" +
            (name === "nongithub" ? "gitlab.example" : "github.com") +
            "/fixture/" +
            name,
        ),
      }),
    );
  }
  const first = await list();
  assert.ok(first.coverage.some((c) => c.status === "loading"));
  await expectPage(
    list,
    (p) =>
      p.total === 4 &&
      p.coverage.every((c) => c.status === "current" || c.status === "unavailable"),
  );
  const all = await list();
  assert.ok(all.coverage.some((c) => c.repository_id === "denied" && c.status === "unavailable"));
  assert.ok(!all.coverage.some((c) => c.repository_id === "nongithub"));
  const local = await run(c.inbox.assign(target(), session));
  assert.equal((await list({ role: "pickup" })).entries[0]?.links[0]?.issue_id, local);
  assert.equal(
    (await list({ repository_id: RepositoryId.make("other"), role: "unassigned" })).total,
    2,
  );
});
test("bad continuation and partial GraphQL results retain verified pages", async (t) => {
  const { list, account, calls } = await setup(t);
  account.pages = true;
  account.repeat = true;
  await list({ kind: "issue" });
  await expectPage(
    () => list({ kind: "issue" }),
    (p) => !!p.coverage[0]?.message,
  );
  const broken = await list({ kind: "issue" });
  assert.match(broken.coverage[0]!.message!, /continuation/);
  assert.equal(broken.total, 1);
  account.partial = true;
  const partial = await list({ kind: "pr" });
  assert.equal(partial.total, 0);
  assert.match(partial.coverage[0]!.message!, /incomplete/);
  account.token = "";
  const noauth = await list();
  assert.equal(noauth.total, 0);
  assert.ok(noauth.coverage.every((c) => c.status === "unavailable"));
  assert.ok(calls.every((argv) => argv[0] === "api"));
});
test("incomplete labels trigger a filtered connection and incomplete patches retain coverage", async (t) => {
  const { c, graph, account, list, target, calls } = await setup(t);
  account.partialLabels = true;
  account.shortPatch = true;
  await list();
  const filtered = await list({ label: "late", kind: "pr" });
  assert.equal(filtered.total, 1);
  assert.ok(calls.some((argv) => argv.includes("label=late")));
  const id = await run(c.inbox.assign(target(true), session));
  assert.match((await run(graph.show(id))).description, /Coverage: partial/);
  await assert.rejects(
    run(c.inbox.assign({ ...target(), item_node: "wrong" }, session)),
    /identity or access/,
  );
  assert.equal((await run(graph.list)).length, 1);
});
test("expiry prunes old closed observations and access loss clears all pages without deleting local assignments", async (t) => {
  const { c, account, graph, list, target } = await setup(t);
  await list();
  const id = await run(c.inbox.assign(target(), session));
  const db = graph["db"];
  db.prepare("UPDATE github_items SET state='CLOSED',seen=?").run(Date.now() - 31 * dayMs);
  await list({ refresh: true, kind: "issue" });
  await expectPage(
    () => list({ kind: "issue" }),
    (p) => p.coverage[0]?.status === "current",
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM github_items").get()!.n, 1);
  account.fail = "HTTP 404";
  await list({ kind: "issue", refresh: true });
  await expectPage(list, (p) => p.coverage.every((c) => c.status === "unavailable"));
  assert.equal((await list()).total, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM github_scans").get()!.n, 0);
  assert.equal((await run(graph.show(id))).status, "open");
});

test("Work and pre-existing publication records retain their identity alongside a private review", async (t) => {
  const { graph, path, id, c, target, open } = await setup(t);
  const issue = await run(
    graph.create({
      repository_id: id,
      request_id: RequestId.make("old"),
      title: "Existing task",
      description: "Existing work",
      priority: 2,
      dependencies: [],
    }),
  );
  const reopened = await workGraphAt(t, path);
  assert.equal((await run(reopened.graph.show(issue.id))).title, "Existing task");
  const controller = await open(reopened.graph);
  t.onTestFinished(() => run(controller.close()));
  const summary = await run(controller.inbox.detail(target(true)));
  const published = {
    repository_id: id,
    issue_id: issue.id,
    url: summary.url,
    status: "completed",
  };
  const index = reopened.graph.inbox;
  assert.deepEqual(
    index.links(
      { ...summary, item_node: "other", number: 92, url: summary.url.replace("/91", "/92") },
      [published],
    ),
    [],
  );
  assert.deepEqual(
    index.links(summary, [published]).map((l) => l.role),
    ["delivery"],
  );
  await run(c.inbox.assign(target(true), session));
  assert.deepEqual(
    index.links(summary, [published]).map((l) => l.role),
    ["review", "delivery"],
  );
});

for (const failure of ["HTTP 403 rate limit", "HTTP 404"])
  test(`a waiting inventory read honors a new cooldown (${failure})`, async (t) => {
    const { c, account, calls, list } = await setup(t);
    const remote = c.inbox["remote"];
    const read = remote.page.bind(remote);
    const gate = Deferred.makeUnsafe<void>();
    remote.page = (...args) => Deferred.await(gate).pipe(Effect.andThen(() => read(...args)));
    account.fail = failure;
    const requests = Promise.all(
      ["one", "two", "three"].map((label) => list({ kind: "issue", label })),
    );
    try {
      await t.expect
        .poll(async () => (await run(SynchronizedRef.get(c.inbox["runningRef"]))).size)
        .toBe(3);
    } finally {
      await run(Deferred.succeed(gate, undefined));
    }
    const pages = await requests;
    assert.equal(calls.length, 2);
    assert.equal(pages[2]?.coverage[0]?.status, "unavailable");
  });

test("overlapping PR views share a read while assignment verifies its own revisions", async (t) => {
  const { c, graph, target, account } = await setup(t);
  const pr = target(true);
  const remote = c.inbox["remote"];
  const read = remote.detail.bind(remote);
  const firstRead = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  let count = 0;
  remote.detail = (...args) => {
    count++;
    const observation = read(...args);
    if (count !== 1) return observation;
    return observation.pipe(
      Effect.tap(() =>
        Deferred.succeed(firstRead, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ),
    );
  };
  const credentials = vi.spyOn(remote, "partition");
  const views = Promise.all([run(c.inbox.detail(pr)), run(c.inbox.detail(pr))]);
  try {
    await run(Deferred.await(firstRead));
    await t.expect.poll(() => credentials.mock.calls.length).toBeGreaterThanOrEqual(2);
    account.afterFiles = true;
    account.changed = true;
    const review = await run(c.inbox.assign(pr, session));
    assert.match((await run(graph.show(review))).description, new RegExp("head " + "c".repeat(40)));
  } finally {
    await run(Deferred.succeed(release, undefined));
  }
  const results = await views;
  assert.deepEqual(
    results.map((r) => r.head),
    ["a".repeat(40), "a".repeat(40)],
  );
  assert.equal((await run(c.inbox.detail(pr))).head, "c".repeat(40));
  assert.equal(count, 3);
});

test("inbox count and rows share a read transaction and malformed timestamps roll back", async (t) => {
  const { graph, path, list } = await setup(t);
  const warm = await list({ kind: "issue" });
  const db = graph["db"];
  const partition = String(db.prepare("SELECT partition FROM github_items").get()!.partition);
  const stream = String(db.prepare("SELECT stream FROM github_scans").get()!.stream);
  await assert.rejects(
    run(
      indexEffect(() =>
        graph.inbox.page(
          stream,
          partition,
          [
            {
              ...warm.entries[0]!,
              updated_at: "invalid" as (typeof warm.entries)[number]["updated_at"],
            },
          ],
          graph.inbox.scan(stream)!,
          Date.now(),
        ),
      ),
    ),
    { code: "INBOX_DATA" },
  );
  const writer = new DatabaseSync(path);
  t.onTestFinished(() => writer.close());
  const prepare = db.prepare.bind(db);
  const intercept = vi.spyOn(db, "prepare").mockImplementation((sql) => {
    if (sql.startsWith("SELECT page.summary")) writer.exec("DELETE FROM github_items");
    return prepare(sql);
  });
  t.onTestFinished(() => intercept.mockRestore());
  const page = graph.inbox.find([partition], {}, []);
  assert.equal(page.total, 1);
  assert.equal(page.entries.length, 1);
  assert.equal(graph.inbox.find([partition], {}, []).total, 0);
});

test("local index failures preserve remote state and roll back partial page and assignment writes", async (t) => {
  const { c, graph, target, account } = await setup(t);
  const db = graph["db"];
  const issuePage = () => c.inbox.list({ kind: "issue" });
  const assertCode = async <A>(effect: Effect.Effect<A, CrewError>, code: string) => {
    const failure = await run(Effect.flip(effect));
    assert.equal(failure.code, code);
    assert.ok(failure.message.length < 2200);
  };
  db.exec(
    "CREATE TRIGGER reject_scan BEFORE INSERT ON github_scans BEGIN SELECT RAISE(ABORT,'private SQL detail'); END",
  );
  await assertCode(issuePage(), "INBOX_STORAGE");
  assert.equal(db.prepare("SELECT count(*) AS n FROM github_items").get()!.n, 0);
  account.fail = "HTTP 403 rate limit";
  await assertCode(issuePage(), "INBOX_STORAGE");
  assert.equal(db.prepare("SELECT count(*) AS n FROM github_cooldowns").get()!.n, 0);
  db.exec("DROP TRIGGER reject_scan");
  account.fail = "";
  assert.equal((await run(issuePage())).total, 1);
  const existing = await run(c.inbox.assign(target(), session));
  db.exec(
    "CREATE TRIGGER reject_link BEFORE INSERT ON github_links BEGIN SELECT RAISE(ABORT,'private SQL detail'); END",
  );
  await assertCode(c.inbox.assign(target(true), session), "INBOX_STORAGE");
  assert.deepEqual(
    (await run(graph.list)).map((i) => i.id),
    [existing],
  );
  db.exec("DROP TRIGGER reject_link");
  const retried = await run(c.inbox.assign(target(true), session));
  assert.equal(await run(c.inbox.assign(target(true), session)), retried);
  db.exec("UPDATE github_items SET summary='{'");
  await assertCode(issuePage(), "INVALID_DATA");
  db.exec("UPDATE github_scans SET data='{'");
  await assertCode(issuePage(), "INVALID_DATA");
  assert.equal(db.prepare("SELECT data FROM github_scans").get()!.data, "{");
  assert.equal(db.prepare("SELECT count(*) AS n FROM github_cooldowns").get()!.n, 0);
  assert.equal(await run(c.inbox.assign(target(), session)), existing);
});

test("invalid projects, changed item identity and malformed remote detail retain their codes", async (t) => {
  const { c, target, account } = await setup(t);
  const bad = RepositoryId.make("missing");
  assert.equal(
    (await run(Effect.flip(c.inbox.list({ repository_id: bad })))).code,
    "INBOX_PROJECT",
  );
  assert.equal(
    (await run(Effect.flip(c.inbox.detail({ ...target(), repository_id: bad })))).code,
    "INBOX_PROJECT",
  );
  assert.equal(
    (await run(Effect.flip(c.inbox.detail({ ...target(), item_node: "other" })))).code,
    "INBOX_IDENTITY",
  );
  account.malformed = true;
  assert.equal((await run(Effect.flip(c.inbox.detail(target())))).code, "INVALID_DATA");
  account.malformed = false;
  account.repositoryURL = "unknown://invalid/repository";
  assert.equal((await run(Effect.flip(c.inbox.detail(target())))).code, "REMOTE");
  account.repositoryURL = "";
  assert.equal((await run(c.inbox.detail(target()))).item_node, target().item_node);
});

test("detail freshness expires on the caller clock", async (t) => {
  const { c, target } = await setup(t);
  const data = await run(c.inbox.detail(target(true)));
  const cache = new InboxDetailCache();
  const clock = await run(TestClock.make());
  await run(clock.setTime(100));
  let reads = 0;
  const observe = () =>
    run(
      cache
        .observe(
          "pull",
          false,
          Effect.sync(() => ({ at: ++reads, data })),
        )
        .pipe(Effect.provideService(Clock.Clock, clock)),
    );
  assert.equal((await observe()).at, 1);
  await run(clock.adjust(freshMs - 1));
  assert.equal((await observe()).at, 1);
  await run(clock.adjust(1));
  assert.equal((await observe()).at, 2);
});
