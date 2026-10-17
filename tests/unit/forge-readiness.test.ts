import * as Id from "../../src/identities.ts";
import { Effect, Schema } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, delivered } from "../fixtures.ts";
import { forgeFixture } from "../forge.ts";
import { run } from "../effects.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";
import { CheckSchema, Forge } from "../../src/git/forge.ts";
import { ProcessRunner, type Runner } from "../../src/process.ts";
import { CrewError } from "../../src/domain.ts";
import { updateSummary, prContent } from "../../src/git/pr-content.ts";

const protection = {
  requiresStatusChecks: true,
  requiresLinearHistory: false,
  requiresApprovingReviews: false,
  requiredStatusChecks: [{ context: "build", app: { databaseId: 10 } }],
};
for (const mode of ["merge", "squash", "rebase"] as const) {
  test(`configured ${mode} uses an exact-head request and preserves its snapshotted method`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.merge_method = mode;
    await run(f.records.saveProject(p));
    const e = await run(delivered(f));
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
    const delivery = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
    p.merge_method = mode === "merge" ? "squash" : "merge";
    assert.equal((await run(delivery.merge(p, e))).category, "completed");
    const request = forge.calls.find((a) => a[0] === "pr" && a[1] === "merge")!;
    assert.deepEqual(request, [
      "pr",
      "merge",
      pr.url,
      `--${mode}`,
      "--match-head-commit",
      e.delivered_commit,
    ]);
    assert.equal(request.includes("--admin"), false);
  });
}

for (const scenario of ["advisory", "missing", "wrong-app", "latest", "default-failure"] as const) {
  test(`required-check identity: ${scenario}`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.ci_policy = scenario === "default-failure" ? "all-reported" : "required";
    await run(f.records.saveProject(p));
    const e = await run(delivered(f));
    const pr: PR = {
      url: e.pull_request_reference!,
      state: "OPEN",
      headRefOid: e.delivered_commit!,
      baseRefName: Id.BranchName.make("main"),
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      reviewDecision: "APPROVED",
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    };
    const forge = forgeFixture(p, () => pr);
    forge.config.protection = protection;
    const check = (id: number, name: string, app: number, conclusion: string) => ({
      id,
      name: Id.CheckName.make(name),
      app: { id: app },
      head_sha: e.delivered_commit!,
      status: "completed" as const,
      conclusion,
    });
    forge.config.runs =
      scenario === "missing"
        ? []
        : scenario === "wrong-app"
          ? [check(1, "build", 11, "success")]
          : scenario === "latest"
            ? [check(1, "build", 10, "failure"), check(2, "build", 10, "success")]
            : [check(1, "build", 10, "success"), check(2, "advisory", 20, "failure")];
    const result = await run(
      new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge")).merge(p, e),
    );
    assert.equal(
      result.category,
      scenario === "missing" || scenario === "wrong-app"
        ? "waiting"
        : scenario === "default-failure"
          ? "verification"
          : "completed",
    );
    if (scenario === "missing" || scenario === "wrong-app") {
      assert.ok(result.category !== "completed");
      assert.match(result.reason, /build.*app 10/);
    }
    if (scenario === "advisory")
      assert.match(e.forge_observation!.reasons.join(), /Advisory.*advisory/);
    assert.equal(e.forge_observation!.required_confirmed, true);
  });
}

