import { deliveryOutcome } from "../../src/workflow/delivery-outcome.ts";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { CrewError, type Policy } from "../../src/domain.ts";
const scope = {
  goal: "Understand persistence boundaries",
  acceptance: ["Identify the owner and evidence"],
  constraints: ["Do not change code"],
};
const setup = async (policy: Policy, approval = false) => {
  const f = await run(fixture);
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.openspec = false;
  p.plan_approval = approval;
  if (policy === "research-only") p.verification = [];
  await run(f.records.saveProject(p));
  const issue = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("api"),
          title: "Scoped work",
          description: "Inspect persistence",
          workflow_policy: policy,
          scope,
          request_id: Id.RequestId.make("scoped-request"),
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    )
  ).issue;
  return { f, issue };
};
const report = (generation: number, base: Id.Commit) => ({
  report_id: Id.ReportId.make("findings"),
  generation,
  conclusions: "SQLite owns issue state; native records own execution relationships.",
  findings: [
    {
      finding: "Issue claims are transactional",
      evidence: [{ base, path: Id.RelativePath.make("source.txt"), line: 1 }],
    },
  ],
  acceptance: [
    { criterion: scope.acceptance[0], met: true, evidence: "Inspected the owning graph interface" },
  ],
  limitations: ["No external production state was inspected"],
});

