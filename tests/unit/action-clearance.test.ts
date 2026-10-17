import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { deliveredPR, noEffect } from "../helpers/delivered-pr.ts";
import { run } from "../effects.ts";
import { forgeFixture } from "../forge.ts";
import * as Id from "../../src/identities.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { GitHubDelivery, type Delivery } from "../../src/git/delivery.ts";
import { CrewError } from "../../src/domain.ts";
import { actionPlan } from "../../src/workflow/action-plan.ts";
import { prepareAction } from "../../src/workflow/action-policy.ts";

for (const automaticReplies of [true, false])
  test(`every controller merge route accounts for absent required actions: replies ${automaticReplies}`, async (t) => {
    const { f, e, p } = await deliveredPR(t, {
      discussion: { replies: automaticReplies ? "verified" : "manual", resolve_threads: "manual" },
    });
    f.delivery.pr!.statusCheckRollup = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
    const forge = forgeFixture(p, () => f.delivery.pr);
    forge.config.comments = [
      {
        id: 2,
        body: "Preserve empty input",
        html_url: e.pull_request_reference,
        updated_at: "2026-10-16T00:00:00Z",
        user: { login: "reviewer" },
      },
    ];
    const github = new GitHubDelivery(f.git, forge.runner, Id.Executable.make("fake-forge"));
    e.feedback = await run(github.feedback(p, e));
    e.feedback = {
      ...e.feedback,
      findings: e.feedback.findings.map((finding) => ({
        ...finding,
        disposition: {
          status: "addressed",
          head: e.delivered_commit!,
          at: 1,
          actor: "controller",
          reason: "Published correction passed verification and Review",
        },
      })),
    };
    await run(f.records.save(e));
    const delivery: Delivery = {
      deliver: f.delivery.deliver,
      inspect: github.inspect,
      assessment: github.assessment,
      feedback: github.feedback,
      merge: github.merge,
      evidence: f.delivery.evidence.bind(f.delivery),
      actions: {
        prepare: () =>
          Effect.fail(new CrewError("COMMAND_FAILED", "Read-only source temporarily unavailable")),
        submit: noEffect,
        reconcile: noEffect,
      },
    };
    forge.config.onMerge = () => {
      f.delivery.merged = true;
      f.delivery.pr!.state = "MERGED";
    };
    const c = new Controller(
      f.config,
      f.records,
      f.work,
      f.spec,
      f.git,
      f.runtime,
      delivery,
      f.locks,
    );
    t.onTestFinished(() => run(c.close()));
    const pending = await run(c.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")));
    assert.ok("form_id" in pending);
    f.runtime.forms.set(pending.form_id, "approved");
    const before = forge.calls.filter((a) => a[1].includes("/check-runs")).length;
    await run(c.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")));
    assert.equal(
      forge.calls.filter((a) => a[1].includes("/check-runs")).length,
      before,
      "Approval does not execute merge preflight",
    );
    const current = await run(c.finish(e.issue_id));
    assert.equal(
      forge.calls.filter((a) => a[1].includes("/check-runs")).length - before,
      1,
      "Clearance and merge share one canonical observation",
    );
    assert.equal(
      forge.calls.some((a) => a[0] === "pr" && a[1] === "merge"),
      !automaticReplies,
    );
    assert.ok(
      current.approval_receipts.some(
        (a) => a.form_id === pending.form_id && a.authorized_at !== undefined,
      ),
    );
    if (automaticReplies) {
      assert.equal(current.current_phase, "awaiting_merge");
      assert.equal(current.feedback!.actions.length, 0, "Absent outbox work still blocks merge");
      assert.match(current.delivery_wait!.reason, /Required GitHub reply/);
      await run(c.finish(e.issue_id));
      const clock = await run(TestClock.make());
      await run(clock.setTime(current.delivery_wait!.next_check_at + 31000));
      await run(c.reconcile(e.issue_id).pipe(Effect.provideService(Clock.Clock, clock)));
      const after = await run(c.get(e.issue_id));
      assert.equal(after.current_phase, "awaiting_merge");
      assert.equal(after.feedback!.actions[0].status, "prepared");
      assert.equal(
        forge.calls.some((a) => a[0] === "pr" && a[1] === "merge"),
        false,
      );
      assert.ok(
        after.approval_receipts.some(
          (a) => a.form_id === pending.form_id && a.authorized_at !== undefined,
        ),
      );
    } else
      assert.equal(
        current.current_phase,
        "completed",
        "Manual discussion defaults add no new automatic obligation",
      );
  });

test("reply and resolution obligations retain dependency, rejection and new-thread objections", async (t) => {
  const { f, e } = await deliveredPR(t, {
    discussion: { replies: "verified", resolve_threads: "addressed" },
  });
  const finding = {
    id: Id.FindingId.make("thread-source"),
    source_id: "thread-1",
    revision: "r1",
    head: e.delivered_commit!,
    kind: "thread" as const,
    text: "Accepted defect",
    thread_id: "thread-1",
    comment_id: 7,
    blocking: true,
    disposition: {
      status: "addressed" as const,
      head: e.delivered_commit!,
      at: 1,
      actor: "controller",
      reason: "Published verified correction",
    },
  };
  e.feedback = { ...e.feedback!, findings: [finding] };
  const pr = f.delivery.pr!;
  const initial = actionPlan(e, pr, 2);
  assert.equal(initial.pending, true);
  assert.equal(
    initial.required.find((r) => r.input.kind === "resolve")!.blocker?.code,
    "REPLY_UNCONFIRMED",
  );
  const reply = prepareAction(
    e,
    {
      issue_id: e.issue_id,
      generation: 0,
      expected_head: e.delivered_commit!,
      kind: "reply",
      finding_id: finding.id,
    },
    true,
    2,
  );
  e.feedback = {
    ...e.feedback,
    actions: [{ ...reply, status: "rejected", result: "Human rejected" }],
  };
  assert.equal(actionPlan(e, pr, 3).pending, true);
  e.feedback = {
    ...e.feedback,
    actions: [
      {
        ...reply,
        status: "confirmed",
        result: "Reply receipt",
        submission: { stage: "confirmed", receipt: "Reply receipt", at: 3 },
      },
    ],
  };
  const resolving = actionPlan(e, pr, 4);
  assert.ok(resolving.required.find((r) => r.input.kind === "resolve")!.action);
  e.feedback = {
    ...e.feedback,
    findings: [
      ...e.feedback.findings,
      {
        ...finding,
        id: Id.FindingId.make("new-objection"),
        revision: "r2",
        disposition: undefined,
      },
    ],
  };
  const changed = actionPlan(e, pr, 5);
  assert.equal(changed.pending, true);
  assert.equal(
    changed.required.find((r) => r.input.kind === "resolve")!.blocker?.code,
    "THREAD_CHANGED",
  );
});

test("edited or removed sources supersede only unsubmitted obligations and retain possible effects", async (t) => {
  const { f, e } = await deliveredPR(t, {
    discussion: { replies: "verified", resolve_threads: "manual" },
  });
  const finding = {
    id: Id.FindingId.make("edited"),
    source_id: "comment-7",
    revision: "r1",
    head: e.delivered_commit!,
    kind: "comment" as const,
    text: "Original request",
    blocking: true,
    disposition: {
      status: "addressed" as const,
      head: e.delivered_commit!,
      at: 1,
      actor: "controller",
      reason: "Published verified fix",
    },
  };
  e.feedback = { ...e.feedback!, findings: [finding] };
  const reply = prepareAction(
    e,
    {
      issue_id: e.issue_id,
      generation: 0,
      expected_head: e.delivered_commit!,
      kind: "reply",
      finding_id: finding.id,
    },
    true,
    2,
  );
  e.feedback = {
    ...e.feedback,
    actions: [reply],
    findings: [{ ...finding, revision: "r2", disposition: undefined }],
  };
  const edited = actionPlan(e, f.delivery.pr!, 3);
  assert.deepEqual(
    edited.stale.map((a) => a.id),
    [reply.id],
  );
  assert.equal(
    edited.pending,
    false,
    "The action planner clears stale unsent work; finding assessment remains a separate gate",
  );
  e.feedback = {
    ...e.feedback,
    actions: [{ ...reply, status: "uncertain", submission: { stage: "admitted", at: 2 } }],
  };
  const uncertain = actionPlan(e, f.delivery.pr!, 4);
  assert.equal(uncertain.stale.length, 0);
  assert.equal(uncertain.pending, true, "Source edits cannot erase a possible public effect");
  e.feedback = { ...e.feedback, findings: [] };
  assert.equal(actionPlan(e, f.delivery.pr!, 5).pending, true);
});
