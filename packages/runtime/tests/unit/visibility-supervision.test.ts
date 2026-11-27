import { Schema } from "effect";
import { workBriefing } from "../../src/visibility/briefing.ts";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";

import { fixture, planned } from "../fixtures.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility } from "../../src/visibility/protocol.ts";
test("observer joins WorkGraph, blockers and role sessions without advancing a waiting plan", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  f.seed.named(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"), [e.issue_id]);
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const snapshot = await run(view.snapshot());
  const active = snapshot.work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(active.issue_status, "in_progress");
  assert.equal(active.phase, "awaiting_plan_approval");
  assert.deepEqual(active.sessions, [{ id: e.explore_session_id, role: "explore" }]);
  assert.match(snapshot.work.find((w) => w.issue_id === "abra-2")!.blockers.join(" "), /abra-1/);
  const detail = await run(view.detail(e.issue_id));
  assert.equal(detail.change, e.openspec_change);
  assert.equal(detail.progress?.complete, 0);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.runtime.forms.size, 1);
  assert.ok(Schema.is(visibility.methods.snapshot.output)(snapshot));
  assert.ok(Schema.is(visibility.methods.detail.output)(detail));
});

test("older closed issue detail preserves communication counts outside the loaded history page", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(planned(f));
  const at = Id.Timestamp.make("2026-10-01T00:00:00.000Z");
  const request = {
    schema_version: 1 as const,
    assignment_id: e.prompt_id!,
    generation: e.control_generation,
    sender_session_id: e.supervisor_session_id!,
    recipient_session_id: e.explore_session_id!,
    role: "explore" as const,
    prompt: "Retained historical question",
    delivery: "queue" as const,
    response: "answer" as const,
    created_at: at,
    acknowledged_at: at,
  };
  e = {
    ...e,
    messages: [
      {
        ...request,
        request_id: Id.RequestId.make("answered"),
        prompt_id: Id.MessageId.make("msg_answered"),
        status: "answered",
        reply: { body: "Retained answer", at, evidence: [] },
      },
      {
        ...request,
        request_id: Id.RequestId.make("awaiting-answer"),
        prompt_id: Id.MessageId.make("msg_awaiting"),
        status: "acknowledged",
      },
      {
        ...request,
        request_id: Id.RequestId.make("acknowledged"),
        prompt_id: Id.MessageId.make("msg_acknowledged"),
        response: "acknowledgement",
        status: "acknowledged",
      },
    ],
  };
  e = { ...e, current_phase: "completed" };
  e = { ...e, delivered_commit: await run(f.git.head(e.worktree_directory!)) };
  e = { ...e, delivery_receipt: { commit: e.delivered_commit!, target: e.target_branch!, at } };
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  const lookup = (search: string) =>
    run(
      f.controller.queries.discoverEvidence({
        kind: "communication",
        issue_id: e.issue_id,
        search,
      }),
    );
  const answered = (await lookup("Retained answer")).entries;
  assert.equal(answered.length, 1);
  assert.equal(answered[0].issue_id, e.issue_id);
  assert.ok(answered[0].identity.startsWith("answered/"));
  assert.equal((await lookup("Retained historical question")).entries.length, 3);
  const retained = (await run(f.records.execution(e.issue_id)))!;
  const newer = Array.from({ length: 51 }, (_, n) => {
    const id = Id.IssueId.make(`newer-closed-${n}`);
    f.seed.named(id);
    f.seed.close(id);
    return { ...retained, issue_id: id, messages: undefined };
  });
  const empty = Id.IssueId.make("closed-without-execution");
  f.seed.named(empty);
  f.seed.close(empty);
  const bundle = await run(f.controller.queries.observe());
  // Supply retained completion timestamps through the existing read-model seam;
  // no additional native workers or worktrees are needed for historical rows.
  bundle.executions = [{ ...retained, updated_at: at }, ...newer];
  f.controller.queries.observe = () => Effect.succeed(bundle);
  f.runtime.session = () => {
    throw Error("Closed history must not inspect native sessions");
  };
  f.runtime.promptAdmissions = () => {
    throw Error("Summary must not inspect message admissions");
  };
  const view = new Visibility(f.controller);
  const firstPage = await run(view.snapshot());
  const attention = firstPage.fleet?.attention.find(
    (item) => item.issue_id === e.issue_id && item.key === "communication",
  );
  assert.equal(attention?.owner, "request recipient");
  assert.match(attention?.next_action ?? "", /response-recovery/);
  assert.equal(
    firstPage.work.some((item) => item.issue_id === e.issue_id),
    false,
  );
  const before = await run(f.records.export);
  const effects = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  assert.equal(
    (await run(view.snapshot())).work.some((w) => w.issue_id === e.issue_id),
    false,
  );
  const visible = (await run(view.snapshot(1))).work.find((w) => w.issue_id === e.issue_id)!;
  const detail = await run(view.detail(e.issue_id));
  assert.deepEqual(detail.work.communication, {
    total: 3,
    outstanding: 1,
    first: { offset: 1, request_id: "awaiting-answer" },
  });
  assert.deepEqual(detail.work.communication, visible.communication);
  assert.deepEqual((await run(view.detail(empty))).work.communication, {
    total: 0,
    outstanding: 0,
  });
  const selected = await run(f.controller.queries.observeTask(e.issue_id));
  const observeTask = f.controller.queries.observeTask.bind(f.controller.queries);
  f.controller.queries.observeTask = (id) =>
    id === e.issue_id
      ? Effect.succeed({ ...selected, execution: { ...selected.execution!, messages: undefined } })
      : observeTask(id);
  assert.deepEqual((await run(view.detail(e.issue_id))).work.communication, {
    total: 0,
    outstanding: 0,
  });
  assert.deepEqual(await run(f.records.export), before);
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    effects,
  );
  assert.ok(Schema.is(visibility.methods.detail.output)(detail));
});

