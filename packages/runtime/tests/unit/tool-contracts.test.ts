import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { Tool } from "@opencode/schema/tool";
import { Agent } from "@opencode/schema/agent";
import { SessionMessage } from "@opencode/schema/session-message";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import { defineTool, strictInput } from "../../src/opencode/tool-definition.ts";
import { progress } from "../../src/opencode/progress.ts";
import { SessionId } from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { toolOutputs } from "../../src/opencode/tool-contracts.ts";
import { deliveryAction } from "../../src/workflow/delivery-outcome.ts";
import { ExecutionBusy } from "../../src/workflow/operations.ts";
import { IssueId } from "../../src/identities.ts";

test("native finish output preserves unexecuted busy observations and genuine failed actions", async () => {
  const registered: Tool.Info[] = [];
  const editor: ToolEditor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    remove: () => {},
    update: () => {},
    add: (tool) => {
      registered.push(tool);
    },
  };
  const id = IssueId.make("busy-ticket");
  const reads = {
    execution: () => Effect.fail(new CrewError("READ", "Unavailable")),
    issue: () => Effect.fail(new CrewError("READ", "Unavailable")),
  };
  defineTool({
    name: "work_finish",
    description: "Observe acquisition contention",
    input: Schema.Struct({}),
    output: toolOutputs.work_finish,
    run: () => deliveryAction(reads, id, "finish", Effect.fail(new ExecutionBusy(id))),
  }).register(
    editor,
    () => Effect.void,
    (effect) => effect,
  );
  const context: Tool.Context = {
    sessionID: SessionId.make("ses_supervisor"),
    agent: Agent.ID.make("abra"),
    messageID: SessionMessage.ID.make("msg_busy"),
    id: Tool.CallID.make("busy"),
    progress: () => Effect.void,
  };
  const result = await run(registered[0].execute({}, context));
  assert.deepEqual(JSON.parse(result.content as string), result.output);
  const output = result.output as {
    ok: boolean;
    result: { category: string; performed: boolean; outcome?: unknown };
  };
  assert.equal(output.ok, true);
  assert.equal(output.result.category, "operation_in_progress");
  assert.equal(output.result.performed, false);
  assert.equal(output.result.outcome, undefined);
});

test("native tool registration validates outputs, reports bounded progress and preserves native error causes", async () => {
  defineTool({
    name: "type-contract",
    description: "Compile-time result correspondence",
    input: Schema.Struct({}),
    output: Schema.Struct({ count: Schema.Int }),
    // @ts-expect-error A handler cannot widen its advertised result schema.
    run: () => Effect.succeed({ missing: true }),
  });
  const registered: Tool.Info[] = [];
  const editor: ToolEditor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    remove: () => {},
    update: () => {},
    add: (tool) => {
      registered.push(tool);
    },
  };
  let calls = 0;
  defineTool({
    name: "example",
    description: "Example",
    input: Schema.Struct({ mode: Schema.Literals(["ok", "error", "defect"]) }),
    output: Schema.Struct({ count: Schema.Int }),
    run: ({ mode }) =>
      Effect.gen(function* () {
        calls++;
        if (mode === "error") return yield* new CrewError("EXPECTED", "Bearer private-token");
        if (mode === "defect") return yield* Effect.die(new Error("bug"));
        yield* progress({ stage: "verify", status: "started", completed: 0, total: 1 });
        return { count: 1 };
      }),
  }).register(
    editor,
    () => Effect.void,
    (effect) => effect,
  );
  const tool = registered[0];
  const updates: unknown[] = [];
  const context: Tool.Context = {
    sessionID: SessionId.make("session"),
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.make("msg_test"),
    id: Tool.CallID.make("call"),
    progress: (update) =>
      Effect.sync(() => {
        updates.push(update);
      }),
  };
  const input = strictInput(Schema.Struct({ mode: Schema.String }));
  assert.ok("issues" in input["~standard"].validate({ mode: "ok", extra: true }));
  assert.equal(calls, 0);
  const result = await run(tool.execute({ mode: "ok" }, context));
  assert.deepEqual(result.output, { ok: true, result: { count: 1 } });
  assert.equal(result.content, JSON.stringify(result.output));
  assert.deepEqual(updates, [{ stage: "verify", status: "started", completed: 0, total: 1 }]);
  const undeliverable = await run(
    tool.execute(
      { mode: "ok" },
      { ...context, progress: () => Effect.die(new Error("Display unavailable")) },
    ),
  );
  assert.deepEqual(undeliverable.output, { ok: true, result: { count: 1 } });
  const cancelled = await run(
    Effect.exit(tool.execute({ mode: "ok" }, { ...context, progress: () => Effect.interrupt })),
  );
  assert.equal(cancelled._tag, "Failure");
  if (cancelled._tag === "Failure") assert.equal(cancelled.cause.reasons[0]._tag, "Interrupt");
  const failure = await run(Effect.exit(tool.execute({ mode: "error" }, context)));
  assert.equal(failure._tag, "Failure");
  if (failure._tag === "Failure") {
    assert.equal(failure.cause.reasons[0]._tag, "Fail");
    const reason = failure.cause.reasons[0];
    if (reason._tag === "Fail") {
      assert.ok(reason.error instanceof Tool.Error);
      assert.equal(reason.error.metadata?.code, "EXPECTED");
      assert.doesNotMatch(reason.error.message, /private-token/);
    }
  }
  const defect = await run(Effect.exit(tool.execute({ mode: "defect" }, context)));
  if (defect._tag === "Failure") assert.equal(defect.cause.reasons[0]._tag, "Die");

  let handlerInvocations = 0;
  defineTool({
    name: "blocked",
    description: "Authorization must precede handler invocation",
    input: Schema.Struct({ action: Schema.Literals(["status", "apply"]) }),
    output: Schema.Struct({ count: Schema.Int }),
    diagnostic: ({ action }) => action === "status",
    run: () => {
      handlerInvocations++;
      return Effect.succeed({ count: 1 });
    },
  }).register(
    editor,
    (access) =>
      access.diagnostic
        ? Effect.void
        : Effect.fail(new CrewError("ATTENTION_AUTHORITY", "Blocked before the handler")),
    (effect) => effect,
  );
  const blocked = registered[1];
  await assert.rejects(run(blocked.execute({ action: "apply" }, context)), /Blocked before/);
  assert.equal(handlerInvocations, 0);
  await run(blocked.execute({ action: "status" }, context));
  assert.equal(handlerInvocations, 1);
});
