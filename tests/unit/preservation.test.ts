import * as Id from "../../src/identities.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { forgeFixture } from "../forge.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";

for (const method of ["merge", "squash", "rebase"] as const) {
  test(`${method} preservation binds source/result, survives deleted source refs and rejects rewritten target history`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.merge_method = method;
    await run(f.records.saveProject(p));
    const e = await run(delivered(f));
    await run(f.git.run(e.worktree_directory!, ["push", "origin", e.branch]));
    if (method === "merge")
      await run(
        f.git.run(p.path, ["merge", "--no-ff", e.delivered_commit!, "-m", "Merged fixture"]),
      );
    if (method === "squash") {
      await run(f.git.run(p.path, ["merge", "--squash", e.delivered_commit!]));
      await run(f.git.run(p.path, ["commit", "-m", "Squashed fixture"]));
    }
    if (method === "rebase") {
      await writeFile(join(p.path, "target-only.txt"), "New target commit\n");
      await run(f.git.run(p.path, ["add", "."]));
      await run(f.git.run(p.path, ["commit", "-m", "Advance target"]));
      await run(f.git.run(p.path, ["cherry-pick", e.delivered_commit!]));
    }
    const result = await run(f.git.head(p.path));
    await run(f.git.run(p.path, ["push", "origin", "main"]));
    await run(f.git.run(p.path, ["push", "origin", "--delete", e.branch]));
    const pr: PR = {
      url: e.pull_request_reference!,
      state: "MERGED",
      headRefOid: e.delivered_commit!,
      baseRefName: Id.BranchName.make("main"),
      mergeCommit: { oid: result },
      mergedAt: new Date().toISOString(),
      isDraft: false,
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
    };
    const forge = forgeFixture(p, () => pr),
      delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
    const receipt = await run(delivery.evidence(p, e));
    assert.ok("result_commit" in receipt);
    assert.equal(receipt.result_commit, result);
    assert.equal(receipt.source_commit, e.delivered_commit);
    assert.equal(receipt.method, method);
    if (method !== "merge")
      await assert.rejects(
        run(f.git.run(p.path, ["merge-base", "--is-ancestor", e.delivered_commit!, "HEAD"])),
      );
    e.delivery_receipt = receipt;
    e.current_phase = "cleaning";
    await run(f.records.save(e));
    await run(f.git.run(p.path, ["push", "--force", "origin", `${e.base_commit}:refs/heads/main`]));
    const controller = new Controller(
      f.config,
      f.records,
      f.work,
      f.spec,
      f.git,
      f.runtime,
      delivery,
      f.locks,
    );
    await assert.rejects(run(controller.finish(e.issue_id)));
    await access(e.worktree_directory!);
    assert.equal((await run(f.work.show(e.issue_id))).status, "in_progress");
  });
}

test("a lost merge response reconciles the exact merged PR without repeating submission", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.merge_approval = false;
  await run(f.records.saveProject(p));
  const e = await run(delivered(f));
  let submissions = 0;
  const pr: PR = {
    url: e.pull_request_reference!,
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const forge = forgeFixture(p, () => pr);
  const delivery = new GitHubDelivery(
    f.git,
    {
      run: (...args) =>
        args[1][0] === "pr" && args[1][1] === "merge"
          ? Effect.gen(function* () {
              submissions++;
              yield* f.git.run(p.path, [
                "merge",
                "--no-ff",
                e.delivered_commit!,
                "-m",
                "Merged fixture",
              ]);
              yield* f.git.run(p.path, ["push", "origin", "main"]);
              pr.state = "MERGED";
              pr.mergeCommit = { oid: yield* f.git.head(p.path) };
              pr.mergedAt = new Date().toISOString();
              return yield* new CrewError("COMMAND_FAILED", "Merge response lost");
            })
          : forge.runner.run(...args),
    },
    Id.Executable.make("fake-forge"),
  );
  const controller = () =>
    new Controller(f.config, f.records, f.work, f.spec, f.git, f.runtime, delivery, f.locks);
  await assert.rejects(run(controller().finish(e.issue_id)), /response lost/);
  assert.equal((await run(controller().reconcile(e.issue_id)))[0].current_phase, "completed");
  assert.equal(submissions, 1);
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
});

test("PR updates rediscover one identity, preserve outside user text and avoid repeated pushes/edits", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  e.intent = { title: "Preserve reconnect state", description: "Retain completed upload chunks." };
  const pr: PR = {
    url: e.pull_request_reference!,
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    body: "User notes.\n",
  };
  const forge = forgeFixture(p, () => pr);
  let edits = 0;
  const delivery = new GitHubDelivery(
    f.git,
    {
      run: (...args) =>
        args[1][1] === "edit"
          ? Effect.tryPromise({
              try: async () => {
                edits++;
                pr.body = await readFile(args[1][args[1].indexOf("--body-file") + 1], "utf8");
                return "";
              },
              catch: CrewError.from,
            })
          : forge.runner.run(...args),
    },
    Id.Executable.make("fake-forge"),
  );
  await run(delivery.deliver(p, e));
  await run(delivery.deliver(p, e));
  assert.equal(edits, 1);
  assert.ok(pr.body!.startsWith("User notes.\n"));
  pr.body += "\nUser epilogue.\n";
  e.review_receipt = { ...e.review_receipt!, findings: "Verified reconnect edge cases." };
  await run(delivery.deliver(p, e));
  assert.equal(edits, 2);
  assert.ok(pr.body!.endsWith("\nUser epilogue.\n"));
  assert.equal(forge.calls.filter((a) => a[1] === "create").length, 0);
});
