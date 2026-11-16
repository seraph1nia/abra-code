import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { forgeFixture } from "../forge.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";

test("forge findings retain old unresolved and comment-only reviews, supersede verdicts and refuse changed heads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const pr: PR = {
    ...f.delivery.pr!,
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
  };
  e.pull_request_reference = pr.url;
  const forge = forgeFixture(p, () => pr);
  const review = (id: number, head: string, state: string, user = id) => ({
    id,
    commit_id: head,
    state,
    body: "Review finding",
    html_url: `${pr.url}#review-${id}`,
    submitted_at: "2026-10-15T00:00:00Z",
    user: { id: user, login: `reviewer-${user}` },
  });
  forge.config.reviews = [
    review(1, "a".repeat(40), "CHANGES_REQUESTED"),
    review(2, e.delivered_commit!, "COMMENTED"),
    review(3, e.delivered_commit!, "CHANGES_REQUESTED"),
    review(4, e.delivered_commit!, "CHANGES_REQUESTED", 8),
    review(5, e.delivered_commit!, "APPROVED", 8),
  ];
  const delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
  const findings = await run(delivery.findings(p, e));
  assert.equal(findings.length, 5);
  assert.equal(findings.filter((f) => f.kind === "review").length, 4);
  assert.ok(findings.some((f) => f.source_id === "review-3"));
  pr.headRefOid = Id.Commit.make("b".repeat(40));
  await assert.rejects(run(delivery.findings(p, e)), /exact/);
  assert.equal(forge.calls.filter((a) => ["merge", "create", "edit"].includes(a[1])).length, 0);
});
