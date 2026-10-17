import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { Clock } from "effect";
import { TestClock } from "effect/testing";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { forgeFixture } from "../forge.ts";
import { GitHubDelivery } from "../../src/git/delivery.ts";
import { FeedbackService, pendingFindings } from "../../src/workflow/feedback.ts";
import { FeedbackSchema, mergeFeedback } from "../../src/workflow/feedback-contracts.ts";
import * as Id from "../../src/identities.ts";

for (const current of ["failure", "success"] as const)
  test(`canonical checks keep app and status identity with current ${current}`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.ci_policy = "required";
    await run(f.records.saveProject(p));
    const e = await run(delivered(f));
    const forge = forgeFixture(p, () => f.delivery.pr);
    forge.config.rules = [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "same-name", integration_id: 1 }],
          strict_required_status_checks_policy: false,
        },
      },
    ];
    forge.config.runs = [
      {
        id: 10,
        name: Id.CheckName.make("same-name"),
        app: { id: 1 },
        head_sha: e.delivered_commit!,
        status: "completed",
        conclusion: "failure",
      },
      {
        id: 11,
        name: Id.CheckName.make("same-name"),
        app: { id: 1 },
        head_sha: e.delivered_commit!,
        status: "completed",
        conclusion: current,
      },
      {
        id: 12,
        name: Id.CheckName.make("same-name"),
        app: { id: 2 },
        head_sha: e.delivered_commit!,
        status: "completed",
        conclusion: "failure",
      },
    ];
    forge.config.statuses = [
      { id: 100, context: Id.CheckName.make("same-name"), state: "failure" },
    ];
    const delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
    const observed = await run(delivery.feedback(p, e));
    assert.equal(observed.complete, true);
    assert.deepEqual(
      e.forge_observation!.checks.map((c) => c.blocking),
      [true, false, false],
    );
    assert.deepEqual(
      observed.findings.map((c) => c.blocking),
      current === "failure" ? [true, false, false] : [false, false],
    );
    assert.ok(observed.findings.every((c) => c.source_id !== "check-check-run-10"));
    assert.ok(observed.findings.some((c) => c.source_id === "check-status-100"));
    assert.ok(observed.findings.every((c) => c.evidence_unavailable));
    assert.equal(forge.calls.filter((args) => args[1].includes("/check-runs")).length, 1);
    assert.equal(forge.calls.filter((args) => args[1].includes("/statuses?")).length, 1);
    assert.equal(
      forge.calls.some((args) => args[0] === "pr" && args[1] === "checks"),
      false,
    );
  });

