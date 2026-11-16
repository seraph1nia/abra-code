import { CrewError } from "../domain.ts";
import { Effect, Fiber, PubSub, Schedule, Schema, Stream } from "effect";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type Event, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import { Observable } from "rxjs";
import type { WebBackend, WorkspaceSnapshot } from "./contracts.ts";
import { EventSchema, RunAgentInputSchema } from "@ag-ui/core/schemas";
import {
  SubmissionOptionsSchema,
  WorkspaceSnapshotSchema,
  WorkspaceStateJson,
} from "./workspace-wire.ts";
import { decode } from "../decode.ts";
import { nativeAguiMessages } from "./transcript.ts";

type FeedEvent = { type: "snapshot"; snapshot: WorkspaceSnapshot } | { type: "reconnecting" };
/** Scoped, coalesced observations. Subscriptions never own a native execution. */
export class WorkspaceFeed {
  private constructor(
    readonly refresh: Effect.Effect<void>,
    readonly updates: Stream.Stream<FeedEvent>,
  ) {}
  static make(backend: WebBackend) {
    return Effect.gen(function* () {
      const signals = yield* PubSub.sliding<void>(1);
      const events = yield* PubSub.sliding<FeedEvent>(1);
      let latest: FeedEvent | undefined;
      const refresh = PubSub.publish(signals, undefined).pipe(Effect.asVoid);
      const read = backend.snapshot.pipe(
        Effect.flatMap((snapshot) =>
          decode(Schema.toType(WorkspaceSnapshotSchema), snapshot, "Workspace feed"),
        ),
        Effect.match({
          onSuccess: (snapshot): FeedEvent => ({ type: "snapshot", snapshot }),
          onFailure: (): FeedEvent => ({ type: "reconnecting" }),
        }),
        Effect.flatMap((event) => {
          latest = event;
          return PubSub.publish(events, event);
        }),
      );
      const subscription = yield* PubSub.subscribe(signals);
      yield* Stream.fromSubscription(subscription).pipe(
        Stream.runForEach(() => read.pipe(Effect.andThen(Effect.sleep("200 millis")))),
        Effect.forkScoped,
      );
      yield* backend.changes.pipe(
        Stream.runForEach(() => refresh),
        Effect.retry(Schedule.spaced("1 second")),
        Effect.forkScoped,
      );
      yield* Effect.sleep("5 seconds").pipe(
        Effect.andThen(refresh),
        Effect.forever,
        Effect.forkScoped,
      );
      const updates = Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          yield* refresh;
          return Stream.concat(
            Stream.fromIterable(latest ? [latest] : []),
            Stream.fromSubscription(subscription),
          );
        }),
      );
      return new WorkspaceFeed(refresh, updates);
    });
  }
}

