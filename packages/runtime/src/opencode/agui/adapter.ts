import type { Submission } from "@abracode/contracts/web/workspace-wire";
import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from "effect";
import { defer, Observable } from "rxjs";
import {
  EventType,
  type Event,
  type JsonPatch,
  type RunAgentInput,
  type BaseEvent,
} from "@ag-ui/core";
import { EventSchema, RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";
import { SubmissionOptionsSchema } from "@abracode/contracts/web/workspace-wire";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import { NativeMessageCursor } from "@abracode/contracts/web/transcript";
import { CrewError } from "../../domain.ts";

export type NativeSessionView = {
  busy: boolean;
  completions?: readonly {
    inputs: readonly string[];
    outcome: "succeeded" | "failed" | "interrupted";
    error?: string;
  }[];
  messages: readonly TranscriptMessage[];
  inbox: readonly { id: string }[];
};
export type NativeObservation =
  | {
      type: "snapshot";
      native: NativeSessionView;
      order?: { epoch: string; sequence: number; baseline: boolean };
      state?: (baseline: boolean) => Record<string, unknown>;
    }
  | { type: "custom"; event: Event };
export interface NativeAgentSource {
  sessionID: string;
  current: Effect.Effect<{ busy: boolean }, CrewError>;
  submit(input: Submission): Effect.Effect<SubmissionReceipt, CrewError>;
  receipt(requestID: string): Effect.Effect<SubmissionReceipt | null, CrewError>;
  stop: Effect.Effect<boolean, CrewError>;
  notifyAdmission: Effect.Effect<void>;
  updates: Stream.Stream<NativeObservation>;
}
const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const plainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const escapePointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Compute minimal RFC 6902 JSON Patch operations recursively across plain objects. */
export function jsonPatch(
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = "",
  delta: JsonPatch = [],
): JsonPatch {
  if (Object.is(prior, next)) return delta;
  for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
    const before = prior[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    const path = `${prefix}/${escapePointer(key)}`;
    if (after === undefined) {
      if (before !== undefined) delta.push({ op: "remove", path });
    } else if (before === undefined) {
      delta.push({ op: "add", path, value: after });
    } else if (plainObject(before) && plainObject(after)) {
      jsonPatch(before, after, path, delta);
    } else if (!same(before, after)) {
      delta.push({ op: "replace", path, value: after });
    }
  }
  return delta;
}

/** Each observer owns a projection cursor, never native execution or retained history. */
function projection() {
  let previous: Extract<NativeObservation, { type: "snapshot" }> | undefined;
  const cursor = new NativeMessageCursor();
  let previousState: Record<string, unknown> | undefined;
  const push = (event: NativeObservation): readonly Event[] => {
    if (event.type === "custom") return [event.event];
    const before = previous,
      order = event.order;
    if (
      before?.order &&
      order &&
      before.order.epoch === order.epoch &&
      order.sequence <= before.order.sequence
    )
      return [];
    const baseline =
      order?.baseline ||
      !before ||
      !order ||
      before.order?.epoch !== order.epoch ||
      order.sequence !== before.order.sequence + 1;
    previous = event;
    const messages = cursor.update(event.native.messages, baseline);
    const state = event.state?.(baseline);
    if (!state) return messages;
    const priorState = previousState;
    previousState = state;
    if (baseline || !priorState)
      return [...messages, { type: EventType.STATE_SNAPSHOT, snapshot: state }];
    const delta = jsonPatch(priorState, state);
    return delta.length ? [...messages, { type: EventType.STATE_DELTA, delta }] : messages;
  };
  return { push, close: () => cursor.close() };
}
/** Effect/Observable cancellation detaches the scoped observer; it never calls Stop. */
const observable = (stream: Stream.Stream<Event, CrewError>) =>
  new Observable<BaseEvent>((observer) => {
    const fiber = Effect.runFork(
      stream.pipe(
        Stream.runForEach((event) =>
          Effect.try({
            try: () => EventSchema.parse(event),
            catch: () => new CrewError("WEB_EVENT", "Invalid native observation event"),
          }).pipe(Effect.tap((valid) => Effect.sync(() => observer.next(valid)))),
        ),
      ),
    );
    fiber.addObserver((exit) => {
      if (observer.closed) return;
      if (Exit.isSuccess(exit)) observer.complete();
      else
        observer.error(
          Option.getOrElse(
            Cause.findErrorOption(exit.cause),
            () => new CrewError("WEB_OBSERVATION", "Native observation ended unexpectedly"),
          ),
        );
    });
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  });

/** Native execution/admission semantics, independent of workspace widgets and CopilotKit hosting. */
export class NativeAgentAdapter {
  constructor(private source: NativeAgentSource) {}
  accessible(thread: string) {
    return thread === this.source.sessionID;
  }
  private assert(thread: string, agent = "abra") {
    if (!this.accessible(thread) || agent !== "abra")
      throw new CrewError("WEB_INPUT", "Use the fixed Abra session and agent");
  }
  run(thread: string, agent: string | undefined, raw: RunAgentInput) {
    const admitted = Effect.gen({ self: this }, function* () {
      const input = yield* Effect.try({
        try: () => {
          this.assert(thread, agent);
          const input = RunAgentInputSchema.parse(raw);
          if (
            input.threadId !== thread ||
            input.tools.length ||
            input.context.length ||
            Object.keys(input.state).length
          )
            throw new CrewError(
              "WEB_INPUT",
              "Client tools and context cannot change Abra's native configuration; client state is read-only",
            );
          const user = input.messages.at(-1);
          if (!user || user.role !== "user" || typeof user.content !== "string")
            throw new CrewError("WEB_INPUT", "Submit one text message to Abra");
          return { text: user.content, options: input.forwardedProps };
        },
        catch: CrewError.from,
      });
      const options = yield* Schema.decodeUnknownEffect(SubmissionOptionsSchema, {
        onExcessProperty: "error",
        reportInput: false,
      })(input.options).pipe(
        Effect.mapError(() => new CrewError("WEB_INPUT", "Unsupported submission options")),
      );
      const receipt = yield* this.source.submit({
        request_id: options.request_id,
        text: input.text,
        delivery: options.delivery ?? "queue",
        ...(options.thought && { thought: options.thought }),
        ...(options.selection && { selection: options.selection }),
      });
      if (receipt.status !== "admitted")
        return yield* new CrewError(
          "WEB_INPUT",
          `Submission ${receipt.request_id} is uncertain. Reconcile this same submission before retrying.`,
        );
      yield* this.source.notifyAdmission;
      return receipt;
    });
    return defer(() => {
      let terminal: NonNullable<NativeSessionView["completions"]>[number] | undefined;
      const project = projection();
      const observation = Stream.unwrap(
        admitted.pipe(
          Effect.map((receipt) =>
            this.source.updates.pipe(
              Stream.tap((event) =>
                Effect.sync(() => {
                  if (event.type === "snapshot")
                    terminal = event.native.completions?.find((turn) =>
                      turn.inputs.includes(receipt.message_id),
                    );
                }),
              ),
              Stream.takeUntil(() => terminal !== undefined),
              Stream.flatMap((event) => Stream.fromIterable(project.push(event))),
            ),
          ),
        ),
      );
      const finish = Stream.unwrap(
        Effect.sync(() =>
          Stream.fromIterable([
            ...project.close(),
            terminal?.outcome === "succeeded"
              ? ({
                  type: EventType.RUN_FINISHED,
                  threadId: thread,
                  runId: raw.runId,
                } satisfies Event)
              : ({
                  type: EventType.RUN_ERROR,
                  code: terminal ? "NATIVE_FAILURE" : "NATIVE_COMPLETION_UNAVAILABLE",
                  message:
                    terminal?.error?.slice(0, 1024) ??
                    (terminal
                      ? "Native execution was interrupted"
                      : "Native completion is not established; reconnect without resubmitting input"),
                } satisfies Event),
          ]),
        ),
      );
      return observable(
        Stream.concat(
          Stream.succeed({
            type: EventType.RUN_STARTED,
            threadId: thread,
            runId: raw.runId,
          } satisfies Event),
          Stream.concat(observation, finish).pipe(
            Stream.catch((error) =>
              Stream.succeed({
                type: EventType.RUN_ERROR,
                code: error.code,
                message: error.message.slice(0, 1024),
              } satisfies Event),
            ),
          ),
        ),
      );
    });
  }
  connect(thread: string, agent = "abra") {
    return defer(() => {
      const project = projection(),
        runId = randomUUID();
      const observation = Stream.unwrap(
        Effect.try({
          try: () => {
            this.assert(thread, agent);
            return this.source.updates.pipe(
              Stream.flatMap((event) => Stream.fromIterable(project.push(event))),
            );
          },
          catch: CrewError.from,
        }),
      );
      return observable(
        Stream.concat(
          Stream.succeed({ type: EventType.RUN_STARTED, threadId: thread, runId } satisfies Event),
          Stream.concat(
            observation,
            Stream.unwrap(
              Effect.sync(() =>
                Stream.fromIterable([
                  ...project.close(),
                  {
                    type: EventType.RUN_FINISHED,
                    threadId: thread,
                    runId,
                  } satisfies Event,
                ]),
              ),
            ),
          ),
        ),
      );
    });
  }
  async isRunning(thread: string) {
    this.assert(thread);
    return (await Effect.runPromise(this.source.current)).busy;
  }
  async stop(thread: string, run?: string) {
    this.assert(thread);
    if (run)
      throw new CrewError(
        "WEB_INPUT",
        "The native service cannot stop a particular historical run. Use Stop current Abra turn.",
      );
    return Effect.runPromise(this.source.stop);
  }
}
