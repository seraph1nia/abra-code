import { verifiedSpec, failedSpec } from "../helpers/spec-review.ts";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, applying, delivered, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Controller } from "../../src/workflow/controller.ts";
const budget = async (f: Awaited<ReturnType<typeof newFixture>>, n: number) => {
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.repair_rounds = n;
  await run(f.records.saveProject(p));
};
const newFixture = () => run(fixture);

test("enabled check correction consumes one immutable round, reruns checks and independent Review; exhaustion retains a decision", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.verification = [
    [
      "node",
      "-e",
      "if(require('fs').readFileSync('source.txt','utf8')!=='fixed\\n') process.exit(1)",
    ],
  ];
  await run(f.records.saveProject(p));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "applying");
  assert.equal(e.rounds!.length, 1);
  assert.equal(e.verification_receipt, undefined);
  await writeFile(join(e.worktree_directory!, "source.txt"), "fixed\n");
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "verifying");
  assert.ok(e.verification_receipt);
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "Another in-scope edge case",
      "in_scope",
      failedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /Review failed/);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.rounds!.length, 1);
  assert.match(e.decisions!.find((d) => d.status === "open")!.question, /budget exhausted/);
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
  await run(c.reconcile(e.issue_id));
  assert.equal((await run(c.get(e.issue_id))).rounds!.length, 1);
  const altered = structuredClone(e);
  altered.rounds = [];
  await assert.rejects(run(f.records.save(altered)), /history/);
});

test("uncertain review findings require a decision, while a scoped correction succeeds with fresh checks and Review", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      false,
      "Maybe redesign storage",
      "uncertain",
      failedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /Review failed/);
  assert.equal((await run(f.controller.get(e.issue_id))).rounds, undefined);
  assert.match((await run(f.controller.get(e.issue_id))).decisions![0].question, /clarification/);
});

test("full-spec postarchive correction creates a new planning cycle, preserves archive and PR, and rejects stale merge authorization", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  let e = await run(delivered(f));
  const oldHead = e.delivered_commit!,
    oldArchive = e.archive_path!,
    oldChange = e.openspec_change;
  const archive = await readFile(join(e.worktree_directory!, oldArchive, "proposal.md"), "utf8");
  const pending = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in pending);
  await assert.rejects(
    run(
      f.controller.correct({
        issue_id: e.issue_id,
        expected_head: Id.Commit.make("a".repeat(40)),
        finding_ids: [Id.FindingId.make("review-finding")],
        scope: "in_scope",
        instructions: "Fix scoped edge case",
      }),
    ),
    /head/,
  );
  e = await run(
    f.controller.correct({
      issue_id: e.issue_id,
      expected_head: oldHead,
      finding_ids: [Id.FindingId.make("review-finding")],
      scope: "in_scope",
      instructions: "Fix scoped edge case",
    }),
  );
  assert.equal(e.current_phase, "planning");
  assert.notEqual(e.openspec_change, oldChange);
  assert.equal(e.pull_request_reference, pending.execution.pull_request_reference);
  assert.equal(e.delivered_commit, undefined);
  assert.equal(
    await readFile(join(e.worktree_directory!, oldArchive, "proposal.md"), "utf8"),
    archive,
  );
  f.runtime.success(e.explore_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  const plan = await run(
    f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in plan);
  f.runtime.forms.set(plan.form_id, "approved");
  e = (await run(
    f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  )) as typeof e;
  await writeFile(join(e.worktree_directory!, "source.txt"), "corrected\n");
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      true,
      "Correction checked independently",
      undefined,
      verifiedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_merge");
  assert.notEqual(e.delivered_commit, oldHead);
  assert.notEqual(e.archive_path, oldArchive);
  assert.equal(e.rounds![0].archive_path, oldArchive);
  f.runtime.forms.set(pending.form_id, "approved");
  const merge = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in merge);
  assert.notEqual(merge.form_id, pending.form_id);
  assert.equal(
    await readFile(join(e.worktree_directory!, oldArchive, "proposal.md"), "utf8"),
    archive,
  );
});

test("prior archives cannot be modified by a corrective Apply", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  let e = await run(delivered(f));
  const oldArchive = e.archive_path!;
  e = await run(
    f.controller.correct({
      issue_id: e.issue_id,
      expected_head: e.delivered_commit!,
      finding_ids: [Id.FindingId.make("review-finding")],
      scope: "in_scope",
      instructions: "Fix scoped edge case",
    }),
  );
  await writeFile(join(e.worktree_directory!, oldArchive, "proposal.md"), "Rewritten history");
  f.runtime.success(e.explore_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /immutable/);
});

test("correction decisions merge atomically with newer native observations", async (t) => {
  const { Corrections } = await import("../../src/workflow/corrections.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      progress: {
        schema_version: 1,
        generation: current.control_generation,
        session_id: current.explore_session_id!,
        at: 123,
        summary: "newer native progress",
        source: "native",
      },
    })),
  );
  await run(new Corrections(f.records, f.git, f.config).decision(e, "Correction budget exhausted"));
  const saved = await run(f.controller.get(e.issue_id));
  assert.equal(saved.progress?.summary, "newer native progress");
  assert.equal(
    saved.decisions?.find((d) => d.status === "open")?.question,
    "Correction budget exhausted",
  );
});

test("a lost corrective prompt response retries one reserved round and native admission", async (t) => {
  const { Effect } = await import("effect");
  const { CrewError } = await import("../../src/domain.ts");
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  let e = await run(delivered(f));
  const input = {
    issue_id: e.issue_id,
    expected_head: e.delivered_commit!,
    finding_ids: [Id.FindingId.make("review-finding")],
    scope: "in_scope" as const,
    instructions: "Fix accepted edge case",
  };
  const prompt = f.runtime.prompt.bind(f.runtime);
  let lose = true;
  f.runtime.prompt = (...args) =>
    prompt(...args).pipe(
      Effect.flatMap(() => {
        if (lose) {
          lose = false;
          return Effect.fail(new CrewError("RESPONSE_LOST", "Lost corrective launch response"));
        }
        return Effect.void;
      }),
    );
  const before = f.runtime.prompts;
  await assert.rejects(run(f.controller.correct(input)), /Lost corrective/);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.rounds!.length, 1);
  const message = e.prompt_id;
  e = await run(f.controller.correct(input));
  assert.equal(e.rounds!.length, 1);
  assert.equal(e.prompt_id, message);
  assert.equal(f.runtime.prompts, before + 1);
});

test("manual posture suppresses new automatic repair without erasing the captured budget", async (t) => {
  const f = await newFixture();
  t.onTestFinished(() => run(f.close()));
  await budget(f, 1);
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.verification = [["node", "-e", "process.exit(1)"]];
  await run(f.records.saveProject(p));
  const e = await run(applying(f));
  assert.equal(e.effective_policy.repair_rounds, 1);
  f.config.supervision_mode = "manual";
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)));
  const stopped = await run(f.controller.get(e.issue_id));
  assert.equal(stopped.effective_policy.repair_rounds, 1);
  assert.equal(stopped.rounds, undefined);
  assert.match(stopped.decisions!.find((d) => d.status === "open")!.question, /budget exhausted/);
  assert.equal(stopped.apply_session_id, e.apply_session_id);
});
