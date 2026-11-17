import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { AbsolutePath } from "@opencode/client/effect";
import { Plugin } from "@opencode/schema/plugin";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { awaitPluginActivation } from "../../src/opencode/plugin-activation.ts";
import { CrewError } from "../../src/domain.ts";

const home = "/fixture/abracode";
const failed: Plugin.Info = {
  source: { type: "local", path: `${home}/.opencode/plugins/abracode` },
  features: { server: true },
  state: { status: "failed", error: "Plugin failed to load", ref: "err_import" },
};
const active: Plugin.Info = {
  source: failed.source,
  features: failed.features,
  id: Plugin.ID.make("abracode"),
  state: { status: "active" },
};

test("an import failure without a plugin ID fails immediately with native diagnostics and recovery", async () => {
  let reads = 0;
  await assert.rejects(
    Effect.runPromise(
      awaitPluginActivation(
        {
          plugin: {
            list: () =>
              Effect.sync(() => {
                reads++;
                return { location: { directory: AbsolutePath.make(home) }, data: [failed] };
              }),
          },
        },
        home,
      ).pipe(Effect.provide(TestClock.layer())),
    ),
    (error) => {
      assert.ok(error instanceof CrewError);
      assert.equal(error.code, "PLUGIN_ACTIVATION");
      assert.match(error.message, /Plugin failed to load.*err_import/);
      assert.match(error.message, /pnpm service:restart/);
      return true;
    },
  );
  assert.equal(reads, 1);
});

test("cold activation waits for AbraCode and ignores unrelated plugin failures", async () => {
  let reads = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* awaitPluginActivation(
        {
          plugin: {
            list: () =>
              Effect.sync(() => ({
                location: { directory: AbsolutePath.make(home) },
                data:
                  ++reads === 1
                    ? [
                        {
                          features: failed.features,
                          state: failed.state,
                          source: { type: "local", path: "/unrelated/plugin" },
                        },
                      ]
                    : [active],
              })),
          },
        },
        home,
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.equal(reads, 2);
});

test("unsettled activation keeps a bounded timeout and gives restart guidance", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* awaitPluginActivation(
        {
          plugin: {
            list: () =>
              Effect.succeed({ location: { directory: AbsolutePath.make(home) }, data: [] }),
          },
        },
        home,
      ).pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("15 seconds");
      const result = yield* Fiber.join(fiber);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.ok(result.failure instanceof CrewError);
        assert.match(result.failure.message, /within 15 seconds.*pnpm service:restart/);
      }
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
