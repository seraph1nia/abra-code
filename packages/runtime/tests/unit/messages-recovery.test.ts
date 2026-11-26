import { Capacity } from "../../src/workflow/capacity.ts";
import { AttentionService } from "../../src/workflow/attention.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { type Execution } from "../../src/domain.ts";
import { Messages } from "../../src/workflow/messaging/messages.ts";
import { decode } from "../../src/decode.ts";
import {
  MessageIntentSchema,
  messageRequests,
  messageHistoryError,
} from "@abracode/contracts/workflow/message-contracts";
import { assigned } from "../helpers/assigned-worker.ts";
test("resolved history skips admission reads but queued resolved input still wakes with its original identity", async (t) => {
  const { f, e, request } = await assigned(t);
  await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request.id,
        role: "explore",
        body: "Acknowledge",
        response: "acknowledgement",
      },
      request.sender,
    ),
  );
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "acknowledge",
      request_id: request.id,
      generation: e.control_generation,
    }),
  );
  const coordination = f.records.coordination;
  const service = new Messages(
    f.records,
    f.runtime,
    new Capacity(f.config, f.records),
    f.controller.queries,
    new AttentionService(f.config, f.records, f.runtime, coordination, f.locks),
  );
  const current = await run(f.controller.get(e.issue_id));
  const m = messageRequests(current.messages)[0]!;
  const state = f.runtime.sessions.get(e.explore_session_id!)!;
  state.queued_prompt_ids = [];
  let reads = 0;
  f.runtime.promptAdmission = () =>
    Effect.sync(() => {
      reads++;
      return "queued" as const;
    });
  await run(service.reconcile(current));
  assert.equal(reads, 0);
  state.queued_prompt_ids = [m.prompt_id];
  state.executing = false;
  const wakes: Id.MessageId[] = [];
  f.runtime.prompt = (_s, _t, id) =>
    Effect.sync(() => {
      wakes.push(id);
    });
  await run(service.reconcile(current));
  assert.equal(reads, 1);
  assert.deepEqual(wakes, [m.prompt_id]);
});

test("resolved message history cannot conceal independent worker failure", async (t) => {
  const { f, e, request } = await assigned(t);
  await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request.id,
        role: "explore",
        body: "Answer",
        response: "answer",
      },
      request.sender,
    ),
  );
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "answer",
      request_id: request.id,
      generation: e.control_generation,
      body: "Accepted before failure",
    }),
  );
  const state = f.runtime.sessions.get(e.explore_session_id!)!;
  state.queued_prompt_ids = [];
  state.busy = false;
  state.outcome = "failed";
  state.error = { type: "Provider", message: "Still failed", status: 403 };
  f.runtime.promptAdmission = () => {
    throw Error("Resolved admission must not be read");
  };
  await run(f.controller.reconcile(e.issue_id));
  const current = await run(f.controller.get(e.issue_id));
  assert.equal(current.current_phase, "failed");
  assert.equal(messageRequests(current.messages)[0]!.reply!.body, "Accepted before failure");
});

test("failed admission bookkeeping reconciles native evidence without resubmitting", async (t) => {
  const { f, e, request } = await assigned(t);
  const set = f.records.store.set.bind(f.records.store);
  let failed = false;
  f.records.store.set = (key, value) => {
    if (
      !failed &&
      key === `execution/${e.issue_id}` &&
      messageRequests((value as Execution).messages).some(
        (m) => m.request_id === request.id && m.status === "admitted",
      )
    ) {
      failed = true;
      return Effect.fail(new CrewError("STORE_FAILED", "Success write failed"));
    }
    return set(key, value);
  };
  const input = {
    issue_id: e.issue_id,
    request_id: request.id,
    role: "explore" as const,
    body: "One instruction",
  };
  await assert.rejects(run(f.controller.workMessage(input, request.sender)), {
    code: "STORE_FAILED",
  });
  const retained = messageRequests((await run(f.controller.get(e.issue_id))).messages)[0]!;
  assert.equal(retained.status, "admission_uncertain");
  assert.equal(f.runtime.prompts, 2);
  const retried = await run(f.controller.workMessage(input, request.sender));
  assert.equal(retried.prompt_id, retained.prompt_id);
  assert.equal(retried.status, "admitted");
  assert.equal(f.runtime.prompts, 2);
});

