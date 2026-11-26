import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { requireOwnedPrompt, installGuards } from "../../src/opencode/guards.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { decode } from "../../src/decode.ts";
import {
  MessageBody,
  MessageIntentSchema,
  WorkerReplySchema,
  messageRequests,
  messageHistoryError,
} from "@abracode/contracts/workflow/message-contracts";
import { assigned } from "../helpers/assigned-worker.ts";
test("a failed message preflight releases the idle worker slot", async (t) => {
  const { f, e, request } = await assigned(t);
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      capacity_reservation: undefined,
      capacity_observed_idle: true,
    })),
  );
  f.runtime.preflight = () => Effect.fail(new CrewError("PREFLIGHT_FAILED", "Missing model"));
  await assert.rejects(
    run(
      f.controller.workMessage(
        { issue_id: e.issue_id, request_id: request.id, role: "explore", body: "Review the task" },
        request.sender,
      ),
    ),
    { code: "PREFLIGHT_FAILED" },
  );
  assert.equal((await run(f.controller.get(e.issue_id))).capacity_reservation, undefined);
});

test("steering persists immutable provenance and retries without another prompt or session", async (t) => {
  const { f, e, send, request } = await assigned(t);
  const steered = await send();
  const m = messageRequests(steered.messages)[0]!;
  assert.equal(steered.prompt_id, e.prompt_id);
  assert.equal(steered.worker_context_id, e.worker_context_id);
  assert.notEqual(m.prompt_id, e.prompt_id);
  assert.equal(m.status, "admitted");
  assert.equal(m.sender_session_id, request.sender);
  assert.equal(requireOwnedPrompt(steered, m.recipient_session_id, m.prompt_id), m);
  await send();
  assert.equal(f.runtime.prompts, 2);
  assert.equal(f.runtime.creates, 1);
  await assert.rejects(send("Different instruction"), { code: "MESSAGE_REBIND" });
  const saved = await run(f.controller.get(e.issue_id));
  await assert.rejects(run(f.records.save({ ...saved, messages: [{ ...m, prompt: "Rebound" }] })), {
    code: "MESSAGE_HISTORY",
  });
  await assert.rejects(run(f.records.save({ ...saved, messages: [] })), {
    code: "MESSAGE_HISTORY",
  });
});

test("steering refuses foreign senders, wrong location and inactive assignments", async (t) => {
  const { f, e, send, request } = await assigned(t);
  await assert.rejects(
    run(
      f.controller.control(e.issue_id, "steer", "Text", {
        ...request,
        sender: Id.SessionId.make("ses_foreign"),
      }),
    ),
    { code: "ABRA_REQUIRED" },
  );
  const session = f.runtime.sessions.get(e.explore_session_id!)!;
  session.directory = Id.AbsolutePath.make("/elsewhere");
  await assert.rejects(send(), { code: "SESSION_LOCATION" });
  assert.equal(f.runtime.prompts, 1);
  session.directory = e.worktree_directory!;
  await run(f.controller.control(e.issue_id, "pause"));
  await assert.rejects(send(), { code: "STEER" });
});

test("pause cancels every owned prompt and stale generations cannot authorize steering", async (t) => {
  const { f, e, send } = await assigned(t);
  const steered = await send();
  const m = messageRequests(steered.messages)[0]!;
  for (const changed of [
    { ...steered, control_generation: steered.control_generation + 1 },
    { ...steered, prompt_id: Id.MessageId.make("msg_replaced") },
    { ...steered, current_phase: "completed" as const },
  ])
    assert.throws(() => requireOwnedPrompt(changed, m.recipient_session_id, m.prompt_id));
  assert.throws(() => requireOwnedPrompt(steered, Id.SessionId.make("ses_foreign"), m.prompt_id));
  const cancelled: Id.MessageId[] = [];
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  f.runtime.interrupt = (
    session,
    prompt?: Id.MessageId,
    additional: readonly Id.MessageId[] = [],
  ) => {
    if (prompt) cancelled.push(prompt);
    cancelled.push(...additional);
    return interrupt(session);
  };
  const paused = await run(f.controller.control(e.issue_id, "pause"));
  assert.ok(cancelled.includes(m.prompt_id));
  assert.ok(cancelled.includes(e.prompt_id!));
  assert.equal(messageRequests(paused.messages)[0]!.status, "superseded");
  assert.throws(() => requireOwnedPrompt(paused, m.recipient_session_id, m.prompt_id));
});

test("steering payload size is bounded by bytes", async () => {
  await run(decode(MessageBody, "x".repeat(8192), "message"));
  await assert.rejects(run(decode(MessageBody, "é".repeat(4097), "message")));
});

test("the native prompt hook validates exact steering payload, attachments and delivery", async (t) => {
  const { f, e, send } = await assigned(t);
  const steered = await send();
  const m = messageRequests(steered.messages)[0]!;
  let prompt: (event: any) => Effect.Effect<void> = () => Effect.void;
  const ctx = {
    session: {
      get: ({ sessionID }: { sessionID: Id.SessionId }) =>
        f.runtime
          .session(sessionID)
          .pipe(Effect.map((s) => ({ location: { directory: s.directory }, agent: s.agent }))),
      hook: (name: string, hook: typeof prompt) =>
        Effect.sync(() => {
          if (name === "prompt") prompt = hook;
        }),
    },
    permission: { hook: () => Effect.void },
    shell: { hook: () => Effect.void },
    tool: { hook: () => Effect.void },
  } as unknown as Context;
  await run(installGuards(ctx, f.controller));
  const event = {
    sessionID: m.recipient_session_id,
    messageID: m.prompt_id,
    prompt: { text: m.prompt },
    delivery: "steer",
    metadata: { source: "abracode" },
  };
  await run(prompt(event));
  for (const changed of [
    { ...event, prompt: { text: "Changed content" } },
    { ...event, delivery: "queue" },
    { ...event, prompt: { text: m.prompt, files: [{ uri: "file:///private" }] } },
    { ...event, prompt: { text: m.prompt, agents: [{ id: "foreign" }] } },
    { ...event, prompt: { text: m.prompt, skills: [{ id: "foreign" }] } },
    { ...event, messageID: Id.MessageId.make("msg_forged") },
  ]) {
    await assert.rejects(run(prompt(changed)), /Talk to Abra/);
  }
  await run(f.controller.control(e.issue_id, "pause"));
  await assert.rejects(run(prompt(event)), /Talk to Abra/);
});

test("legacy steering records preserve exact payload without synthesizing response authority", async (t) => {
  const { send } = await assigned(t);
  const current = messageRequests((await send()).messages)[0]!;
  const legacy = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) =>
        !["type", "body", "kind", "response", "source", "reply", "acknowledged_at"].includes(key),
    ),
  );
  const retained = await run(decode(MessageIntentSchema, legacy, "legacy steering"));
  assert.equal(retained.prompt, current.prompt);
  assert.equal(retained.body, undefined);
  assert.equal(retained.response, undefined);
  assert.ok(messageHistoryError([retained], [{ ...retained, response: "answer" }]));
  await assert.rejects(
    run(decode(MessageIntentSchema, { ...legacy, schema_version: 2 }, "future message")),
  );
  await assert.rejects(
    run(
      decode(
        WorkerReplySchema,
        {
          action: "answer",
          request_id: current.request_id,
          generation: current.generation,
          body: "Evidence",
          evidence: [{ path: "../secret" }],
        },
        "invalid evidence",
      ),
    ),
  );
});