test("inline-only and ordinary comments retain old context; fresh observations deduplicate edits", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(e.repository_id)))!;
  const pr = {
    ...f.delivery.pr!,
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
  };
  e.pull_request_reference = pr.url;
  const forge = forgeFixture(p, () => pr);
  forge.config.reviews = [
    {
      id: 1,
      commit_id: e.delivered_commit,
      state: "CHANGES_REQUESTED",
      body: "",
      html_url: pr.url,
      submitted_at: "2026-10-16T00:00:00Z",
      user: { login: "reviewer" },
    },
  ];
  forge.config.comments = [
    {
      id: 2,
      body: "Fix the error path",
      html_url: `${pr.url}#issuecomment-2`,
      updated_at: "2026-10-16T00:00:00Z",
      user: { login: "bot" },
    },
  ];
  forge.config.threads = [
    {
      id: "thread-1",
      isResolved: false,
      viewerCanResolve: true,
      path: "source.txt",
      comments: {
        nodes: [
          {
            id: "inline-1",
            databaseId: 3,
            body: "Preserve the existing data",
            url: `${pr.url}#discussion_r3`,
            updatedAt: "2026-10-16T00:00:00Z",
            author: { login: "reviewer" },
            originalCommit: { oid: "a".repeat(40) },
            pullRequestReview: { state: "CHANGES_REQUESTED" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  ];
  const delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
  const first = await run(delivery.feedback(p, e));
  assert.equal(first.complete, true);
  assert.deepEqual(
    first.findings.map((x) => x.kind),
    ["review", "comment", "thread"],
  );
  assert.equal(first.findings[2].original_head, "a".repeat(40));
  const again = mergeFeedback(first, await run(delivery.feedback(p, e)));
  assert.deepEqual(first.findings, again.findings);
  assert.equal(again.history.length, 0);
  forge.config.comments = [
    { ...(forge.config.comments[0] as object), body: "Also preserve timeout semantics" },
  ];
  const edited = mergeFeedback(again, await run(delivery.feedback(p, e)));
  assert.notEqual(edited.findings[1].id, first.findings[1].id);
  assert.equal(edited.history[0].id, first.findings[1].id);
  assert.equal(
    forge.calls.some((a) => ["merge", "edit", "create"].includes(a[1])),
    false,
  );
});

test("retained feedback classification requires exact generation/head/revision and survives reconstruction", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(e.repository_id)))!;
  const pr = {
    ...f.delivery.pr!,
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
  };
  e.pull_request_reference = pr.url;
  await run(f.records.save(e));
  const forge = forgeFixture(p, () => pr);
  forge.config.comments = [
    {
      id: 2,
      body: "Handle empty input",
      html_url: pr.url,
      updated_at: "2026-10-16T00:00:00Z",
      user: { login: "reviewer" },
    },
  ];
  const delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
  const service = new FeedbackService(f.records, delivery);
  await run(service.refresh(e, p, true));
  const id = e.feedback!.findings[0].id;
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    finding_ids: [id],
    disposition: "in_scope" as const,
    reason: "Accepted input contract",
  };
  await assert.rejects(
    run(
      service.disposition(
        e,
        { ...input, generation: input.generation + 1 },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    /generation/,
  );
  await run(service.disposition(e, input, Id.SessionId.make("ses_supervisor")));
  const reconstructed = await run(f.records.execution(e.issue_id));
  assert.equal(reconstructed!.feedback!.findings[0].disposition!.status, "in_scope");
  assert.equal(pendingFindings(reconstructed!.feedback).length, 0);
  await run(new FeedbackService(f.records, delivery).refresh(e, p, true));
  assert.equal(e.feedback!.findings[0].disposition!.status, "in_scope");
  await assert.rejects(
    run(
      service.disposition(
        e,
        { ...input, disposition: "addressed" },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    /evidence/,
  );
});

test("unreadable sources retain unconfirmed evidence and respect backoff without reasoning", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(e.repository_id)))!;
  const base = f.delivery;
  const initialPrompts = f.runtime.prompts;
  let reads = 0;
  const { CrewError } = await import("../../src/domain.ts");
  const service = new FeedbackService(f.records, {
    deliver: base.deliver.bind(base),
    inspect: base.inspect.bind(base),
    merge: base.merge.bind(base),
    evidence: base.evidence.bind(base),
    feedback: () => {
      reads++;
      return Effect.fail(new CrewError("FORGE_OBSERVATION_FAILED", "Source unavailable"));
    },
  });
  const clock = await run(TestClock.make());
  await run(service.refresh(e, p).pipe(Effect.provideService(Clock.Clock, clock)));
  assert.equal(e.feedback?.complete, false);
  const count = reads;
  await run(service.refresh(e, p).pipe(Effect.provideService(Clock.Clock, clock)));
  assert.equal(reads, count);
  assert.throws(() =>
    Schema.decodeUnknownSync(FeedbackSchema)({ ...e.feedback, schema_version: 2 }),
  );
  assert.equal(f.runtime.prompts, initialPrompts);
});

test("incomplete observations preserve unresolved revisions and immutable paged history", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  const finding = {
    id: Id.FindingId.make("comment-old"),
    source_id: "comment-1",
    revision: "body-1",
    head: e.delivered_commit!,
    kind: "comment" as const,
    text: "Do not drop existing data",
    blocking: true,
  };
  const original = {
    schema_version: 1 as const,
    head: e.delivered_commit!,
    pr: e.pull_request_reference!,
    target: e.target_branch!,
    observed_at: 1,
    next_check_at: 2,
    attempts: 0,
    complete: true,
    digest: "first",
    findings: [finding],
    history: [],
    actions: [],
  };
  const fullHistory = Array.from({ length: 4096 }, (_, i) => ({
    ...finding,
    id: Id.FindingId.make(`historical-${i}`),
    source_id: `old-${i}`,
  }));
  const capped = mergeFeedback(
    { ...original, history: fullHistory },
    { ...original, findings: [] },
  );
  assert.equal(capped.complete, false, "History overflow cannot establish clearance");
  assert.equal(capped.findings[0].id, finding.id);
  assert.equal(capped.history.length, 4096);
  const incomplete = mergeFeedback(original, {
    ...original,
    findings: [],
    complete: false,
    error: "Page unavailable",
    observed_at: 3,
    next_check_at: 4,
  });
  assert.equal(incomplete.findings[0].id, finding.id);
  assert.equal(incomplete.complete, false);
  e.feedback = mergeFeedback(original, {
    ...original,
    findings: [],
    observed_at: 3,
    next_check_at: 4,
  });
  await run(f.records.save(e));
  const before = await run(f.records.execution(e.issue_id));
  const page = await run(f.records.feedback(e.issue_id));
  assert.equal(page.history[0].text, finding.text);
  assert.equal(page.history_total, 1);
  assert.equal((await run(f.records.feedback(e.issue_id, 1))).history.length, 0);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  e.feedback = { ...e.feedback, history: [] };
  await assert.rejects(run(f.records.save(e)), /history/);
});

