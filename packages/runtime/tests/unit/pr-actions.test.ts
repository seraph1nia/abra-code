import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { PRActions } from "../../src/workflow/pr-actions.ts";
import { CrewError } from "../../src/domain.ts";
import { feedbackPending } from "../../src/workflow/feedback-contracts.ts";
import * as Id from "../../src/identities.ts";

async function prepared(t: { onTestFinished: (f: () => Promise<void>) => void }) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  const p = (await run(f.records.project(e.repository_id)))!;
  e.feedback = {
    schema_version: 1,
    head: e.delivered_commit!,
    pr: e.pull_request_reference!,
    target: e.target_branch!,
    observed_at: 1,
    next_check_at: 2,
    attempts: 0,
    complete: true,
    digest: "fixture",
    findings: [],
    history: [],
    actions: [],
  };
  await run(f.records.save(e));
  return { f, e, p };
}

test("lost ready response reconciles the original outbox action without another send", async (t) => {
  const { f, e, p } = await prepared(t);
  // Policy was snapshotted before admission; use the native record's manual authority here.
  let sends = 0;
  const delivery = {
    inspect: f.delivery.inspect.bind(f.delivery),
    deliver: f.delivery.deliver.bind(f.delivery),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: {
      prepare: (
        _p: typeof p,
        _e: typeof e,
        action: import("../../src/workflow/action-contracts.ts").CurrentAction,
      ) =>
        Effect.succeed({
          kind: "write" as const,
          write: { action, command: { kind: "ready" as const } },
        }),
      submit: () => {
        sends++;
        return Effect.fail(new CrewError("COMMAND_FAILED", "lost response"));
      },
      reconcile: () => Effect.succeed({ kind: "confirmed" as const, receipt: "Observed ready" }),
    },
  };
  const actions = new PRActions(f.records, delivery, f.runtime);
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "ready" as const,
  };
  const actor = Id.SessionId.make("ses_supervisor");
  await run(actions.run(e, p, input, actor));
  assert.equal(sends, 0);
  const form = e.feedback!.actions[0].form_id!;
  f.runtime.forms.set(form, "approved");
  await run(actions.run(e, p, input, actor));
  assert.equal(e.feedback!.actions[0].status, "uncertain");
  assert.equal(feedbackPending(e.feedback!), true);
  const restored = (await run(f.records.execution(e.issue_id)))!;
  await run(new PRActions(f.records, delivery, f.runtime).run(restored, p, input, actor));
  assert.equal(sends, 1);
  assert.equal(restored.feedback!.actions.length, 1);
  assert.equal(restored.feedback!.actions[0].status, "confirmed");
  assert.equal(feedbackPending(restored.feedback!), false);
});

test("action preparation rejects stale heads and unsupported evidence before any send", async (t) => {
  const { f, e } = await prepared(t);
  const actions = new PRActions(f.records, f.delivery, f.runtime);
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "ready" as const,
  };
  assert.throws(
    () => actions.prepare(e, { ...input, expected_head: Id.Commit.make("a".repeat(40)) }, false, 1),
    /generation\/head/,
  );
  assert.throws(() => actions.prepare(e, input, true, 1), /not enabled/);
  delete e.review_receipt;
  assert.throws(() => actions.prepare(e, input, false, 1), /verification/);
});

test("rerun authority uses an independent finite reservation and exact workflow", async (t) => {
  const { f, e } = await prepared(t);
  const actions = new PRActions(f.records, f.delivery, f.runtime);
  // Exercise the pure resolver without mutating the persisted policy snapshot.
  e.effective_policy = {
    ...e.effective_policy,
    ci_retry: { max_reruns: 1, workflows: [".github/workflows/ci.yml"] },
  };
  const finding = {
    id: Id.FindingId.make("check-1"),
    source_id: "run-7",
    revision: "attempt-1",
    head: e.delivered_commit!,
    kind: "check" as const,
    text: "runner unavailable",
    blocking: true,
    run_id: 7,
    run_attempt: 1,
    workflow: ".github/workflows/ci.yml",
    disposition: {
      status: "transient" as const,
      head: e.delivered_commit!,
      at: 1,
      actor: "controller",
      reason: "runner allocation failed",
    },
  };
  e.feedback = { ...e.feedback!, findings: [finding] };
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "rerun" as const,
    finding_id: finding.id,
  };
  const action = actions.prepare(e, input, true, 2);
  e.feedback = { ...e.feedback, actions: [action] };
  assert.equal(actions.prepare(e, input, true, 3).id, action.id);
  assert.equal(e.rounds?.length ?? 0, 0);
  e.feedback = {
    ...e.feedback,
    findings: [
      { ...finding, id: Id.FindingId.make("check-2"), revision: "attempt-2", run_attempt: 2 },
    ],
  };
  assert.throws(
    () => actions.prepare(e, { ...input, finding_id: Id.FindingId.make("check-2") }, true, 3),
    /budget exhausted/,
  );
  e.feedback = {
    ...e.feedback,
    findings: [{ ...finding, workflow: ".github/workflows/other.yml" }],
  };
  assert.throws(() => actions.prepare(e, input, true, 3), /not authorized/);
});

test("custom reply text requires manual approval even with verified automatic replies enabled", async (t) => {
  const { f, e } = await prepared(t);
  e.effective_policy = {
    ...e.effective_policy,
    discussion: { replies: "verified", resolve_threads: "manual" },
  };
  const finding = {
    id: Id.FindingId.make("reply-source"),
    source_id: "comment-5",
    revision: "rev-1",
    head: e.delivered_commit!,
    kind: "comment" as const,
    text: "Accepted defect",
    blocking: true,
    comment_id: 5,
    disposition: {
      status: "addressed" as const,
      head: e.delivered_commit!,
      at: 1,
      actor: "controller",
      reason: "Published verified correction",
    },
  };
  e.feedback = { ...e.feedback!, findings: [finding] };
  const actions = new PRActions(f.records, f.delivery, f.runtime);
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "reply" as const,
    finding_id: finding.id,
  };
  assert.equal(actions.prepare(e, input, false, 2).authority, "execution-policy");
  assert.equal(
    actions.prepare(e, { ...input, body: "Private context must be explicitly approved" }, false, 2)
      .authority,
    "manual",
  );
  assert.throws(
    () =>
      actions.prepare(
        e,
        { ...input, body: "Private context must be explicitly approved" },
        true,
        2,
      ),
    /content|enabled/,
  );
});

test("branch delivery retains native verification when a GitHub draft preference is present", async (t) => {
  const { applying } = await import("../fixtures.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.delivery = "branch";
  p.publication = "draft-until-verified";
  await run(f.records.saveProject(p));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "verifying");
  assert.ok(e.verification_receipt);
  assert.ok(e.review_session_id);
  assert.equal(e.provisional, undefined);
  assert.equal(f.delivery.calls, 0);
});
