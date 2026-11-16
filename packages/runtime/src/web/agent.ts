import { randomUUID } from "node:crypto";
import { mergeChanges, type ChangeScope } from "@abracode/contracts/web/changes";
import { semanticWorkspace } from "@abracode/contracts/web/observation";
import { CrewError } from "../domain.ts";
import { Effect, Fiber, PubSub, Schedule, Schema, Stream, Semaphore } from "effect";
import { AbstractAgent } from "@ag-ui/client";
import {
  EventType,
  type Event,
  type BaseEvent,
  type JsonPatch,
  type RunAgentInput,
} from "@ag-ui/core";
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
import { nativeAguiMessages, nativeMessageEvents } from "./transcript.ts";

type FeedEvent =
  | { type: "snapshot"; snapshot: WorkspaceSnapshot }
  | { type: "freshness"; at: string; epoch: string; sequence: number }
  | { type: "reconnecting" };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function changedResources(
  previous: WorkspaceSnapshot | undefined,
  next: WorkspaceSnapshot,
  hint: ChangeScope,
): ChangeScope {
  if (!previous) return { all: true };
  const a = semanticWorkspace(previous),
    b = semanticWorkspace(next);
  return mergeChanges(hint.all ? (hint.work_all ? { work_all: true, finder: true } : {}) : hint, {
    transcript:
      !same(
        [a.messages, a.inbox, a.busy, a.model, a.outcome, a.older],
        [b.messages, b.inbox, b.busy, b.model, b.outcome, b.older],
      ) || undefined,
    attention: !same([a.forms, a.permissions], [b.forms, b.permissions]) || undefined,
    admissions: !same(a.receipts, b.receipts) || undefined,
    presentations: !same([a.surfaces, a.presentations], [b.surfaces, b.presentations]) || undefined,
    projects: !same(a.projects, b.projects) || undefined,
    ...(!same([a.work, a.work_unavailable], [b.work, b.work_unavailable])
      ? {
          ...(hint.issues?.length && !hint.all && !hint.work_all ? {} : { work_all: true }),
          finder: true,
        }
      : {}),
  });
}
/** One observation owner, one fallback schedule and bounded coalescing. */
export class WorkspaceFeed {
  private constructor(
    readonly refresh: Effect.Effect<void>,
    readonly updates: Stream.Stream<FeedEvent>,
    readonly baseline: Effect.Effect<WorkspaceSnapshot, CrewError>,
    readonly notify: (scope: ChangeScope) => Effect.Effect<void>,
  ) {}
  static make(backend: WebBackend) {
    return Effect.gen(function* () {
      const signals = yield* PubSub.sliding<void>(1);
      const events = yield* PubSub.sliding<FeedEvent>(1);
      const mutex = yield* Semaphore.make(1);
      const epoch = randomUUID();
      let sequence = 0;
      let latest: WorkspaceSnapshot | undefined;
      let pending: ChangeScope = {};
      const notify = (scope: ChangeScope) =>
        Effect.sync(() => {
          pending = mergeChanges(pending, scope);
        }).pipe(Effect.andThen(PubSub.publish(signals, undefined)), Effect.asVoid);
      const refresh = notify({ all: true });
      const publish = (event: FeedEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);
      const read = (scope: ChangeScope) =>
        mutex.withPermit(
          Effect.gen(function* () {
            const value = yield* backend
              .observe(scope)
              .pipe(
                Effect.flatMap((snapshot) =>
                  decode(Schema.toType(WorkspaceSnapshotSchema), snapshot, "Workspace feed"),
                ),
              );
            const changes = changedResources(latest, value, scope);
            const changed =
              !latest ||
              !same(semanticWorkspace(latest), semanticWorkspace(value)) ||
              !!changes.work_all ||
              !!changes.issues?.length;
            if (changed) {
              latest = {
                ...value,
                observation: { epoch, sequence: ++sequence, baseline: false, changes },
              };
              yield* publish({ type: "snapshot", snapshot: latest });
            } else {
              latest = { ...value, observation: latest!.observation };
              yield* publish({ type: "freshness", at: value.at, epoch, sequence });
            }
            return latest;
          }),
        );
      const currentBaseline = Effect.suspend(() =>
        latest ? Effect.succeed(latest) : read({ all: true }),
      ).pipe(
        Effect.map((value) => ({
          ...value,
          observation: { ...value.observation!, baseline: true },
        })),
      );
      const subscription = yield* PubSub.subscribe(signals);
      yield* Stream.fromSubscription(subscription).pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const scope = pending;
            pending = {};
            yield* read(scope).pipe(Effect.catch(() => publish({ type: "reconnecting" })));
            yield* Effect.sleep("200 millis");
          }),
        ),
        Effect.forkScoped,
      );
      yield* backend.changes.pipe(
        Stream.runForEach((scope) =>
          notify(!scope || scope.all ? { all: true, work_all: true } : scope),
        ),
        Effect.matchEffect({
          onFailure: () => publish({ type: "reconnecting" }),
          onSuccess: () => publish({ type: "reconnecting" }),
        }),
        Effect.repeat(Schedule.spaced("1 second")),
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
          const value = yield* currentBaseline;
          return Stream.concat(
            Stream.succeed({ type: "snapshot" as const, snapshot: value }),
            Stream.fromSubscription(subscription),
          );
        }),
      );
      return new WorkspaceFeed(
        refresh,
        updates.pipe(Stream.catch(() => Stream.succeed({ type: "reconnecting" as const }))),
        read({ all: true, work_all: true }).pipe(
          Effect.map((value) => ({
            ...value,
            observation: { ...value.observation!, baseline: true },
          })),
        ),
        notify,
      );
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