/** The only Effect/Observable seam: unsubscribing interrupts the observer fiber. */
function observable<A, E>(stream: Stream.Stream<A, E>) {
  return new Observable<A>((observer) => {
    const fiber = Effect.runFork(
      stream.pipe(
        Stream.runForEach((event) => Effect.sync(() => observer.next(event))),
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
}

function snapshots(snapshot: WorkspaceSnapshot): Event[] {
  const state = Schema.encodeSync(WorkspaceStateJson)({ workspace: snapshot });
  return [
    {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: nativeAguiMessages(snapshot.messages),
    } satisfies Event,
    { type: EventType.STATE_SNAPSHOT, snapshot: state } satisfies Event,
  ];
}
function feedEvents(event: FeedEvent) {
  return Stream.fromEffect(
    Effect.try({
      try: () => (event.type === "snapshot" ? snapshots(event.snapshot) : [connectionEvent()]),
      catch: () => new CrewError("WEB_STATE", "Workspace update unavailable"),
    }).pipe(Effect.orElseSucceed(() => [connectionEvent()])),
  ).pipe(Stream.flatMap((events) => Stream.fromIterable(events)));
}
function aguiEvents<E>(stream: Stream.Stream<Event, E>) {
  return observable(stream.pipe(Stream.map((event) => EventSchema.parse(event))));
}
/** OpenCode is the only model/tool loop. This agent advertises the bridge to CopilotKit. */
export class AbraAgent extends AbstractAgent {
  constructor(
    private runner: AbraRunner,
    sessionID: string,
  ) {
    super({ agentId: "abra", threadId: sessionID, description: "AbraCode's central Abra session" });
  }
  run(input: RunAgentInput) {
    return this.runner.run({ threadId: input.threadId, agent: this, input });
  }
  override clone() {
    return new AbraAgent(this.runner, this.threadId);
  }
}

export class AbraRunner extends AgentRunner {
  constructor(
    private backend: WebBackend,
    private feed: Pick<WorkspaceFeed, "refresh" | "updates">,
  ) {
    super();
  }
  private assert(threadId: string, agentId = "abra") {
    if (threadId !== this.backend.sessionID || agentId !== "abra")
      throw new CrewError("WEB_INPUT", "Use the fixed Abra session and agent");
  }
  override isThreadAccessible(threadId: string) {
    return threadId === this.backend.sessionID;
  }
  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const admitted = Effect.gen({ self: this }, function* () {
      const submitted = yield* Effect.try({
        try: () => {
          this.assert(request.threadId, request.agent.agentId);
          const input = RunAgentInputSchema.parse(request.input);
          if (input.threadId !== request.threadId || input.tools.length || input.context.length)
            throw new CrewError(
              "WEB_INPUT",
              "Client tools and context cannot change Abra's native configuration",
            );
          const user = input.messages.at(-1);
          if (!user || user.role !== "user" || typeof user.content !== "string")
            throw new CrewError("WEB_INPUT", "Submit one text message to Abra");
          return {
            text: user.content,
            forwardedProps: input.forwardedProps,
          };
        },
        catch: (error) => CrewError.from(error),
      });
      const forwarded = yield* decode(
        SubmissionOptionsSchema,
        submitted.forwardedProps,
        "Submission options",
      );
      const receipt = yield* this.backend.submit({
        request_id: forwarded.request_id,
        text: submitted.text,
        delivery: forwarded.delivery ?? "queue",
      });
      if (receipt.status === "uncertain")
        return yield* new CrewError(
          "WEB_INPUT",
          `Submission ${receipt.request_id} is uncertain. Reconcile this same submission before retrying.`,
        );
      yield* this.feed.refresh;
      return receipt;
    });
    const observation = Stream.unwrap(
      admitted.pipe(
        Effect.map((receipt) =>
          this.feed.updates.pipe(
            Stream.takeUntil(
              (event) =>
                event.type === "snapshot" &&
                !event.snapshot.busy &&
                event.snapshot.messages.some((m) => m.id === receipt.message_id) &&
                !event.snapshot.inbox.some((i) => i.id === receipt.message_id),
            ),
            Stream.flatMap(feedEvents),
          ),
        ),
      ),
    );
    return aguiEvents(
      Stream.concat(
        Stream.succeed({
          type: EventType.RUN_STARTED,
          threadId: request.threadId,
          runId: request.input.runId,
        } satisfies Event),
        Stream.concat(
          observation,
          Stream.succeed({
            type: EventType.RUN_FINISHED,
            threadId: request.threadId,
            runId: request.input.runId,
          } satisfies Event),
        ),
      ),
    );
  }
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return aguiEvents(
      Stream.unwrap(
        Effect.try({
          try: () => {
            this.assert(request.threadId, request.agentId);
            return this.feed.updates.pipe(Stream.flatMap(feedEvents));
          },
          catch: () => new CrewError("WEB_INPUT", "Use the fixed Abra session"),
        }),
      ),
    );
  }

  async isRunning(request: AgentRunnerIsRunningRequest) {
    this.assert(request.threadId);
    return (await Effect.runPromise(this.backend.snapshot)).busy;
  }
  async stop(request: AgentRunnerStopRequest) {
    this.assert(request.threadId);
    if (request.runId)
      throw new CrewError(
        "WEB_INPUT",
        "The native service cannot stop a particular historical run. Use Stop current Abra turn.",
      );
    return Effect.runPromise(this.backend.stop);
  }
}

function connectionEvent(): Event {
  return {
    type: EventType.CUSTOM,
    name: "abracode.connection",
    value: { status: "reconnecting" },
  } satisfies Event;
}