test("a later successful message cannot mask the original assignment's native failure", async (t) => {
  const { f, e } = await assigned(t);
  f.runtime.success(e.explore_session_id!);
  const session = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id, assignment?: Id.MessageId) =>
    session(id).pipe(
      Effect.map((state) => ({
        ...state,
        outcome_prompt_id: Id.MessageId.make("msg_later_success"),
        assignment: assignment
          ? {
              id: assignment,
              outcome: "failed" as const,
              error: { type: "Provider", message: "Original assignment failed", status: 403 },
            }
          : undefined,
      })),
    );
  await run(f.controller.reconcile(e.issue_id));
  const saved = await run(f.controller.get(e.issue_id));
  assert.equal(saved.current_phase, "failed");
  assert.equal(saved.worker_failure!.prompt_id, e.prompt_id);
  assert.match(saved.error_or_recovery_reason!, /Original assignment failed/);
});

test("a late native failure event preserves a reconciled prompt-bound failure", async (t) => {
  const { f, e, send } = await assigned(t);
  const message = messageRequests((await send()).messages)[0]!;
  const error = { type: "Provider", message: "Correlated provider failure", status: 403 };
  f.runtime.success(e.explore_session_id!);
  const session = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id) =>
    session(id).pipe(
      Effect.map((state) => ({
        ...state,
        outcome: "failed" as const,
        outcome_prompt_id: message.prompt_id,
        error,
      })),
    );
  await run(f.controller.reconcile(e.issue_id));
  const observed = (await run(f.controller.get(e.issue_id))).worker_failure;
  assert.equal(observed!.prompt_id, message.prompt_id);
  await run(f.controller.recordWorkerFailure(e.explore_session_id!, error));
  assert.deepEqual((await run(f.controller.get(e.issue_id))).worker_failure, observed);
});

test("queue wake never retries a failed or interrupted native execution", async (t) => {
  const { f, e, send } = await assigned(t);
  const sent = await send();
  const m = messageRequests(sent.messages)[0]!;
  f.runtime.promptAdmission = () => Effect.succeed("queued" as const);
  const state = f.runtime.sessions.get(e.explore_session_id!)!;
  state.executing = false;
  state.busy = true;
  const count = f.runtime.prompts;
  const wakes: Id.MessageId[] = [];
  f.runtime.prompt = (_session, _body, id) =>
    Effect.sync(() => {
      wakes.push(id);
    });
  for (const outcome of ["failed", "interrupted"] as const) {
    state.outcome = outcome;
    await run(f.controller.reconcile(e.issue_id));
    assert.equal(f.runtime.prompts, count);
    assert.equal(
      messageRequests((await run(f.controller.get(e.issue_id))).messages)[0]!.prompt_id,
      m.prompt_id,
    );
  }
  assert.deepEqual(wakes, []);
  // The native session can still expose an old paused turn's outcome while
  // the explicitly resumed assignment is queued after a service restart.
  state.outcome_prompt_id = Id.MessageId.make("msg_previous_paused_assignment");
  await run(f.controller.reconcile(e.issue_id));
  assert.deepEqual(wakes, [m.prompt_id]);
  state.outcome_prompt_id = m.prompt_id;
  await run(f.controller.reconcile(e.issue_id));
  assert.deepEqual(wakes, [m.prompt_id]);
});

test("confirmed pause of failed message work preserves its actual recovery checkpoint", async (t) => {
  const { f, e, send } = await assigned(t);
  await send();
  const current = await run(f.controller.get(e.issue_id));
  await run(
    f.records.save({
      ...current,
      current_phase: "failed",
      resume_phase: "exploring",
      error_or_recovery_reason: "Provider failed with retained message ownership",
    }),
  );
  const paused = await run(f.controller.control(e.issue_id, "pause"));
  assert.equal(paused.stop_status, "confirmed");
  assert.equal(paused.resume_phase, "exploring");
  const resumed = await run(f.controller.control(e.issue_id, "resume"));
  assert.equal(resumed.current_phase, "exploring");
  assert.equal(resumed.explore_session_id, e.explore_session_id);
  assert.notEqual(resumed.prompt_id, e.prompt_id);
  assert.equal(messageRequests(resumed.messages)[0]!.status, "superseded");
});

