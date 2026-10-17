import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture, delivered } from "../fixtures.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";
import { type Runner } from "../../src/process.ts";
import { forgeFixture } from "../forge.ts";
import { permittedTools } from "../../src/opencode/guards.ts";
test("delivery rediscovers an existing PR and exact pushed head without creating or pushing duplicates", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const calls: string[][] = [];
  const pr: PR = {
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    body: "",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  };
  const runner: Runner = {
    run(_file, args) {
      return domainEffect(
        Effect.sync(() => {
          calls.push(args);
          return JSON.stringify([pr]);
        }),
      );
    },
  };
  const git = f.git;
  const original = git.run.bind(git);
  git.run = (cwd, args) =>
    domainEffect(
      Effect.gen(function* () {
        return args[0] === "ls-remote"
          ? `${e.delivered_commit}\trefs/heads/${e.branch}`
          : yield* original(cwd, args);
      }),
    );
  e.pull_request_reference = pr.url;
  const d = new GitHubDelivery(git, runner, Id.Executable.make("gh"));
  const result = await run(d.deliver(p, e));
  assert.equal(result.pr, pr.url);
  assert.equal(calls.filter((a) => a[1] === "create").length, 0);
});
test("merge requires exact PR head and successful CI, honors requested changes", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  let pr: PR = {
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    body: "",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
  };
  const { calls, runner: r } = forgeFixture(p, () => pr);
  e.pull_request_reference = pr.url;
  const d = new GitHubDelivery(f.git, r, Id.Executable.make("gh"));
  assert.equal((await run(d.merge(p, e))).category, "verification");
  pr.statusCheckRollup = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
  pr.reviewDecision = "CHANGES_REQUESTED";
  assert.equal((await run(d.merge(p, e))).category, "verification");
  pr.reviewDecision = "APPROVED";
  pr.headRefOid = Id.Commit.make("f".repeat(40));
  await assert.rejects(run(d.merge(p, e)), /head/);
  assert.equal(calls.filter((a) => a[1] === "merge").length, 0);
});
test("worker tool allowlists deny management, arbitrary delegation and Explore shell", () => {
  for (const role of ["explore", "apply", "review"] as const) {
    const allow = permittedTools(role);
    assert.equal(allow.has(Id.ToolName.make("abra_work_approve")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_finish")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_create")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_diagnostics")), false);
    assert.equal(allow.has(Id.ToolName.make("task")), false);
  }
  assert.equal(permittedTools("explore").has(Id.ToolName.make("bash")), false);
  assert.equal(permittedTools("review").has(Id.ToolName.make("write")), false);
  assert.equal(permittedTools("apply").has(Id.ToolName.make("bash")), true);
});
