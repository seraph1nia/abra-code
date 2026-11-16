import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { DateTime, Effect, Schema } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { decode } from "../../src/decode.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { responseState } from "../../src/workflow/messages.ts";
import { messageRequests } from "../../src/workflow/message-contracts.ts";
import { nativeActivity } from "../../src/visibility/supervision.ts";

test("native context with unfinished input cannot establish idle from an earlier active snapshot", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = Id.IssueId.make("native-observation-race");
  const supervisor = Id.SessionId.make("ses_supervisor");
  f.work.add(issue);
  const e = await run(f.controller.start(issue, supervisor));
  await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("original-question"),
        role: "explore",
        body: "Answer",
        response: "answer",
      },
      supervisor,
    ),
  );
  const request = messageRequests((await run(f.controller.get(issue))).messages)[0]!;
  let finished = false;
  let outcome: "succeeded" | "failed" | "interrupted" | undefined;
  let terminalAt: number | undefined;
  const native = new NativeRuntime(
    {
      session: {
        get: () =>
          Effect.succeed({
            id: e.explore_session_id,
            location: { directory: e.worktree_directory },
            outcome,
            time: { idle: terminalAt === undefined ? undefined : DateTime.makeUnsafe(terminalAt) },
          }),
        context: () =>
          decode(
            Schema.Array(SessionMessage.Info),
            [
              { type: "user", id: e.prompt_id, text: "Assignment", time: { created: 1 } },
              { type: "user", id: request.prompt_id, text: request.prompt, time: { created: 2 } },
              { type: "idle", id: "msg_original_idle", outcome: "succeeded", time: { created: 3 } },
              {
                type: "user",
                id: "msg_other_reminder",
                text: "Another retained response-only reminder",
                time: { created: 4 },
              },
              ...(finished
                ? [
                    {
                      type: "idle",
                      id: "msg_reminder_idle",
                      outcome: "succeeded",
                      time: { created: 5 },
                    },
                  ]
                : []),
            ],
            "racing native context",
          ),
      },
      storage: { get: () => Effect.void },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        active: () => Effect.succeed({}),
        inbox: { list: () => Effect.succeed([]) },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  for (outcome of [undefined, "succeeded"] as const) {
    const state = await run(native.session(e.explore_session_id!, request.prompt_id));
    assert.equal(state.busy, false);
    assert.equal(state.executing, false);
    assert.equal(state.completion_pending, true);
    assert.match(state.diagnostic_error!, /unconfirmed/);
    assert.equal(nativeActivity(state), "unknown");
    assert.equal(state.assignment?.outcome, "succeeded");
    assert.equal(responseState(request, state, "consumed"), "unavailable");
  }
  for (outcome of ["failed", "interrupted"] as const) {
    terminalAt = 3; // Last completed run predates the newly observed input.
    const unproven = await run(native.session(e.explore_session_id!, request.prompt_id));
    assert.equal(unproven.executing, false);
    assert.equal(unproven.completion_pending, true);
    assert.equal(nativeActivity(unproven), "unknown");
    terminalAt = 6; // Native stop completed even though no idle message was appended.
    const stopped = await run(native.session(e.explore_session_id!, request.prompt_id));
    assert.equal(stopped.busy, false);
    assert.equal(stopped.executing, false);
    assert.equal(stopped.outcome, outcome);
    assert.equal(responseState(request, stopped, "consumed"), outcome);
  }
  finished = true;
  outcome = "failed";
  terminalAt = 3;
  assert.equal(
    (await run(native.session(e.explore_session_id!, request.prompt_id))).outcome,
    "succeeded",
  );
  outcome = "interrupted";
  terminalAt = 6;
  assert.equal(
    (await run(native.session(e.explore_session_id!, request.prompt_id))).outcome,
    "interrupted",
  );
  terminalAt = undefined;
  outcome = undefined; // The first session read preceded the later idle marker.
  const complete = await run(native.session(e.explore_session_id!, request.prompt_id));
  assert.equal(complete.busy, false);
  assert.equal(complete.executing, false);
  assert.equal(complete.outcome, "succeeded");
  assert.equal(responseState(request, complete, "consumed"), "missing");
});

