import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Schema, Effect } from "effect";
import { automation, codingPolicy, registrationPolicy } from "../../src/config/policy.ts";
import { ProjectInputSchema } from "../../src/config/contracts.ts";
import { createExecution } from "../../src/workflow/execution.ts";
import { SqliteWorkGraph } from "../../src/work/graph.ts";
import { normalizeIssue } from "../../src/work/model.ts";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

test("profiles resolve independently of authority, retain overrides, and reject incompatible workflows", () => {
  const legacy = { ci_policy: "all-reported" as const, plan_approval: true };
  assert.deepEqual(registrationPolicy({}, legacy), legacy);
  for (const profile of ["strict", "standard", "quick"] as const) {
    const p = registrationPolicy({ quality_profile: profile });
    const resolved = codingPolicy(p, profile === "quick" ? "lightweight-fix" : "full-openspec");
    assert.equal(resolved.ci_policy, profile === "strict" ? "all-reported" : "required");
    assert.equal(resolved.plan_approval, profile !== "quick");
    assert.equal(automation({}).validation.engine, "native");
    assert.equal(automation({}).ci_retry.max_reruns, 0);
    assert.equal(automation({}).discussion.replies, "manual");
  }
  const custom = registrationPolicy({ quality_profile: "standard", ci_policy: "all-reported" });
  assert.equal(codingPolicy(custom, "full-openspec").ci_policy, "all-reported");
  assert.deepEqual(registrationPolicy({}, custom), custom);
  assert.equal(registrationPolicy({ quality_profile: "quick" }, custom).plan_approval, false);
  assert.throws(
    () => codingPolicy(registrationPolicy({ quality_profile: "quick" }), "full-openspec"),
    /Quick/,
  );
  assert.throws(
    () => codingPolicy(registrationPolicy({ quality_profile: "strict" }), "lightweight-fix"),
    /Strict/,
  );
  assert.throws(() => codingPolicy(legacy, "research-only", "strict"), /Research/);
  assert.deepEqual(codingPolicy({ ...legacy, quality_profile: "quick" }, "research-only"), legacy);
});

test("automation contracts reject unsafe target identities, invalid policy and unlimited budgets", () => {
  const decode = Schema.decodeUnknownSync(ProjectInputSchema);
  for (const fields of [
    { quality_profile: "yolo" },
    { publication: "now" },
    { ci_retry: { max_reruns: 6, workflows: [] } },
    { ci_retry: { max_reruns: 1, workflows: ["../remote.yml"] } },
    { validation: { engine: "no-mistakes", max_runs: 0 } },
    {
      reviewers: {
        users: ["../person"],
        teams: [],
        request: "on-ready",
        rerequest_after_correction: false,
      },
    },
  ])
    assert.throws(() => decode({ id: "api", ...fields }));
});

test("SQLite retains profile preferences, legacy retry identity and rejects rebinding", async () => {
  await run(
    Effect.gen(function* () {
      const work = yield* SqliteWorkGraph.open(":memory:");
      const request = normalizeIssue({
        repository_id: "api",
        title: " Goal ",
        description: "Scope",
        priority: 2,
        dependencies: [],
        request_id: "legacy",
      });
      const first = yield* work.create(request);
      assert.equal((yield* work.create(request)).id, first.id);
      assert.equal(first.quality_profile, undefined);
      const profiled = yield* work.create({
        ...request,
        request_id: Id.RequestId.make("profiled"),
        quality_profile: "strict",
      });
      assert.equal((yield* work.show(profiled.id)).quality_profile, "strict");
      const changed = yield* work
        .create({ ...request, quality_profile: "strict" })
        .pipe(Effect.exit);
      assert.equal(changed._tag, "Failure");
      assert.equal((yield* work.list).length, 2);
    }),
  );
});

test("execution snapshot retains selected profile and cloned automation after registry updates", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  Object.assign(p, registrationPolicy({ quality_profile: "standard" }));
  p.reviewers = {
    users: ["reviewer"],
    teams: [],
    request: "on-ready",
    rerequest_after_correction: false,
  };
  const e = await run(
    createExecution(p, {
      issue_id: Id.IssueId.make("snapshot"),
      repository_id: p.id,
      execution_id: Id.ExecutionId.make("abra-snapshot"),
      workflow_policy: "full-openspec",
      current_phase: "claiming",
      branch: Id.BranchName.make("work/snapshot"),
      openspec_change: Id.ChangeName.make("snapshot"),
    }),
  );
  const saved = e;
  p.reviewers = { ...p.reviewers, users: ["changed"] };
  Object.assign(p, registrationPolicy({ quality_profile: "quick" }, p));
  assert.equal(saved.effective_policy.quality?.profile, "standard");
  assert.equal(saved.effective_policy.ci_policy, "required");
  assert.equal(saved.merge_approval_required, true);
  assert.equal(saved.effective_policy.reviewers?.users[0], "reviewer");
});
