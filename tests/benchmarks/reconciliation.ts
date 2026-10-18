import { Effect, Schema } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { decode } from "../../src/decode.ts";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import type { Context } from "@opencode/plugin/effect/plugin";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { NativeRuntime, type Runtime } from "../../src/opencode/runtime.ts";
import { messageRequests } from "../../src/workflow/message-contracts.ts";
import type { Messages } from "../../src/workflow/messages.ts";

// Opt-in fixture benchmark. The real native adapter runs against counted public
// API stubs; these numbers are API invocation counts, not network latency.
const f = await run(fixture);
try {
  const issue = Id.IssueId.make("reconciliation-benchmark");
  const supervisor = Id.SessionId.make("ses_benchmark");
  f.work.add(issue);
  await run(f.controller.start(issue, supervisor));
  await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("benchmark"),
        role: "explore",
        body: "Answer",
        response: "answer",
      },
      supervisor,
    ),
  );
  const base = await run(f.controller.get(issue));
  const original = messageRequests(base.messages)[0]!;
  const service = (f.controller as unknown as { workflow: { messages: Messages } }).workflow
    .messages;
  let counts: Record<string, number> = {};
  const counted = <A>(name: string, action: () => A) =>
    Effect.sync(() => {
      counts[name] = (counts[name] ?? 0) + 1;
      return action();
    });
  type Input = { type: "user"; id: string; text: string; time: { created: number } };
  type Idle = { type: "idle"; id: string; outcome: "succeeded"; time: { created: number } };
  let context: Array<Input | Idle> = [];
  const nativeContext = () =>
    counted("context", () => context).pipe(
      Effect.flatMap((value) =>
        decode(Schema.Array(SessionMessage.Info), value, "benchmark native context"),
      ),
    );
  const native = new NativeRuntime(
    {
      session: {
        get: () =>
          counted("session_get", () => ({
            id: base.explore_session_id,
            agent: "explore",
            location: { directory: base.worktree_directory },
            outcome: "succeeded",
          })),
        context: nativeContext,
      },
      storage: { get: () => counted("native_storage_get", () => undefined) },
    } as unknown as Context,
    f.config,
  );
  native.client = () =>
    Effect.succeed({
      session: {
        active: () => counted("active", () => ({})),
        inbox: { list: () => counted("inbox", () => []) },
        context: nativeContext,
        message: {
          get: ({ messageID }: { messageID: string }) =>
            counted("exact_message", () => context.find((m) => m.id === messageID)),
        },
      },
      message: {
        list: () => counted("history", () => ({ data: context.toReversed(), cursor: {} })),
      },
    } as unknown as Effect.Success<ReturnType<typeof native.client>>);
  const runtime = Object.create(f.runtime) as Runtime;
  runtime.session = native.session;
  runtime.promptAdmission = native.promptAdmission;
  runtime.promptAdmissions = native.promptAdmissions;
  const prompt = f.runtime.prompt.bind(f.runtime);
  runtime.prompt = (session, text, id) =>
    counted("prompt", () => {
      context.push({ type: "user", id, text, time: { created: 3 } });
    }).pipe(Effect.andThen(prompt(session, text, id)));
  Object.assign(service, { runtime });
  const store = f.records.store;
  const get = store.get.bind(store),
    set = store.set.bind(store),
    entries = store.entries.bind(store);
  store.get = (key) => counted("storage_get", () => undefined).pipe(Effect.andThen(get(key)));
  store.set = (key, value) =>
    counted("storage_set", () => undefined).pipe(Effect.andThen(set(key, value)));
  store.entries = (prefix) =>
    counted("storage_entries", () => undefined).pipe(Effect.andThen(entries(prefix)));
  const rows = [];
  for (const n of [1, 10, 25, 100, 200]) {
    for (const distribution of [
      "answered",
      "acknowledged",
      "terminal_one_pending",
      "admission_uncertain",
      "unanswered",
      "mixed_generations",
      "superseded",
    ]) {
      const samples = [];
      for (let rep = 0; rep < 6; rep++) {
        const e = structuredClone(base);
        e.control_generation = 2;
        e.messages = Array.from({ length: n }, (_, i) => {
          let status: typeof original.status = "answered";
          if (distribution === "acknowledged") status = "acknowledged";
          if (distribution === "terminal_one_pending" && i === n - 1) status = "pending";
          if (distribution === "admission_uncertain" && i < Math.min(3, n))
            status = "admission_uncertain";
          if (distribution === "unanswered" && i < Math.min(3, n)) status = "admitted";
          if (distribution === "superseded") status = "superseded";
          const m = {
            ...original,
            request_id: Id.RequestId.make(`benchmark-${i}`),
            prompt_id: Id.MessageId.make(`msg_benchmark${i}`),
            generation: distribution === "mixed_generations" && i % 2 === 0 ? 1 : 2,
            status,
            response:
              distribution === "acknowledged" ? ("acknowledgement" as const) : ("answer" as const),
            ...(["answered", "acknowledged"].includes(status)
              ? { acknowledged_at: original.created_at }
              : {}),
            ...(status === "answered"
              ? { reply: { body: "Fixture answer", evidence: [], at: original.created_at } }
              : {}),
          };
          f.runtime.admissions.add(m.prompt_id);
          return m;
        });
        context = [
          { type: "user", id: e.prompt_id!, text: "Assignment", time: { created: 1 } },
          ...messageRequests(e.messages)
            .filter((m) => m.status !== "pending")
            .map((m) => ({
              type: "user" as const,
              id: m.prompt_id,
              text: m.prompt,
              time: { created: 1 },
            })),
          { type: "idle", id: "msg_benchmarkidle", outcome: "succeeded", time: { created: 2 } },
        ];
        (store as unknown as { values: Map<string, unknown> }).values.set(
          `execution/${issue}`,
          structuredClone(e),
        );
        counts = {};
        const memory = process.memoryUsage();
        const start = performance.now();
        await run(service.reconcile(e));
        // Observe assignment execution independently of communication history.
        await run(runtime.session(e.explore_session_id!, e.prompt_id));
        const elapsed = performance.now() - start;
        const after = process.memoryUsage();
        if (rep)
          samples.push({
            ms: elapsed,
            heap_delta: after.heapUsed - memory.heapUsed,
            rss: after.rss,
            calls: { ...counts },
          });
      }
      rows.push({
        n,
        distribution,
        samples,
        mean_ms: samples.reduce((sum, s) => sum + s.ms, 0) / samples.length,
        max_ms: Math.max(...samples.map((s) => s.ms)),
      });
      for (const sample of samples)
        assert.deepEqual(sample.calls, samples[0]!.calls, "API counts must repeat across samples");
    }
  }
  process.stdout.write(
    JSON.stringify(
      {
        schema_version: 1,
        observed_at: new Date().toISOString(),
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "",
        warmup: 1,
        samples: 5,
        rows,
        limitations: [
          "Counted public API stubs with the real NativeRuntime; no network/provider latency",
          "Memory samples include GC noise and shared process overhead",
          "Controller coordination and scheduler contention are not exercised by this Messages-only benchmark; their delay/occupancy is unavailable here",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await run(f.close());
}
