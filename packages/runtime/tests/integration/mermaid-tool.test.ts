import { goal as workGoal } from "../helpers/work-goal.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import { Tool } from "@opencode/schema/tool";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { mermaidVerifierTool } from "../../src/opencode/diagram-tool.ts";
import { strictInput } from "../../src/opencode/tool-definition.ts";
import { DiagramVerifyInputSchema } from "@abracode/contracts/presentation/diagrams";
import { captureReportSnapshot } from "../../src/workflow/report-snapshot.ts";

test(
  "registered verifier permits current assigned custom agents without publication or lifecycle effects",
  { timeout: 60000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const agent = Agent.ID.make("diagram-specialist");
    f.config.workers.explore = { agent };
    const { id: issue } = await run(f.work.create(workGoal("diagram-verifier")));
    const e = await run(f.controller.start(issue, Id.SessionId.make("ses_diagram-parent")));
    let tool: Tool.Info | undefined;
    const editor: ToolEditor = {
      list: () => [],
      get: () => undefined,
      namespace: () => {},
      remove: () => {},
      update: () => {},
      add: (value) => {
        tool = value;
      },
    };
    mermaidVerifierTool(f.controller, false).register(
      editor,
      () => Effect.void,
      (effect) => effect,
    );
    const context: Tool.Context = {
      sessionID: e.explore_session_id!,
      agent,
      messageID: Id.MessageId.make("msg_verify-assistant"),
      id: Tool.CallID.make("verify"),
      progress: () => Effect.void,
    };
    const before = await run(f.controller.get(issue)),
      prompts = f.runtime.prompts;
    const result = await run(
      tool!.execute(
        {
          diagrams: [
            { id: "valid", source: "flowchart LR\nA <--> B" },
            { id: "invalid", source: "flowchart LR\nA -->" },
          ],
        },
        context,
      ),
    );
    const decoded = Schema.decodeUnknownSync(
      Schema.Struct({
        ok: Schema.Literal(true),
        result: Schema.Struct({
          verified: Schema.Boolean,
          results: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
        }),
      }),
    )(result.output);
    assert.equal(decoded.result.verified, false);
    assert.deepEqual(
      decoded.result.results.map((v) => v.status),
      ["verified", "syntax"],
    );
    assert.deepEqual(await run(f.controller.get(issue)), before);
    assert.equal(f.runtime.prompts, prompts);
    assert.doesNotMatch(JSON.stringify(result.output), /<svg/);
    await run(
      f.records.store.set(Id.StorageKey.make(`execution/${issue}`), {
        ...before,
        control_generation: before.control_generation + 1,
      }),
    );
    await assert.rejects(
      run(tool!.execute({ diagrams: [{ id: "valid", source: "flowchart LR\nA --> B" }] }, context)),
    );

    const diagrams = Array.from({ length: 32 }, (_, i) => ({
      title: `Diagram ${i}`,
      source: `flowchart LR\nA --> B${i}`,
    }));
    assert.deepEqual(
      (await run(captureReportSnapshot(f.work, e, undefined, undefined, diagrams))).diagrams,
      diagrams,
    );
    assert.deepEqual(
      (await run(captureReportSnapshot(f.work, e, undefined, undefined, []))).diagrams,
      [],
    );
  },
);

test("verifier rejects file execution inputs but classifies literal unsafe source diagnostically", () => {
  const input = strictInput(DiagramVerifyInputSchema)["~standard"];
  for (const value of [
    { diagrams: [{ id: "x", source: "flowchart LR\nA --> B", path: "/etc/passwd" }] },
    { diagrams: [{ id: "x", source: "flowchart LR\nA --> B" }], config: {} },
    { diagrams: [{ id: "x", source: { path: "/tmp/file" } }] },
  ])
    assert.ok("issues" in input.validate(value));
  assert.ok(
    "value" in
      input.validate({ diagrams: [{ id: "x", source: "%%{init: {}}%%\nflowchart LR\nA --> B" }] }),
  );
});