test("due feedback is retained before human merge approval and recovers a known CI block", async (t) => {
  const { Controller } = await import("../../src/workflow/controller.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  const p = (await run(f.records.project(e.repository_id)))!;
  const form = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in form);
  const clock = await run(TestClock.make());
  const call = <A, E>(eff: Effect.Effect<A, E>) =>
    run(eff.pipe(Effect.provideService(Clock.Clock, clock)));
  let reads = 0,
    failed = true;
  const base = f.delivery;
  const delivery = {
    deliver: base.deliver.bind(base),
    inspect: base.inspect.bind(base),
    merge: base.merge.bind(base),
    evidence: base.evidence.bind(base),
    feedback: () => {
      reads++;
      return Effect.succeed({
        schema_version: 1 as const,
        head: e.delivered_commit!,
        pr: e.pull_request_reference!,
        target: p.target_branch,
        observed_at: reads === 1 ? 0 : 31000,
        next_check_at: reads === 1 ? 30000 : 61000,
        attempts: 0,
        complete: true,
        digest: failed ? "failed" : "passed",
        findings: failed
          ? [
              {
                id: Id.FindingId.make("ci-first"),
                source_id: "check-1",
                revision: "attempt-1",
                head: e.delivered_commit!,
                kind: "check" as const,
                text: "CI failed",
                blocking: true,
              },
            ]
          : [],
        history: [],
        actions: [],
      });
    },
  };
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    delivery,
    f.locks,
  );
  t.onTestFinished(() => run(c.close()));
  await call(c.reconcile(e.issue_id));
  e = await run(c.get(e.issue_id));
  assert.equal(e.feedback?.findings[0].text, "CI failed");
  assert.equal(e.approval_receipts.at(-1)!.authorized_at, undefined);
  assert.equal(reads, 1);
  await call(c.reconcile(e.issue_id));
  assert.equal(reads, 1);
  e = await run(c.get(e.issue_id));
  e.current_phase = "blocked";
  e.resume_phase = "awaiting_merge";
  e.delivery_block = "CI_FAILED";
  await run(f.records.save(e));
  await run(f.work.block(e.issue_id, e.execution_id, "CI failed"));
  failed = false;
  await call(clock.setTime(31000));
  await call(c.reconcile(e.issue_id));
  e = await run(c.get(e.issue_id));
  assert.equal(e.current_phase, "awaiting_merge");
  assert.equal(e.delivery_block, undefined);
  assert.equal(e.feedback!.findings.length, 0);
  assert.equal(e.feedback!.history[0].id, "ci-first");
  const before = reads;
  await call(c.control(e.issue_id, "pause"));
  await call(c.reconcile(e.issue_id));
  assert.equal(reads, before);
});

test("a feedback disposition commits alongside a newer native progress observation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  const finding = {
    id: Id.FindingId.make("concurrent"),
    source_id: "comment-5",
    revision: "rev-5",
    head: e.delivered_commit!,
    kind: "comment" as const,
    text: "Check accepted behavior",
    blocking: true,
  };
  e.feedback = {
    schema_version: 1,
    head: e.delivered_commit!,
    pr: e.pull_request_reference!,
    target: e.target_branch!,
    observed_at: 1,
    next_check_at: 2,
    attempts: 0,
    complete: true,
    digest: "current",
    findings: [finding],
    history: [],
    actions: [],
  };
  await run(f.records.save(e));
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      progress: {
        schema_version: 1,
        generation: current.control_generation,
        session_id: current.apply_session_id!,
        at: 10,
        summary: "Newer native observation",
        source: "native",
      },
    })),
  );
  await run(
    new FeedbackService(f.records, f.delivery).disposition(
      e,
      {
        issue_id: e.issue_id,
        generation: e.control_generation,
        expected_head: e.delivered_commit!,
        finding_ids: [finding.id],
        disposition: "informational",
        reason: "No scope change required",
      },
      Id.SessionId.make("ses_supervisor"),
    ),
  );
  const saved = (await run(f.records.execution(e.issue_id)))!;
  assert.equal(saved.progress!.summary, "Newer native observation");
  assert.equal(saved.feedback!.findings[0].disposition!.status, "informational");
});

