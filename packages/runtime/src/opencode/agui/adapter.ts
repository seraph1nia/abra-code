import { randomUUID } from "node:crypto";
import { Effect, Fiber, Schema, Stream } from "effect";
import { Observable } from "rxjs";
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
  submit(input: {
    request_id: string;
    text: string;
    delivery: "queue" | "steer";
  }): Effect.Effect<SubmissionReceipt, CrewError>;
  receipt(requestID: string): Effect.Effect<SubmissionReceipt | null, CrewError>;
  stop: Effect.Effect<boolean, CrewError>;
  notifyAdmission: Effect.Effect<void>;
  updates: Stream.Stream<NativeObservation>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Each observer owns a projection cursor, never native execution or retained history. */
function projection() {
  let previous: Extract<NativeObservation, { type: "snapshot" }> | undefined;
  const cursor = new NativeMessageCursor();
  let previousState: Record<string, unknown> | undefined;
  return (event: NativeObservation): readonly Event[] => {
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
    const priorState = previousState;
    previousState = state;
    if (!state) return messages;
    if (baseline || !priorState)
      return [...messages, { type: EventType.STATE_SNAPSHOT, snapshot: state }];
    const delta: JsonPatch = [];
    for (const key of new Set([...Object.keys(priorState!), ...Object.keys(state)])) {
      const prior = priorState![key],
        value = state[key];
      if (same(prior, value)) continue;
      if (value === undefined)
        delta.push({ op: "remove", path: `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}` });
      else
        delta.push({
          op: prior === undefined ? "add" : "replace",
          path: `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          value,
        });
    }
    return delta.length ? [...messages, { type: EventType.STATE_DELTA, delta }] : messages;
  };
}
/** Effect/Observable cancellation detaches the scoped observer; it never calls Stop. */
const observable = (stream: Stream.Stream<Event, CrewError>) =>
  new Observable<BaseEvent>((observer) => {
    const fiber = Effect.runFork(
      stream.pipe(
        Stream.runForEach((event) => Effect.sync(() => observer.next(EventSchema.parse(event)))),
        Effect.match({
          onSuccess: () => observer.complete(),
          onFailure: (error) => observer.error(error),
        }),
      ),
    );
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
      });
      if (receipt.status !== "admitted")
        return yield* new CrewError(
          "WEB_INPUT",
          `Submission ${receipt.request_id} is uncertain. Reconcile this same submission before retrying.`,
        );
      yield* this.source.notifyAdmission;
      return receipt;
    });
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
            Stream.flatMap((event) => Stream.fromIterable(project(event))),
          ),
        ),
      ),
    );
    const finish = Stream.unwrap(
      Effect.sync(() =>
        Stream.succeed(
          terminal?.outcome === "succeeded"
            ? ({ type: EventType.RUN_FINISHED, threadId: thread, runId: raw.runId } satisfies Event)
            : ({
                type: EventType.RUN_ERROR,
                code: terminal ? "NATIVE_FAILURE" : "NATIVE_COMPLETION_UNAVAILABLE",
                message:
                  terminal?.error?.slice(0, 1024) ??
                  (terminal
                    ? "Native execution was interrupted"
                    : "Native completion is not established; reconnect without resubmitting input"),
              } satisfies Event),
        ),
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
  }
  connect(thread: string, agent = "abra") {
    const project = projection(),
      runId = randomUUID();
    const observation = Stream.unwrap(
      Effect.try({
        try: () => {
          this.assert(thread, agent);
          return this.source.updates.pipe(
            Stream.flatMap((event) => Stream.fromIterable(project(event))),
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
          Stream.succeed({ type: EventType.RUN_FINISHED, threadId: thread, runId } satisfies Event),
        ),
      ),
    );
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
