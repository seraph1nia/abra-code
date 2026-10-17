import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, applying } from "../fixtures.ts";
import { verifiedSpec } from "../helpers/spec-review.ts";
import { run } from "../effects.ts";
import { RepositoryId, SessionId } from "../../src/identities.ts";
import { type SpecVerification } from "../../src/workflow/review-contracts.ts";
import { Controller } from "../../src/workflow/controller.ts";

const newFixture = () => run(fixture);
async function reviewing(f: Awaited<ReturnType<typeof newFixture>>) {
  const e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  return run(f.controller.advance(e.issue_id));
}
const conflict: SpecVerification = {
  ...verifiedSpec,
  coherence: { status: "failed", evidence: "CI and the accepted requirement disagree." },
  conflicts: [
    {
      sources: [
        "specs/sample/spec.md: Sample behavior",
        "tests/sample.test.ts: legacy expectation",
      ],
      summary: "The spec requires returning a sample; CI expects the request to fail.",
    },
  ],
};

test("full-spec Review requires complete nonblank verification evidence", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await reviewing(f);
  await assert.rejects(
    run(f.controller.reviewReport(e.review_session_id!, true, "Looks good")),
    /Full-spec Review requires/,
  );
  await assert.rejects(
    run(
      f.controller.reviewReport(e.review_session_id!, true, "Looks good", undefined, {
        ...verifiedSpec,
        correctness: { status: "passed", evidence: "  " },
      }),
    ),
    /Review report/,
  );
  assert.equal((await run(f.controller.get(e.issue_id))).review_receipt, undefined);
  assert.equal(f.delivery.calls, 0);
});

test("passing Review cannot conceal failed, unverified or conflicting evidence", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  const e = await reviewing(f);
  for (const status of ["failed", "not_verified"] as const)
    await assert.rejects(
      run(
        f.controller.reviewReport(e.review_session_id!, true, "Pass", undefined, {
          ...verifiedSpec,
          correctness: { status, evidence: "Scenario coverage is unavailable." },
        }),
      ),
      /passing Review cannot/,
    );
  await assert.rejects(
    run(
      f.controller.reviewReport(e.review_session_id!, true, "Pass", "in_scope", {
        ...verifiedSpec,
        conflicts: conflict.conflicts,
      }),
    ),
    /passing Review cannot/,
  );
  await assert.rejects(
    run(
      f.controller.reviewReport(e.review_session_id!, true, "Pass", "scope_change", verifiedSpec),
    ),
    /passing Review cannot/,
  );
  assert.equal((await run(f.controller.get(e.issue_id))).review_receipt, undefined);
});

test("intentional schema omissions and suggestions permit verified delivery and survive restart", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  let e = await reviewing(f);
  const report: SpecVerification = {
    ...verifiedSpec,
    correctness: {
      status: "not_applicable",
      evidence: "The fixture schema intentionally skips behavioral specs for this tooling change.",
    },
  };
  const before = await run(f.git.fingerprint(e.worktree_directory!));
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      true,
      "SUGGESTION: a later refactor could improve naming.",
      undefined,
      report,
    ),
  );
  assert.equal(await run(f.git.fingerprint(e.worktree_directory!)), before);
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  assert.deepEqual((await run(c.get(e.issue_id))).review_receipt!.spec_verification, report);
  f.runtime.success(e.review_session_id!);
  e = await run(c.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_merge");
  assert.equal(f.delivery.calls, 1);
});

test("contradictory CI and spec evidence requires a decision despite an in-scope repair label", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(RepositoryId.make("api"))))!;
  p.repair_rounds = 2;
  await run(f.records.saveProject(p));
  let e = await reviewing(f);
  const plan = e.plan_fingerprint;
  const before = await run(f.git.fingerprint(e.worktree_directory!));
  const prompts = f.runtime.prompts;
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "Resolve disagreement",
      "in_scope",
      conflict,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /Review failed/);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.review_receipt!.scope_status, "uncertain");
  assert.equal(e.rounds, undefined);
  assert.equal(e.plan_fingerprint, plan);
  assert.equal(await run(f.git.fingerprint(e.worktree_directory!)), before);
  const decision = e.decisions!.find((d) => d.status === "open")!;
  assert.match(decision.question, /specs\/sample\/spec.md/);
  assert.match(decision.question, /tests\/sample.test.ts/);
  assert.match(decision.question, /returning a sample/);
  await assert.rejects(
    run(f.controller.control(e.issue_id, "retry")),
    /Resolve the Review scope conflict/,
  );
  assert.equal(f.runtime.prompts, prompts);

  const pending = await run(
    f.controller.decision(
      e.issue_id,
      decision.key,
      e.control_generation,
      SessionId.make("ses_supervisor"),
      "collect",
    ),
  );
  f.runtime.questions.set(pending.form_id!, {
    status: "answered",
    answer: "The approved behavior stands; correct the obsolete test.",
  });
  await run(
    f.controller.decision(
      e.issue_id,
      decision.key,
      e.control_generation,
      SessionId.make("ses_supervisor"),
      "collect",
    ),
  );
  const retry = await run(
    f.controller.control(
      e.issue_id,
      "retry",
      "Correct the obsolete test; preserve accepted behavior",
    ),
  );
  assert.equal(retry.current_phase, "applying");
  assert.equal(retry.plan_fingerprint, plan);
  assert.equal(retry.review_receipt, undefined);
  assert.equal(retry.verification_receipt, undefined);
});

test("changed requirements invalidate previous approval and need a new plan checkpoint", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  let e = await reviewing(f);
  const plan = e.plan_fingerprint;
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "The behavior must change",
      "scope_change",
      conflict,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /Review failed/);
  e = await run(f.controller.get(e.issue_id));
  const d = e.decisions!.find((d) => d.status === "open")!;
  const pending = await run(
    f.controller.decision(
      e.issue_id,
      d.key,
      e.control_generation,
      SessionId.make("ses_supervisor"),
      "collect",
    ),
  );
  f.runtime.questions.set(pending.form_id!, {
    status: "answered",
    answer: "Revise the requirement to reject requests.",
  });
  await run(
    f.controller.decision(
      e.issue_id,
      d.key,
      e.control_generation,
      SessionId.make("ses_supervisor"),
      "collect",
    ),
  );
  e = await run(f.controller.control(e.issue_id, "replan", "Revise the accepted behavior"));
  assert.equal(e.plan_fingerprint, undefined);
  const path = join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md");
  await writeFile(path, `${await readFile(path, "utf8")}\nRevised behavior: reject requests.\n`);
  f.runtime.success(e.explore_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  assert.notEqual(e.plan_fingerprint, plan);
  assert.ok(
    !e.approval_receipts.some((a) => a.fingerprint === e.plan_fingerprint && a.authorized_at),
  );
  assert.equal(f.delivery.calls, 0);
});

test("legacy full-spec pass cannot archive without verification and retry returns to Review", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  let e = await reviewing(f);
  e.review_receipt = {
    passed: true,
    findings: "Legacy pass",
    session_id: e.review_session_id!,
    fingerprint: e.verification_receipt!.fingerprint,
  };
  await run(f.records.save(e));
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /Full-spec Review evidence/);
  assert.equal(f.delivery.calls, 0);
  e = await run(
    f.controller.control(e.issue_id, "retry", "Complete the missing verification evidence"),
  );
  assert.equal(e.current_phase, "verifying");
  assert.equal(e.active_role, "review");
  assert.equal(e.review_receipt, undefined);
  assert.ok(e.verification_receipt);
});