test("bounded supervision projection preserves record history and exposes read-only report access", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(planned(f));
  e = {
    ...e,
    decisions: Array.from({ length: 25 }, (_, i) => ({
      schema_version: 1,
      key: Id.ObligationKey.make(`question-${i}`),
      generation: 0,
      scope: "Implementation",
      question: `Question ${i}`,
      owner: "user",
      session_id: e.explore_session_id!,
      opened_at: i,
      status: "open",
    })),
  };
  e = {
    ...e,
    progress: {
      schema_version: 1,
      generation: 0,
      session_id: e.explore_session_id!,
      at: 30,
      summary: "Meaningful progress",
      source: "worker",
    },
  };
  await run(f.records.save(e));
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const item = (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(item.decisions!.length, 20);
  assert.equal(item.decision_count, 25);
  assert.equal(item.progress!.summary, "Meaningful progress");
  assert.ok(item.policy_summary);
  assert.ok(item.operation);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.deepEqual(Object.keys(visibility.methods).sort(), [
    "binding",
    "detail",
    "diff",
    "document",
    "evidence",
    "evidenceSearch",
    "feedback",
    "find",
    "githubInbox",
    "githubItem",
    "leads",
    "messages",
    "overview",
    "report",
    "sessions",
    "snapshot",
    "thoughtDetail",
    "thoughtList",
    "thoughtWork",
    "verification",
    "worker",
  ]);
});

test("briefing finds off-page obligations and gated work even when the inbox is unavailable", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f, Id.IssueId.make("zz-plan")));
  const pending = await run(
    f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")),
  );
  const dependent = Id.IssueId.make("a-dependent");
  f.seed.named(dependent, undefined, [e.issue_id]);
  for (let i = 0; i < 55; i++) f.seed.named(Id.IssueId.make("filler-" + i));
  const captured = await run(f.records.executions);
  const issues = await run(f.work.list);
  const inbox = vi
    .spyOn(f.controller.inbox, "list")
    .mockReturnValue(Effect.fail(new CrewError("INBOX_ACCESS", "fixture offline")));
  t.onTestFinished(() => inbox.mockRestore());
  const read = () => run(workBriefing(f.controller));
  const first = await read();
  const second = await read();
  assert.equal(first.decisions.total, 1);
  assert.equal(
    first.decisions.entries[0]?.form_id,
    "form_id" in pending ? pending.form_id : undefined,
  );
  assert.match(first.decisions.entries[0]!.fact, /Blocks a-dependent/);
  assert.equal(second.decisions.entries[0]?.source, first.decisions.entries[0]?.source);
  assert.equal(first.queue.entries.length, 10);
  assert.equal(first.queue.total, 56);
  assert.match(first.queue.entries.find((r) => r.issue_id === dependent)!.fact, /zz-plan/);
  assert.match(first.limitations.join(" "), /GitHub inbox unavailable/);
  assert.deepEqual(await run(f.records.executions), captured);
  assert.deepEqual(await run(f.work.list), issues);
});

test("a controller CI wait and a PR URL alone carry no human action", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const empty = await run(workBriefing(f.controller));
  assert.deepEqual(empty.limitations, []);
  const scoped = await run(
    workBriefing(f.controller, { repository_id: Id.RepositoryId.make("api") }),
  );
  assert.deepEqual(scoped.limitations, []);
  assert.equal(empty.decisions.total, 0);
  let e = await run(planned(f));
  const head = Id.Commit.make("a".repeat(40));
  e = { ...e, current_phase: "awaiting_merge" };
  e = { ...e, delivered_commit: head };
  e = { ...e, pull_request_reference: Id.PullRequestUrl.make("https://example.invalid/test/pr/1") };
  e = {
    ...e,
    delivery_wait: {
      category: "waiting",
      code: Id.ErrorCode.make("CI_PENDING"),
      reason: "CI is still running",
      owner: "controller",
      fingerprint: head,
      attempts: 1,
      observed_at: 1,
      next_check_at: 1000,
    },
  };
  await run(f.records.save(e));
  const brief = await run(workBriefing(f.controller));
  assert.equal(brief.decisions.total, 0);
  assert.match(brief.ongoing.entries[0]!.fact, /CI is still running/);
});