for (const condition of [
  "pending",
  "cancelled",
  "skipped",
  "draft",
  "unknown",
  "queue",
  "restricted",
  "no-checks",
  "allow-empty",
  "unreadable",
] as const) {
  test(`forge condition: ${condition}`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    p.allow_no_checks = condition === "allow-empty";
    await run(f.records.saveProject(p));
    const e = await run(delivered(f));
    const pr: PR = {
      url: e.pull_request_reference!,
      state: "OPEN",
      headRefOid: e.delivered_commit!,
      baseRefName: Id.BranchName.make("main"),
      isDraft: condition === "draft",
      mergeable: condition === "unknown" ? "UNKNOWN" : "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      statusCheckRollup:
        condition === "no-checks" || condition === "allow-empty"
          ? []
          : [
              {
                status: condition === "pending" ? "IN_PROGRESS" : "COMPLETED",
                conclusion:
                  condition === "pending"
                    ? null
                    : condition === "cancelled"
                      ? "CANCELLED"
                      : condition === "skipped"
                        ? "SKIPPED"
                        : "SUCCESS",
              },
            ],
    };
    const forge = forgeFixture(p, () => pr);
    if (condition === "queue") forge.config.rules = [{ type: "merge_queue" }];
    if (condition === "restricted") forge.config.methods.merge = false;
    const runner: Runner =
      condition === "unreadable"
        ? {
            run: (...args) =>
              args[1][0] === "api" && args[1][1] === "graphql"
                ? Effect.fail(new CrewError("COMMAND_FAILED", "Permission unavailable"))
                : forge.runner.run(...args),
          }
        : forge.runner;
    const delivery = new GitHubDelivery(f.git, runner, Id.Executable.make("fake-forge"));
    if (condition === "unreadable")
      await assert.rejects(run(delivery.merge(p, e)), /observation unavailable/);
    else {
      const result = await run(delivery.merge(p, e));
      assert.equal(
        result.category,
        condition === "skipped" || condition === "allow-empty"
          ? "completed"
          : condition === "cancelled"
            ? "verification"
            : "waiting",
      );
    }
    assert.equal(
      forge.calls.some((a) => a[1] === "merge"),
      condition === "skipped" || condition === "allow-empty",
    );
  });
}

test("readiness refuses a head that changes during observation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const pr: PR = {
    url: e.pull_request_reference!,
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const forge = forgeFixture(p, () => pr);
  const runner: typeof forge.runner = {
    run: (...args) =>
      forge.runner.run(...args).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (args[1][1].includes("/check-runs")) pr.headRefOid = Id.Commit.make("b".repeat(40));
          }),
        ),
      ),
  };
  await assert.rejects(
    run(new GitHubDelivery(f.git, runner, Id.Executable.make("fake-forge")).merge(p, e)),
    /head/,
  );
  assert.equal(
    forge.calls.some((a) => a[1] === "merge"),
    false,
  );
});

test("documented pending exit output decodes without error-prose parsing", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const script = join(f.root, "forge.mjs");
  const checks = [
    {
      name: "build",
      bucket: "pending",
      state: "PENDING",
      link: "",
      workflow: "CI",
      startedAt: "",
      completedAt: "",
    },
  ];
  await writeFile(
    script,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(checks))});process.exit(8);\n`,
    { mode: 0o700 },
  );
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  assert.equal(
    (
      await run(
        new Forge(new ProcessRunner(), Id.Executable.make(script)).json(
          p,
          Schema.Array(CheckSchema),
          ["pr", "checks"],
          { allowed_exit_codes: [8] },
        ),
      )
    )[0].bucket,
    "pending",
  );
});

test("PR summaries describe actual intent/evidence and preserve user text outside owned markers", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  e.intent = {
    title: "Handle interrupted uploads",
    description: "Preserve uploaded chunks after reconnect.",
  };
  const generated = prContent(p, e, e.delivered_commit!);
  assert.equal(generated.title, e.intent.title);
  assert.match(generated.body, /Preserve uploaded chunks/);
  assert.match(generated.body, /Independent Review: passed/);
  const before = `User introduction.\n\n${generated.body}\n\nUser follow-up.\n`;
  const changed = generated.body.replace("Preserve uploaded chunks", "Keep uploaded chunks");
  const after = updateSummary(before, changed);
  assert.ok(after.startsWith("User introduction.\n\n"));
  assert.ok(after.endsWith("\n\nUser follow-up.\n"));
  assert.equal(updateSummary(after, changed), after);
  assert.throws(() => updateSummary("<!-- abracode:summary:start -->broken", changed), /markers/);
});
