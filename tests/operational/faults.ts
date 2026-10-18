import { Effect, Stream } from "effect";
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Runtime } from "../../src/opencode/runtime.ts";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Records } from "../../src/storage/store.ts";
import type { Execution } from "../../src/domain.ts";

function trip(point: string, identity: Record<string, string | number>) {
  const output = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!output) throw Error("Fault injection requires external fixture evidence");
  try {
    writeFileSync(
      join(output, `fault-${point}.json`),
      JSON.stringify({
        schema_version: 1,
        point,
        ...identity,
        pid: process.pid,
      }) + "\n",
      { flag: "wx" },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** One-shot pauses in an instrumented disposable copy, never production policy. */
export function installCommunicationFaults(runtime: Runtime) {
  if (process.env.ABRACODE_TEST_FAULT_PROFILE !== "communication-crash") return;
  const prompt = runtime.prompt.bind(runtime);
  runtime.prompt = (session, text, id, steer) =>
    Effect.gen(function* () {
      if (
        text.includes("operational-before-admission") &&
        trip("before-admission", { session_id: session, prompt_id: id })
      )
        return yield* Effect.never;
      yield* prompt(session, text, id, steer);
      if (
        text.includes("operational-after-admission") &&
        trip("after-admission", { session_id: session, prompt_id: id })
      )
        return yield* Effect.never;
    });
  const notify = runtime.notify.bind(runtime);
  runtime.notify = (session, text, id) =>
    Effect.gen(function* () {
      yield* notify(session, text, id);
      if (
        id &&
        text.includes("replied to operational-lead-notice ") &&
        trip("lead-notice", { session_id: session, prompt_id: id })
      )
        return yield* Effect.never;
    });
}

/** Drop completion delivery and repeat/reorder native tool events; periodic
 * reconciliation must discover actual outcomes from the native service. */
export function faultEvents(ctx: Context): Context {
  if (process.env.ABRACODE_TEST_FAULT_PROFILE !== "communication-crash") return ctx;
  const output = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!output) throw Error("Event faults require external fixture evidence");
  const counts = {
    pid: process.pid,
    dropped_completions: 0,
    duplicated_tools: 0,
    reordered_tools: 0,
  };
  process.once("exit", () =>
    appendFileSync(join(output, "fault-events.jsonl"), JSON.stringify(counts) + "\n"),
  );
  type Event = Stream.Success<ReturnType<Context["event"]["subscribe"]>>;
  const previous = new Map<string, Event>();
  return {
    ...ctx,
    event: {
      ...ctx.event,
      subscribe: () =>
        ctx.event.subscribe().pipe(
          Stream.flatMap((event) => {
            if (
              [
                "session.execution.succeeded",
                "session.execution.failed",
                "session.execution.interrupted",
                "session.idle",
              ].includes(event.type)
            ) {
              counts.dropped_completions++;
              return Stream.fromArray<Event>([]);
            }
            if (
              event.type === "session.tool.progress" ||
              event.type === "session.tool.success" ||
              event.type === "session.tool.failed"
            ) {
              const older = previous.get(event.data.sessionID);
              if (previous.size >= 64 && !previous.has(event.data.sessionID))
                previous.delete(previous.keys().next().value!);
              previous.set(event.data.sessionID, event);
              counts.duplicated_tools++;
              if (older) counts.reordered_tools++;
              return Stream.fromArray(older ? [event, event, older] : [event, event]);
            }
            return Stream.fromArray([event]);
          }),
        ),
    },
  };
}

/** Stop after the HTML link exists but before its published controller receipt. */
export function installReportFault(records: Records) {
  if (process.env.ABRACODE_TEST_FAULT_PROFILE !== "communication-crash") return;
  const set = records.store.set.bind(records.store);
  records.store.set = (key, value) =>
    Effect.gen(function* () {
      if (key.startsWith("execution/") && typeof value === "object" && value) {
        // This fixture wraps the owning Records writer, after its schema check.
        const execution = value as unknown as Execution;
        const build = execution.visual_reports?.find(
          (b) =>
            b.request.request_id === "operational-report-publication" &&
            b.status === "published" &&
            b.artifact,
        );
        if (
          build?.artifact &&
          trip("report-publication", {
            issue_id: execution.issue_id,
            request_id: build.request.request_id,
            path: build.artifact.path,
            hash: build.artifact.hash,
          })
        )
          return yield* Effect.never;
      }
      yield* set(key, value);
    });
}