test("native stop cancels all owned queued prompts before one interrupt and preserves foreign inputs", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const session = Id.SessionId.make("ses_owned");
  const first = Id.MessageId.make("msg_assignment"),
    second = Id.MessageId.make("msg_followup");
  let pending = [first, second, Id.MessageId.make("msg_foreign")];
  const calls: string[] = [];
  const native = new NativeRuntime(
    {
      session: {
        interrupt: () =>
          Effect.sync(() => {
            assert.ok(!pending.includes(first) && !pending.includes(second));
            calls.push("interrupt");
          }),
        wait: () =>
          Effect.sync(() => {
            calls.push("wait");
          }),
      },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        inbox: {
          list: () => Effect.succeed(pending.map((id) => ({ id }))),
          cancel: ({ inboxID }: { inboxID: Id.MessageId }) =>
            Effect.sync(() => {
              calls.push(inboxID);
              pending = pending.filter((id) => id !== inboxID);
            }),
        },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  await run(native.interrupt(session, first, [first, second]));
  assert.deepEqual(calls, [first, second, "interrupt", "wait"]);
  assert.deepEqual(pending, ["msg_foreign"]);
});

test("native admission observation validates payload and keeps failed reads distinct from absence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const native = new NativeRuntime({} as Context, f.config);
  const session = Id.SessionId.make("ses_owned"),
    id = Id.MessageId.make("msg_owned");
  let inbox: unknown[] = [{ id, type: "user", payload: { text: "Owned" } }];
  let context: unknown[] = [];
  let unavailable = false;
  native.client = () =>
    Effect.succeed({
      session: {
        inbox: {
          list: () =>
            unavailable
              ? Effect.fail(new CrewError("OFFLINE", "Unavailable"))
              : Effect.succeed(inbox),
        },
        context: () => Effect.succeed(context),
        message: { get: () => Effect.fail({ _tag: "MessageNotFoundError" as const }) },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  assert.equal(await run(native.promptAdmission(session, id, "Owned")), "queued");
  await assert.rejects(run(native.promptAdmission(session, id, "Changed")), {
    code: "MESSAGE_REBIND",
  });
  inbox = [];
  context = [{ id, type: "user", text: "Owned" }];
  assert.equal(await run(native.promptAdmission(session, id, "Owned")), "consumed");
  context = [{ id, type: "user", text: "Owned", files: [{}] }];
  await assert.rejects(run(native.promptAdmission(session, id, "Owned")), {
    code: "MESSAGE_REBIND",
  });
  context = [];
  assert.equal(await run(native.promptAdmission(session, id, "Owned")), "absent");
  unavailable = true;
  await assert.rejects(run(native.promptAdmission(session, id, "Owned")), { code: "OFFLINE" });
});

test("a bounded admission batch reads inbox and context once and uses exact lookup only beyond context", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const native = new NativeRuntime({} as Context, f.config);
  const session = Id.SessionId.make("ses_batch");
  const requests = ["queued", "context", "compacted"].map((name) => ({
    prompt_id: Id.MessageId.make(`msg_${name}`),
    prompt: name,
  }));
  let inbox = 0,
    context = 0;
  const exact: string[] = [];
  native.client = () =>
    Effect.succeed({
      session: {
        inbox: {
          list: () =>
            Effect.sync(() => {
              inbox++;
              return [{ id: requests[0]!.prompt_id, type: "user", payload: { text: "queued" } }];
            }),
        },
        context: () =>
          Effect.sync(() => {
            context++;
            return [{ id: requests[1]!.prompt_id, type: "user", text: "context" }];
          }),
        message: {
          get: ({ messageID }: { messageID: string }) =>
            Effect.sync(() => {
              exact.push(messageID);
              return { id: messageID, type: "user", text: "compacted" };
            }),
        },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  assert.deepEqual(
    [...(await run(native.promptAdmissions(session, requests)))],
    requests.map((m, i) => [m.prompt_id, i === 0 ? "queued" : "consumed"]),
  );
  assert.equal(inbox, 1);
  assert.equal(context, 1);
  assert.deepEqual(exact, [requests[2]!.prompt_id]);
  assert.equal((await run(native.promptAdmissions(session, []))).size, 0);
  assert.equal(inbox, 1);
  await assert.rejects(
    run(native.promptAdmissions(session, [{ ...requests[0]!, prompt: "forged" }])),
    { code: "MESSAGE_REBIND" },
  );
});

test("native assignment outcomes remain bound across later messages and compaction", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const id = Id.SessionId.make("ses_outcomes"),
    assignment = Id.MessageId.make("msg_assignment");
  let history = await run(
    decode(
      Schema.Array(SessionMessage.Info),
      [
        { type: "user", id: assignment, text: "Assignment", time: { created: 1 } },
        {
          type: "idle",
          id: "msg_failed",
          outcome: "failed",
          error: { type: "Provider", message: "Original failed", status: 403 },
          time: { created: 2 },
        },
        { type: "user", id: "msg_followup", text: "Later input", time: { created: 3 } },
        { type: "idle", id: "msg_succeeded", outcome: "succeeded", time: { created: 4 } },
      ],
      "native history",
    ),
  );
  let compacted = false,
    reads = 0;
  const native = new NativeRuntime(
    {
      session: {
        get: () =>
          Effect.succeed({ id, location: { directory: f.config.home }, outcome: "succeeded" }),
        context: () => Effect.succeed(compacted ? history.slice(2) : history),
      },
      storage: { get: () => Effect.void },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        active: () => Effect.succeed({}),
        inbox: { list: () => Effect.succeed([]) },
      },
      message: {
        list: () =>
          Effect.sync(() => {
            reads++;
            return { data: history.toReversed(), cursor: {} };
          }),
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  const before = await run(native.session(id, assignment));
  assert.equal(before.outcome, "succeeded");
  assert.equal(before.assignment?.outcome, "failed");
  assert.equal(before.assignment?.error?.message, "Original failed");
  assert.equal(before.outcome_prompt_id, "msg_followup");
  assert.equal(reads, 0);
  compacted = true;
  assert.deepEqual((await run(native.session(id, assignment))).assignment, before.assignment);
  assert.equal(reads, 1);
  // An empty adjacent success marker does not recover a failed native turn.
  history = [history[0]!, history[1]!, history[3]!];
  const continued = await run(native.session(id, assignment));
  assert.equal(continued.assignment?.outcome, "failed");
  assert.equal(continued.assignment?.error?.message, "Original failed");
  assert.equal(continued.outcome, "failed");
});

test("compacted admission uses the exact retained input and refuses conflicting or unavailable history", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const native = new NativeRuntime({} as Context, f.config);
  const session = Id.SessionId.make("ses_compacted"),
    id = Id.MessageId.make("msg_compacted");
  let text = "Retained request";
  let unavailable = false;
  const lookups: unknown[] = [];
  native.client = () =>
    Effect.succeed({
      session: {
        inbox: { list: () => Effect.succeed([]) },
        context: () => Effect.succeed([]),
        message: {
          get: (input: unknown) =>
            Effect.suspend(() => {
              lookups.push(input);
              return unavailable
                ? Effect.fail(new CrewError("OFFLINE", "History unavailable"))
                : Effect.succeed({ id, type: "user", text });
            }),
        },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  assert.equal(await run(native.promptAdmission(session, id, text)), "consumed");
  assert.deepEqual(lookups, [{ sessionID: session, messageID: id }]);
  text = "Conflicting native content";
  await assert.rejects(run(native.promptAdmission(session, id, "Retained request")), {
    code: "MESSAGE_REBIND",
  });
  unavailable = true;
  await assert.rejects(run(native.promptAdmission(session, id, "Retained request")), {
    code: "OFFLINE",
  });
});

test("missing assignment history stays unknown after bounded server-cursor pagination", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const id = Id.SessionId.make("ses_history_bound"),
    assignment = Id.MessageId.make("msg_missing_assignment");
  const calls: unknown[] = [];
  const native = new NativeRuntime(
    {
      session: {
        get: () =>
          Effect.succeed({ id, location: { directory: f.config.home }, outcome: "succeeded" }),
        context: () => Effect.succeed([]),
      },
      storage: { get: () => Effect.void },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        active: () => Effect.succeed({}),
        inbox: { list: () => Effect.succeed([]) },
      },
      message: {
        list: (input: unknown) =>
          Effect.sync(() => {
            calls.push(input);
            return { data: [], cursor: { next: `server-cursor-${calls.length}` } };
          }),
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  const state = await run(native.session(id, assignment));
  assert.equal(calls.length, 20);
  assert.deepEqual(calls[0], { sessionID: id, limit: 200, order: "desc" });
  assert.deepEqual(calls[1], { sessionID: id, limit: 200, cursor: "server-cursor-1" });
  assert.equal(state.assignment?.id, assignment);
  assert.equal(state.assignment?.outcome, undefined);
  assert.match(state.diagnostic_error!, /outcome unavailable/);
});

test("a cancel/consume race leaves stop unconfirmed until the native worker is quiescent", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const session = Id.SessionId.make("ses_racing"),
    id = Id.MessageId.make("msg_racing");
  let interrupts = 0,
    racing = true;
  const native = new NativeRuntime(
    {
      session: {
        interrupt: () =>
          Effect.sync(() => {
            interrupts++;
          }),
        wait: () => Effect.void,
      },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        inbox: {
          list: () => Effect.succeed(racing ? [{ id }] : []),
          cancel: () =>
            Effect.fail(new CrewError("CONSUMED", "Inbox entry was consumed concurrently")),
        },
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  await assert.rejects(run(native.interrupt(session, id)), { code: "CONSUMED" });
  assert.equal(interrupts, 0);
  racing = false;
  await run(native.interrupt(session, id));
  assert.equal(interrupts, 1);
});
