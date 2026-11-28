import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import type { Runtime } from "../../src/opencode/runtime.ts";
import { currentReview, readerPrompt } from "../../src/workflow/proposal-review-contracts.ts";
import { assignmentDecisions } from "../../src/workflow/worker-context.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

const supervisor = Id.SessionId.make("ses_supervisor");
type Fixture = Effect.Success<typeof fixture>;
async function start(f: Fixture, approval = false) {
  const repository_id = Id.RepositoryId.make("api");
  const project = (await run(f.records.project(repository_id)))!;
  await run(f.records.saveProject({ ...project, plan_approval: approval }));
  const { issue } = await run(
    f.controller.createWork(
      {
        repository_id,
        title: "Selected plan",
        description: "Author-only private rationale",
        proposal_review: "user",
      },
      supervisor,
    ),
  );
  const e = await run(f.controller.start(issue.id, supervisor));
  f.spec.planned = true;
  f.runtime.success(e.explore_session_id!);
  return run(f.controller.advance(issue.id));
}
function reader(f: Fixture, findings: unknown[] = []) {
  const rt: Runtime = f.runtime;
  rt.ensureProposalReader = (e, r) =>
    Effect.sync(() => {
      if (!f.runtime.sessions.has(r.session))
        f.runtime.sessions.set(r.session, {
          id: r.session,
          directory: e.worktree_directory!,
          busy: false,
        });
    });
  rt.readProposalReport = () =>
    Effect.succeed(JSON.stringify({ reading: "Deliver a sample response.", findings }));
}
function finishReader(f: Fixture, r: NonNullable<ReturnType<typeof currentReview>>) {
  const s = f.runtime.sessions.get(r.session)!;
  s.busy = false;
  s.assignment = { id: r.prompt, outcome: "succeeded" };
}

test("a clean reading is bound to the admitted proposal and leaves ordinary approval pending", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  reader(f);
  const prompts = new Map<string, string>();
  const original = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (id, text, msg) => {
    prompts.set(id, text);
    return original(id, text, msg);
  };
  let e = await start(f, true);
  const a = currentReview(e)!;
  const source = await readFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md"),
    "utf8",
  );
  assert.equal(a.proposal, source);
  assert.equal(prompts.get(a.session), readerPrompt(a));
  assert.doesNotMatch(prompts.get(a.session)!, /Author-only|applicable answers|recovery feedback/i);
  assert.notEqual(a.session, e.explore_session_id);
  finishReader(f, a);
  [e] = (await run(f.controller.reconcile(e.issue_id))) as [typeof e];
  assert.deepEqual(currentReview(e)?.report, {
    reading: "Deliver a sample response.",
    findings: [],
  });
  assert.equal(e.current_phase, "awaiting_plan_approval");
  assert.equal(
    e.approval_receipts.some((r) => r.authorized_at),
    false,
  );
  assert.equal(e.apply_session_id, undefined);
});

test("editorial feedback reaches the planner and optional approval waits for the human answer", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  reader(f, [
    { owner: "planner", question: "Define sample.", evidence: "Proposal uses sample twice." },
    {
      owner: "human",
      question: "Include previews?",
      evidence: "Acceptance only describes final responses.",
    },
  ]);
  const notices = new Map<string, string>();
  f.runtime.notify = (id, text) =>
    Effect.sync(() => {
      notices.set(id, text);
    });
  let e = await start(f);
  finishReader(f, currentReview(e)!);
  e = (await run(f.controller.reconcile(e.issue_id)))[0]!;
  assert.match(notices.get(e.explore_session_id!)!, /Define sample/);
  const d = e.decisions!.at(-1)!;
  assert.equal(d.owner, "user");
  assert.equal((await run(f.controller.advance(e.issue_id))).apply_session_id, undefined);
  const form = await run(
    f.controller.decision(e.issue_id, d.key, d.generation, supervisor, "collect"),
  );
  f.runtime.questions.set(form.form_id!, { status: "answered", answer: "Final responses only" });
  e = (await run(f.controller.reconcile(e.issue_id)))[0]!;
  assert.equal(e.current_phase, "applying");
  assert.equal(e.approval_receipts.length, 0);
  const resumed = { ...e, control_generation: e.control_generation + 1 };
  assert.ok(
    assignmentDecisions(resumed).some(
      (answer) => answer.answer === "Final responses only" && answer.basis === "reviewed_plan",
    ),
  );
  assert.equal(
    assignmentDecisions({ ...resumed, plan_fingerprint: Id.Fingerprint.make("f".repeat(64)) })
      .length,
    0,
  );
});

test.for(["Retry review", "Continue without review"])(
  "unavailable review requires explicit %s and preserves approval",
  async (choice, t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    let e = await start(f, true);
    const a = currentReview(e)!;
    assert.equal(a.status, "unavailable");
    const d = e.decisions!.at(-1)!;
    assert.equal((await run(f.controller.advance(e.issue_id))).apply_session_id, undefined);
    const form = await run(
      f.controller.decision(e.issue_id, d.key, d.generation, supervisor, "collect"),
    );
    f.runtime.questions.set(form.form_id!, {
      status: "answered",
      answer: JSON.stringify([{ question: d.choices![0]!.question, answer: choice }]),
    });
    reader(f);
    e = (await run(f.controller.reconcile(e.issue_id)))[0]!;
    if (choice === "Retry review") {
      assert.equal(currentReview(e)?.attempt, 2);
      await run(f.controller.reconcile(e.issue_id));
      finishReader(f, currentReview(e)!);
      e = (await run(f.controller.reconcile(e.issue_id)))[0]!;
      assert.equal(currentReview(e)?.status, "completed");
    } else assert.equal(currentReview(e)?.status, "continued");
    assert.equal(e.current_phase, "awaiting_plan_approval");
    assert.equal(e.approval_receipts.length, 1);
    assert.equal(e.apply_session_id, undefined);
  },
);

test("a lost submission acknowledgment reuses its admission, and a tasks-only revision supersedes it", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  reader(f);
  const original = f.runtime.prompt.bind(f.runtime);
  f.runtime.prompt = (id, text, msg) =>
    original(id, text, msg).pipe(
      Effect.andThen(
        id.startsWith("ses_proposal_")
          ? Effect.fail(new CrewError("CONNECTION", "Lost acknowledgment"))
          : Effect.void,
      ),
    );
  let e = await start(f, true);
  const a = currentReview(e)!;
  const count = f.runtime.prompts;
  await run(f.controller.reconcile(e.issue_id));
  assert.equal(f.runtime.prompts, count);
  e = await run(
    f.controller.control(e.issue_id, "replan", "Change only acceptance checks", {
      id: Id.RequestId.make("tasks-only"),
      sender: supervisor,
    }),
  );
  await appendFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "tasks.md"),
    "\n- [ ] Verify the response.\n",
  );
  f.runtime.success(e.explore_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  const b = currentReview(e)!;
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(a.proposal, b.proposal);
  assert.notEqual(a.session, b.session);
  finishReader(f, a);
  e = (await run(f.controller.reconcile(e.issue_id)))[0]!;
  assert.equal(currentReview(e)?.status, "pending");
  assert.equal(e.apply_session_id, undefined);
  e = await run(
    f.controller.control(e.issue_id, "replan", "Clarify the second draft", {
      id: Id.RequestId.make("third-draft"),
      sender: supervisor,
    }),
  );
  assert.equal(e.current_phase, "planning");
});