test("research runs without OpenSpec/checks and retains a hashed report and sessions after native retirement/restart", async (t) => {
  const { f, issue } = await setup("research-only");
  t.onTestFinished(() => run(f.close()));
  f.spec.create = () =>
    Effect.fail(new CrewError("UNEXPECTED_SPEC", "Research must not create OpenSpec"));
  const e = await run(f.controller.start(issue.id));
  assert.equal(e.current_phase, "researching");
  assert.ok(e.research_session_id);
  assert.equal(e.explore_session_id, undefined);
  const receipt = await run(
    f.controller.researchReport(e.research_session_id!, report(0, e.base_commit!)),
  );
  assert.ok(receipt.path.startsWith(join(f.config.home, ".abracode/reports", issue.id)));
  assert.deepEqual(
    await run(f.controller.researchReport(e.research_session_id!, report(0, e.base_commit!))),
    receipt,
  );
  await assert.rejects(
    run(
      f.controller.researchReport(e.research_session_id!, {
        ...report(0, e.base_commit!),
        conclusions: "Different report",
      }),
    ),
    /different|immutable/,
  );
  f.runtime.success(e.research_session_id!);
  const done = await run(f.controller.advance(issue.id));
  assert.equal(done.current_phase, "completed");
  const outcome = deliveryOutcome(done, "closed", 100);
  assert.equal(outcome.delivery.kind, "report");
  assert.equal(outcome.delivery.state, "verified");
  assert.equal(outcome.approval.kind, "plan");
  assert.equal(f.delivery.calls, 0);
  assert.equal(done.pull_request_reference, undefined);
  assert.equal(done.delivery_receipt, undefined);
  await assert.rejects(access(e.worktree_directory!));
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
  assert.match(await run(c.queries.report(issue.id)), /SQLite owns/);
  const detail = await run(new Visibility(c).detail(issue.id));
  assert.equal(detail.progress, undefined);
  assert.equal(detail.change, undefined);
  assert.equal(detail.work.report!.hash, receipt.hash);
  const follow = (
    await run(
      c.createWork(
        {
          repository_id: Id.RepositoryId.make("api"),
          title: "Implement recommendation",
          description: "Explicit implementation request",
          workflow_policy: "lightweight-fix",
          scope: { ...scope, constraints: [] },
          request_id: Id.RequestId.make("follow-on"),
          report_reference: {
            issue_id: issue.id,
            report_id: receipt.report_id,
            hash: receipt.hash,
          },
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    )
  ).issue;
  assert.deepEqual(follow.dependencies, [issue.id]);
  assert.equal((await run(c.queries.executions())).length, 1);
  assert.equal(await readFile(receipt.path, "utf8"), await run(c.queries.report(issue.id)));
});

test("research scope requires its own approval and missing/tampered reports or changed bases prevent closure", async (t) => {
  const { f, issue } = await setup("research-only", true);
  t.onTestFinished(() => run(f.close()));
  const e = await run(f.controller.start(issue.id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  assert.equal(f.runtime.creates, 0);
  const approval = await run(
    f.controller.approve(issue.id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in approval);
  f.runtime.forms.set(approval.form_id, "approved");
  const active = await run(
    f.controller.approve(issue.id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("current_phase" in active);
  assert.equal(active.current_phase, "researching");
  await assert.rejects(
    run(f.controller.researchReport(Id.SessionId.make("ses_foreign"), report(0, e.base_commit!))),
    /Research/,
  );
  const receipt = await run(
    f.controller.researchReport(active.research_session_id!, report(0, e.base_commit!)),
  );
  f.runtime.success(active.research_session_id!);
  await writeFile(receipt.path, "Tampered");
  await assert.rejects(run(f.controller.advance(issue.id)), /hash/);
  assert.equal((await run(f.work.show(issue.id))).status, "blocked");
  await access(e.worktree_directory!);
});

test("native research success without a report stays blocked; source mutations cannot be reported as preserved research", async (t) => {
  const { f, issue } = await setup("research-only");
  t.onTestFinished(() => run(f.close()));
  const e = await run(f.controller.start(issue.id));
  await writeFile(join(e.worktree_directory!, "source.txt"), "Changed");
  await assert.rejects(
    run(f.controller.researchReport(e.research_session_id!, report(0, e.base_commit!))),
    /unchanged/,
  );
  await writeFile(join(e.worktree_directory!, "source.txt"), "original\n");
  f.runtime.success(e.research_session_id!);
  await assert.rejects(run(f.controller.advance(issue.id)), /report/);
  assert.equal((await run(f.work.show(issue.id))).status, "blocked");
});

test("incomplete scoped work creates a durable clarification before any worker; explicit scope revision invalidates stale approval", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.openspec = false;
  await run(f.records.saveProject(p));
  const issue = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("api"),
          title: "Small fix",
          description: "Clarify acceptance",
          workflow_policy: "lightweight-fix",
          request_id: Id.RequestId.make("clarification"),
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    )
  ).issue;
  let e = await run(f.controller.start(issue.id));
  assert.equal(e.current_phase, "planning");
  assert.equal(f.runtime.creates, 0);
  assert.equal(e.decisions![0].owner, "user");
  e = await run(f.controller.reviseScope(issue.id, { ...scope, constraints: [] }));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  const pending = await run(
    f.controller.approve(issue.id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in pending);
  const old = e.plan_fingerprint;
  e = await run(
    f.controller.reviseScope(issue.id, { ...scope, goal: "Revised goal", constraints: [] }),
  );
  assert.notEqual(e.plan_fingerprint, old);
  f.runtime.forms.set(pending.form_id, "approved");
  const revised = await run(
    f.controller.approve(issue.id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in revised);
  assert.notEqual(revised.form_id, pending.form_id);
  assert.equal(f.runtime.creates, 0);
});

test("lightweight uses short scope, checks and independent Review with no OpenSpec archive", async (t) => {
  const { f, issue } = await setup("lightweight-fix");
  t.onTestFinished(() => run(f.close()));
  f.spec.implemented = () =>
    Effect.fail(new CrewError("UNEXPECTED_SPEC", "No fictional OpenSpec tasks"));
  let e = await run(f.controller.start(issue.id));
  assert.equal(e.current_phase, "applying");
  await writeFile(join(e.worktree_directory!, "source.txt"), "Corrected\n");
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(issue.id));
  assert.equal(e.current_phase, "verifying");
  assert.ok(e.verification_receipt);
  assert.ok(e.review_session_id);
  await run(
    f.controller.reviewReport(e.review_session_id!, true, "Acceptance checked independently"),
  );
  f.runtime.success(e.review_session_id!);
  e = await run(f.controller.advance(issue.id));
  assert.equal(e.current_phase, "awaiting_merge");
  assert.equal(e.archive_path, undefined);
  const pending = await run(
    f.controller.approve(issue.id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in pending);
  f.runtime.forms.set(pending.form_id, "approved");
  const approved = await run(
    f.controller.approve(issue.id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("current_phase" in approved);
  assert.equal(approved.current_phase, "awaiting_merge");
  assert.equal(f.delivery.merged, false);
  const done = (await run(f.controller.reconcile(issue.id)))[0];
  assert.equal(done.current_phase, "completed");
  assert.ok(done.delivery_receipt);
  assert.equal(f.delivery.calls, 1);
});

test("uncertain report publication reconciles the existing bytes rather than replacing the immutable report", async (t) => {
  const { f, issue } = await setup("research-only");
  t.onTestFinished(() => run(f.close()));
  const e = await run(f.controller.start(issue.id));
  const receipt = await run(
    f.controller.researchReport(e.research_session_id!, report(0, e.base_commit!)),
  );
  const current = await run(f.controller.get(issue.id));
  delete current.report_receipt;
  await run(f.records.save(current));
  f.runtime.success(e.research_session_id!);
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
  const done = (await run(c.reconcile(issue.id)))[0];
  assert.equal(done.current_phase, "completed");
  assert.equal(done.report_receipt!.hash, receipt.hash);
  assert.equal(done.report_receipt!.path, receipt.path);
});

test("research scope revision retains the original report, releases idle compute and requires a new report identity", async (t) => {
  const { f, issue } = await setup("research-only");
  t.onTestFinished(() => run(f.close()));
  let e = await run(f.controller.start(issue.id));
  const first = await run(
    f.controller.researchReport(e.research_session_id!, {
      ...report(0, e.base_commit!),
      acceptance: [
        { criterion: scope.acceptance[0], met: false, evidence: "Needs a clarified contract" },
      ],
    }),
  );
  const original = await readFile(first.path, "utf8");
  f.runtime.success(e.research_session_id!);
  e = await run(f.controller.reviseScope(issue.id, { ...scope, goal: "Clarified investigation" }));
  assert.equal(e.capacity_reservation, undefined);
  assert.equal(e.report_history![0].hash, first.hash);
  e = (await run(f.controller.reconcile(issue.id)))[0];
  assert.equal(e.current_phase, "researching");
  const next = await run(
    f.controller.researchReport(e.research_session_id!, {
      ...report(1, e.base_commit!),
      report_id: Id.ReportId.make("revised-findings"),
    }),
  );
  assert.notEqual(next.path, first.path);
  assert.equal(await readFile(first.path, "utf8"), original);
  f.runtime.success(e.research_session_id!);
  assert.equal((await run(f.controller.advance(issue.id))).current_phase, "completed");
});

test("scope revision cannot resume an intentionally paused worker", async (t) => {
  const { f, issue } = await setup("research-only");
  t.onTestFinished(() => run(f.close()));
  await run(f.controller.start(issue.id));
  await run(f.controller.control(issue.id, "pause"));
  const prompts = f.runtime.prompts;
  await assert.rejects(run(f.controller.reviseScope(issue.id, scope)), /Resume paused/);
  assert.equal((await run(f.controller.get(issue.id))).current_phase, "interrupted");
  assert.equal(f.runtime.prompts, prompts);
});