for (const mode of ["complete", "foreign-thread", "missing-page", "mixed-head"] as const)
  test(`nested published discussion pagination ${mode} cannot invent clearance`, async (t) => {
    const { CrewError } = await import("../../src/domain.ts");
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const e = await run(delivered(f)),
      p = (await run(f.records.project(e.repository_id)))!;
    const pr = {
      ...f.delivery.pr!,
      url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
    };
    e.pull_request_reference = pr.url;
    const forge = forgeFixture(p, () => pr);
    const comment = (id: string, body: string, state = "COMMENTED") => ({
      id,
      databaseId: id === "one" ? 1 : 2,
      body,
      url: state === "PENDING" ? null : `${pr.url}#discussion_${id}`,
      updatedAt: "2026-10-16T00:00:00Z",
      author: { login: "reviewer" },
      originalCommit: { oid: e.delivered_commit },
      pullRequestReview: { state },
    });
    forge.config.threads = [
      {
        id: "thread-1",
        isResolved: false,
        viewerCanResolve: true,
        path: "source.txt",
        comments: {
          nodes: [comment("one", "First finding"), comment("pending", "PRIVATE DRAFT", "PENDING")],
          pageInfo: { hasNextPage: true, endCursor: "comments-2" },
        },
      },
    ];
    const calls: string[][] = [];
    const delivery = new GitHubDelivery(
      f.git,
      {
        run: (file, args, cwd, env, options) => {
          calls.push(args);
          if (args.some((a) => a.includes("comments(first:100,after"))) {
            if (mode === "missing-page")
              return Effect.fail(
                new CrewError("FORGE_OBSERVATION_FAILED", "Nested page unavailable"),
              );
            return Effect.succeed(
              JSON.stringify({
                data: {
                  node: {
                    id: mode === "foreign-thread" ? "other-thread" : "thread-1",
                    comments: {
                      nodes: [comment("two", "Second finding")],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              }),
            );
          }
          if (args[1] === "graphql" && args.some((a) => a.includes("reviewThreads"))) {
            if (mode === "mixed-head") pr.headRefOid = Id.Commit.make("b".repeat(40));
            const page = args.includes("cursor=threads-2")
              ? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
              : {
                  nodes: forge.config.threads,
                  pageInfo: { hasNextPage: true, endCursor: "threads-2" },
                };
            return Effect.succeed(
              JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: page } } } }),
            );
          }
          return forge.runner.run(file, args, cwd, env, options);
        },
      },
      Id.Executable.make("fixture-forge"),
    );
    if (mode === "complete") {
      const result = await run(delivery.feedback(p, e));
      assert.equal(result.complete, true);
      assert.equal(result.findings.length, 2);
      assert.equal(JSON.stringify(result).includes("PRIVATE DRAFT"), false);
      assert.ok(calls.some((a) => a.includes("cursor=threads-2")));
      assert.ok(calls.some((a) => a.includes("cursor=comments-2")));
    } else await assert.rejects(run(delivery.feedback(p, e)), /thread|page|PR changed/);
    assert.equal(
      calls.some((a) => a.includes("POST") || a.some((s) => s.includes("mutation("))),
      false,
    );
  });

test("own reply recognition requires the authenticated author, exact content and retained marker", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(e.repository_id)))!;
  const pr = {
    ...f.delivery.pr!,
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
  };
  e.pull_request_reference = pr.url;
  const forge = forgeFixture(p, () => pr);
  const delivery = new GitHubDelivery(
    f.git,
    {
      run: (file, args, cwd, env, options) =>
        args[0] === "api" && args[1] === "user"
          ? Effect.succeed(JSON.stringify({ login: "abra-bot" }))
          : forge.runner.run(file, args, cwd, env, options),
    },
    Id.Executable.make("fake-forge"),
  );
  const first = await run(delivery.feedback(p, e));
  e.feedback = {
    ...first,
    actions: [
      {
        schema_version: 1,
        id: "reply-1",
        generation: e.control_generation,
        head: e.delivered_commit!,
        kind: "reply",
        status: "uncertain",
        authority: "execution-policy",
        finding: Id.FindingId.make("source-1"),
        revision: "rev-1",
        body: "Verified correction",
        created_at: 0,
        updated_at: 1,
      },
    ],
  };
  const exact = "Verified correction\n\n<!-- abracode-action:reply-1 -->";
  for (const [body, author, findings] of [
    [exact, "abra-bot", 0],
    ["Edited correction\n\n<!-- abracode-action:reply-1 -->", "abra-bot", 1],
    ["Verified correction", "abra-bot", 1],
    [exact, "other-user", 1],
  ] as const) {
    forge.config.comments = [
      {
        id: 9,
        body,
        html_url: pr.url,
        updated_at: "2026-10-16T00:00:00Z",
        user: { login: author },
      },
    ];
    const observed = await run(delivery.feedback(p, e));
    assert.equal(observed.complete, true);
    assert.equal(observed.findings.length, findings);
  }
  assert.equal(
    forge.calls.some((args) => args.includes("POST") || args.includes("PATCH")),
    false,
  );
});
