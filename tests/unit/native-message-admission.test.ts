import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { decode } from "../../src/decode.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

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
