import { existsSync } from "node:fs";
import { join } from "node:path";
import { Tool } from "@opencode/schema/tool";
// Test-only native RPC probe. Never loaded by the production configuration.
import { Plugin, Rpc, Provider, Model } from "@opencode/plugin";
const value = { type: "object" as const, additionalProperties: true };
export const probe = Rpc.define({
  id: "abracode-test",
  methods: {
    tools: { input: value, output: value },
    invoke: {
      input: value,
      output: value,
      errors: {
        action_failed: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
          additionalProperties: false,
        },
      },
    },
    storage: { input: value, output: value },
  },
  events: {},
});
export default Plugin.define({
  id: "abracode-test",
  async setup(ctx) {
    const providerID = Provider.ID.make("fixture");
    await ctx.provider.transform((editor) =>
      editor.add({
        info: {
          id: providerID,
          name: providerID,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: process.env.ABRACODE_TEST_MODEL_URL!, apiKey: "fixture" },
        },
        models: [
          Model.Info.default(providerID, Model.ID.make("gpt-fixture")),
          Model.Info.default(providerID, Model.ID.make("gpt-specialist")),
          Model.Info.default(providerID, Model.ID.make("fallback")),
        ],
      }),
    );
    await ctx.model.transform((editor) => editor.default.set("fixture", "fallback"));
    if (existsSync(join(ctx.location.directory, ".missing-worker-tool")))
      await ctx.tool.transform((editor) => editor.remove("abra_worker_wait"));
    await ctx.rpc.register(probe, {
      tools: async () => ({ tools: (await ctx.tool.list()).map((t) => ({ id: t.id })) }),
      invoke: async (input, { error }) => {
        const a = input as {
          tool: string;
          args: unknown;
          session: string;
        };
        const tool = (await ctx.tool.list()).find((t) => t.id === a.tool);
        if (!tool) throw Error("Tool missing");
        const progress: unknown[] = [];
        let result;
        try {
          result = await tool.execute(a.args, {
            sessionID: a.session,
            agent: (await ctx.session.get({ sessionID: a.session as any })).agent ?? "abra",
            messageID:
              (await ctx.session.context({ sessionID: a.session as any })).find(
                (m) => m.type === "assistant",
              )?.id ?? "test",
            id: "test",
            signal: new AbortController().signal,
            progress: async (update: unknown) => {
              progress.push(update);
            },
          } as any);
        } catch (failure) {
          if (failure instanceof Tool.Error)
            throw error("action_failed", failure.message, {
              code:
                typeof failure.metadata?.code === "string" ? failure.metadata.code : "TOOL_ERROR",
            });
          throw failure;
        }
        const content = JSON.parse(result.content as string);
        if (JSON.stringify(content) !== JSON.stringify(result.output))
          throw Error("Native structured output differs from content");
        return { ...content, probe: { output: result.output, progress } };
      },
      storage: async (input) => ({
        value:
          (await ctx.storage.get(
            (
              input as {
                key: string;
              }
            ).key,
          )) ?? null,
      }),
    });
  },
});