test("legacy request decoding adds no recovery authority and a single reservation survives reply and generation changes", async (t) => {
  const { f, e, request } = await assigned(t);
  const sent = await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request.id,
        role: "explore",
        body: "Which check applies?",
        response: "answer",
      },
      request.sender,
    ),
  );
  assert.equal(
    (await run(decode(MessageIntentSchema, sent, "legacy request"))).response_recovery,
    undefined,
  );
  const recovery = {
    prompt_id: Id.MessageId.make("msg_response_reminder"),
    prompt: `Answer original request ${sent.request_id}; do not repeat its task.`,
    created_at: Id.timestampAt(3),
    completion_id: Id.MessageId.make("msg_verified_idle"),
    completed_at: Id.timestampAt(2),
    status: "pending" as const,
  };
  const save = async (response_recovery: typeof MessageIntentSchema.Type.response_recovery) => {
    const current = await run(f.controller.get(e.issue_id));
    return run(f.records.save({ ...current, messages: [{ ...sent, response_recovery }] }));
  };
  await save(recovery);
  for (const replacement of [
    undefined,
    { ...recovery, prompt_id: Id.MessageId.make("msg_second_attempt") },
    { ...recovery, prompt: "Repeat the substantive task" },
    { ...recovery, completion_id: Id.MessageId.make("msg_other_idle") },
    { ...recovery, created_at: Id.timestampAt(4) },
    { ...recovery, completed_at: Id.timestampAt(4) },
  ])
    await assert.rejects(save(replacement), { code: "MESSAGE_HISTORY" });
  await save({ ...recovery, status: "admission_uncertain" });
  await assert.rejects(save(recovery), { code: "MESSAGE_HISTORY" });
  await assert.rejects(save({ ...recovery, status: "suppressed" }), { code: "MESSAGE_HISTORY" });
  await save({ ...recovery, status: "admitted" });
  await assert.rejects(save({ ...recovery, status: "admission_uncertain" }), {
    code: "MESSAGE_HISTORY",
  });
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "answer",
      request_id: sent.request_id,
      generation: sent.generation,
      body: "Run the documented consumer check",
    }),
  );
  const paused = await run(f.controller.control(e.issue_id, "pause"));
  const historical = messageRequests(paused.messages)[0]!;
  assert.equal(historical.status, "answered");
  assert.equal(historical.reply?.body, "Run the documented consumer check");
  assert.deepEqual(historical.response_recovery, { ...recovery, status: "admitted" });
  assert.ok(paused.control_generation > historical.generation);
});

test("a recovery reservation cannot precede admission, follow response resolution or revive suppression", async (t) => {
  const { f, e, request } = await assigned(t);
  const sent = await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request.id,
        role: "explore",
        body: "Acknowledge this finding",
        response: "acknowledgement",
      },
      request.sender,
    ),
  );
  const recovery = {
    prompt_id: Id.MessageId.make("msg_suppressed_reminder"),
    prompt: "Acknowledge the original request only",
    created_at: Id.timestampAt(3),
    completion_id: Id.MessageId.make("msg_verified_idle"),
    completed_at: Id.timestampAt(2),
    status: "pending" as const,
  };
  for (const status of [
    "pending",
    "admission_uncertain",
    "acknowledged",
    "answered",
    "cancelled",
    "superseded",
  ] as const)
    assert.match(
      messageHistoryError(
        [{ ...sent, status }],
        [{ ...sent, status, response_recovery: recovery }],
      )!,
      /admitted unresolved/,
    );
  const reserved = { ...sent, response_recovery: recovery };
  const suppressed = {
    ...reserved,
    response_recovery: { ...recovery, status: "suppressed" as const },
  };
  assert.equal(messageHistoryError([reserved], [suppressed]), undefined);
  assert.match(messageHistoryError([suppressed], [reserved])!, /cannot be reversed/);
  for (const changed of [
    { ...reserved, response: "none" },
    { ...reserved, response_recovery: { ...recovery, prompt_id: sent.prompt_id } },
    { ...reserved, response_recovery: { ...recovery, prompt_id: sent.assignment_id } },
  ])
    await assert.rejects(run(decode(MessageIntentSchema, changed, "recovery authority")));
  const escalation = {
    body: "Response unavailable; inspect the original request",
    created_at: Id.timestampAt(4),
    notice_id: Id.MessageId.make("msg_response_notice"),
  };
  const escalated = { ...sent, response_escalation: escalation };
  assert.equal(messageHistoryError([sent], [escalated]), undefined);
  for (const replacement of [
    undefined,
    { ...escalation, body: "Changed notice" },
    { ...escalation, notice_id: Id.MessageId.make("msg_other_notice") },
    { ...escalation, created_at: Id.timestampAt(5) },
  ])
    assert.match(
      messageHistoryError([escalated], [{ ...sent, response_escalation: replacement }])!,
      /escalation/,
    );
  const notified = { ...sent, response_escalation: { ...escalation, notified: true } };
  assert.equal(messageHistoryError([escalated], [notified]), undefined);
  assert.match(messageHistoryError([notified], [escalated])!, /receipt cannot be rebound/);
});
