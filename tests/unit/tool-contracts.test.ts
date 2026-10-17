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
});