const encodeWorkspace = Schema.encodeSync(WorkspaceSnapshotSchema);
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
/** Each connection starts with a baseline. Gaps in a sliding subscriber recover with another. */
function feedEvents() {
  let previous: WorkspaceSnapshot | undefined;
  return (event: FeedEvent): Stream.Stream<Event> => {
    if (event.type === "reconnecting") return Stream.succeed(connectionEvent());
    if (event.type === "freshness")
      return Stream.succeed({
        type: EventType.CUSTOM,
        name: "abracode.freshness",
        value: event,
      } satisfies Event);
    const next = event.snapshot;
    const order = next.observation;
    const baseline =
      !previous ||
      !order ||
      previous.observation?.epoch !== order.epoch ||
      order.sequence !== previous.observation.sequence + 1;
    if (
      previous?.observation &&
      order &&
      previous.observation.epoch === order.epoch &&
      order.sequence <= previous.observation.sequence
    )
      return Stream.empty;
    const value = { ...next, observation: order ? { ...order, baseline } : undefined };
    const before = previous;
    previous = value;
    return Stream.fromEffect(
      Effect.try({
        try: (): Event[] => {
          if (baseline || !before) return snapshots(value);
          const a = encodeWorkspace(before);
          const b = encodeWorkspace(value);
          const delta: JsonPatch = [];
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const old = Reflect.get(a, key),
              current = Reflect.get(b, key);
            if (same(old, current)) continue;
            const path = `/workspace/${key}` as const;
            if (current === undefined) delta.push({ op: "remove", path });
            else delta.push({ op: old === undefined ? "add" : "replace", path, value: current });
          }
          return [
            ...nativeMessageEvents(before.messages, value.messages),
            { type: EventType.STATE_DELTA, delta } satisfies Event,
          ];
        },
        catch: () => new CrewError("WEB_STATE", "Workspace update unavailable"),
      }).pipe(Effect.orElseSucceed(() => [connectionEvent()])),
    ).pipe(Stream.flatMap(Stream.fromIterable));
  };
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
    private feed: Pick<WorkspaceFeed, "notify" | "updates">,
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
      yield* this.feed.notify({ admissions: true, transcript: true });
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
            Stream.flatMap(feedEvents()),
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
            return this.feed.updates.pipe(Stream.flatMap(feedEvents()));
          },
          catch: () => new CrewError("WEB_INPUT", "Use the fixed Abra session"),
        }),
      ),
    );
  }

  async isRunning(request: AgentRunnerIsRunningRequest) {
    this.assert(request.threadId);
    return (await Effect.runPromise(this.backend.observe({}))).busy;
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
