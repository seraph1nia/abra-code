import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, delivered, FakeDelivery } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { type Delivery } from "../../src/git/delivery.ts";
import { type Execution, type ManagedExecution } from "../../src/domain.ts";

test("one restart retains migrated full-spec delivery authorization, decisions, research report and corrected lightweight evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.max_executions = 10;
  for (const p of await run(f.records.projects())) {
    p.max_executions = 10;
    if (p.id !== "api") p.plan_approval = false;
    if (p.id === "worker") p.repair_rounds = 1;
    await run(f.records.saveProject(p));
  }
  const adapters = new Map<string, FakeDelivery>();
  const adapter = (e: ManagedExecution) => {
    let d = adapters.get(e.issue_id);
    if (!d) {
      d = new FakeDelivery(f.git);
      adapters.set(e.issue_id, d);
    }
    return d;
  };
  let green = false;
  const delivery: Delivery = {
    deliver: (p, e) =>
      adapter(e)
        .deliver(p, e)
        .pipe(
          Effect.map((result) => {
            const pr = adapter(e).pr!;
            pr.url = Id.PullRequestUrl.make(`https://example.invalid/${e.repository_id}/pull/1`);
            return { ...result, pr: pr.url };
          }),
        ),
    inspect: (_p, e) => adapter(e).inspect(),
    merge: (_p, e) =>
      e.issue_id === "abra-1" && !green
        ? Effect.succeed({
            category: "waiting",
            code: Id.ErrorCode.make("CI_PENDING"),
            reason: "Required CI pending",
            owner: "CI",
          })
        : adapter(e).merge(),
    evidence: (p, e) => adapter(e).evidence(p, e),
  };
  const restart = () =>
    new Controller(f.config, f.records, f.work, f.spec, f.git, f.runtime, delivery, f.locks);
  f.controller = restart();
  let full = await run(delivered(f));
  const raw: Partial<typeof full> = structuredClone(full);
  delete raw.schema_version;
  delete raw.revision;
  delete raw.control_generation;
  delete raw.effective_policy;
  await run(f.records.store.set(Id.StorageKey.make(`execution/${full.issue_id}`), raw));
  const approval = await run(
    f.controller.approve(full.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in approval);
  f.runtime.forms.set(approval.form_id, "approved");
  full = (await run(
    f.controller.approve(full.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  )) as Execution;
  assert.ok(full.delivery_wait);
  assert.ok(
    await run(
      f.records.store.get(Id.StorageKey.make(`legacy-original/execution/${full.issue_id}`)),
    ),
  );
  const research = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("frontend"),
          title: "Research persistence",
          description: "Retain the investigation",
          workflow_policy: "research-only",
          scope: {
            goal: "Identify ownership",
            acceptance: ["Report owners"],
            constraints: ["Read only"],
          },
          request_id: Id.RequestId.make("combined-research"),
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    )
  ).issue;
  let r = await run(f.controller.start(research.id));
  await run(
    f.controller.researchReport(r.research_session_id!, {
      report_id: Id.ReportId.make("owners"),
      generation: 0,
      conclusions: "SQLite owns issues.",
      findings: [
        {
          finding: "The graph owns claims",
          evidence: [{ base: r.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 }],
        },
      ],
      acceptance: [{ criterion: "Report owners", met: true, evidence: "Inspected owning code" }],
      limitations: [],
    }),
  );
  f.runtime.success(r.research_session_id!);
  r = await run(f.controller.advance(r.issue_id));
  assert.equal(r.current_phase, "completed");
  const light = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("worker"),
          title: "Small fix",
          description: "Apply report recommendation",
          workflow_policy: "lightweight-fix",
          scope: { goal: "Correct source", acceptance: ["Source corrected"], constraints: [] },
          request_id: Id.RequestId.make("combined-light"),
          report_reference: {
            issue_id: r.issue_id,
            report_id: r.report_receipt!.report_id,
            hash: r.report_receipt!.hash,
          },
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    )
  ).issue;
  let l = await run(f.controller.start(light.id));
  await run(
    f.controller.workerQuestion(l.apply_session_id!, {
      key: Id.ObligationKey.make("detail"),
      generation: 0,
      scope: "Acceptance",
      question: "Which detail?",
      owner: "supervisor",
    }),
  );
  await run(f.controller.workerProgress(l.apply_session_id!, 0, "Inspected source"));
  await run(
    f.controller.decision(
      l.issue_id,
      Id.ObligationKey.make("detail"),
      0,
      Id.SessionId.make("ses_supervisor"),
      "answer",
      "Use the retained contract",
    ),
  );
  f.runtime.success(l.apply_session_id!);
  l = await run(f.controller.advance(l.issue_id));
  await run(
    f.controller.reviewReport(
      l.review_session_id!,
      false,
      "Fix the accepted edge case",
      "in_scope",
    ),
  );
  f.runtime.success(l.review_session_id!);
  l = await run(f.controller.advance(l.issue_id));
  assert.equal(l.rounds!.length, 1);
  await writeFile(join(l.worktree_directory!, "source.txt"), "corrected\n");
  f.runtime.success(l.apply_session_id!);
  l = await run(f.controller.advance(l.issue_id));
  await run(
    f.controller.reviewReport(l.review_session_id!, true, "Corrected scope verified independently"),
  );
  f.runtime.success(l.review_session_id!);
  l = await run(f.controller.advance(l.issue_id));
  const prompts = f.runtime.prompts,
    ids = [full.explore_session_id, l.apply_session_id, l.review_session_id, r.research_session_id];
  f.controller = restart();
  assert.equal(
    (await run(f.controller.get(l.issue_id))).decisions![0].answer,
    "Use the retained contract",
  );
  assert.match(await run(f.controller.queries.report(r.issue_id)), /SQLite owns issues/);
  const clock = await run(TestClock.make());
  await run(clock.setTime(full.delivery_wait!.next_check_at));
  green = true;
  full = (
    await run(f.controller.reconcile(full.issue_id).pipe(Effect.provideService(Clock.Clock, clock)))
  )[0];
  assert.equal(full.current_phase, "completed");
  assert.equal(full.approval_receipts.at(-1)!.form_id, approval.form_id);
  const merge = await run(
    f.controller.approve(l.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in merge);
  f.runtime.forms.set(merge.form_id, "approved");
  l = (await run(
    f.controller.approve(l.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  )) as Execution;
  assert.equal(l.current_phase, "completed");
  assert.deepEqual(
    [full.explore_session_id, l.apply_session_id, l.review_session_id, r.research_session_id],
    ids,
  );
  assert.equal(f.runtime.prompts, prompts);
  assert.equal(l.rounds!.length, 1);
  assert.equal(f.runtime.trees.length, 0);
});
