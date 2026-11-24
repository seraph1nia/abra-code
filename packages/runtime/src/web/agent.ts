import {
  NativeAgentAdapter,
  type NativeObservation,
  type NativeSessionView,
} from "../opencode/agui/adapter.ts";
import { randomUUID } from "node:crypto";
import { mergeChanges, type ChangeScope } from "@abracode/contracts/web/changes";
import { semanticWorkspace } from "@abracode/contracts/web/observation";
import { CrewError } from "../domain.ts";
import { Effect, PubSub, Queue, Schedule, Schema, Stream, Semaphore } from "effect";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import type { WebBackend, WorkspaceSnapshot } from "./contracts.ts";
import { WorkspaceSnapshotSchema } from "@abracode/contracts/web/workspace-wire";

type ProjectionOrder = { epoch: string; sequence: number; baseline: boolean };
type FeedEvent =
  | { type: "snapshot"; snapshot: WorkspaceSnapshot; projection_order?: ProjectionOrder }
  | { type: "native"; native: NativeSessionView; projection_order?: ProjectionOrder }
  | { type: "freshness"; at: string; epoch: string; sequence: number }
  | { type: "reconnecting" };
const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const allSame = (pairs: readonly (readonly [unknown, unknown])[]) =>
  pairs.every(([a, b]) => same(a, b));
const hasScopeChange = (scope: ChangeScope) =>
  Boolean(
    scope.all ||
    scope.transcript ||
    scope.attention ||
    scope.admissions ||
    scope.presentations ||
    scope.projects ||
    scope.work_all ||
    scope.finder ||
    scope.fleet ||
    scope.issues?.length,
  );
function diffWorkspace(
  previous: WorkspaceSnapshot | undefined,
  next: WorkspaceSnapshot,
  hint: ChangeScope,
): { changes: ChangeScope; changed: boolean } {
  if (!previous) return { changes: { all: true }, changed: true };
  const transcript = !allSame([
    [previous.messages, next.messages],
    [previous.inbox, next.inbox],
    [previous.busy, next.busy],
    [previous.model, next.model],
    [previous.outcome, next.outcome],
    [previous.older, next.older],
  ]);
  const attention = !allSame([
    [previous.forms, next.forms],
    [previous.permissions, next.permissions],
  ]);
  const admissions = !same(previous.receipts, next.receipts);
  const presentations = !allSame([
    [previous.surfaces, next.surfaces],
    [previous.presentations, next.presentations],
  ]);
  const projects = !same(previous.projects, next.projects);
  const workChanged =
    previous.work_unavailable !== next.work_unavailable ||
    (!Object.is(previous.work, next.work) &&
      !same(semanticWorkspace(previous).work, semanticWorkspace(next).work));
  const identityChanged =
    previous.session_id !== next.session_id || previous.agent_id !== next.agent_id;
  const changes = mergeChanges(
    hint.all ? (hint.work_all ? { work_all: true, finder: true } : {}) : hint,
    {
      transcript: transcript || undefined,
      attention: attention || undefined,
      admissions: admissions || undefined,
      presentations: presentations || undefined,
      projects: projects || undefined,
      ...(workChanged
        ? {
            ...(hint.issues?.length && !hint.all && !hint.work_all ? {} : { work_all: true }),
            finder: true,
          }
        : {}),
    },
  );
  const changed =
    transcript ||
    attention ||
    admissions ||
    presentations ||
    projects ||
    workChanged ||
    identityChanged ||
    !!changes.fleet ||
    !!changes.work_all ||
    !!changes.issues?.length;
  return { changes, changed };
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
      const signals = yield* Effect.acquireRelease(Queue.dropping<void>(1), Queue.shutdown);
      const events = yield* PubSub.sliding<FeedEvent>(64);
      const mutex = yield* Semaphore.make(1);
      const epoch = randomUUID();
      let sequence = 0;
      let projectionSequence = 0;
      let latest: WorkspaceSnapshot | undefined;
      let pending: ChangeScope = {};
      const notify = (scope: ChangeScope) =>
        Effect.sync(() => {
          pending = mergeChanges(pending, scope);
        }).pipe(Effect.andThen(Queue.offer(signals, undefined)), Effect.asVoid);
      const refresh = notify({ all: true });
      const publish = (event: FeedEvent) =>
        PubSub.publish(
          events,
          event.type === "snapshot" || event.type === "native"
            ? {
                ...event,
                projection_order: { epoch, sequence: ++projectionSequence, baseline: false },
              }
            : event,
        ).pipe(Effect.asVoid);
      const read = (scope: ChangeScope) =>
        mutex.withPermit(
          Effect.gen(function* () {
            const value = yield* backend.observe(scope);
            const { changes, changed } = diffWorkspace(latest, value, scope);
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
      yield* Stream.fromQueue(signals).pipe(
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
          Effect.gen(function* () {
            let repair = false;
            if (scope?.native && backend.nativeEvent) {
              const update = backend.nativeEvent(scope.native);
              if (update.view) yield* publish({ type: "native", native: update.view });
              if (update.repair) {
                repair = true;
                yield* publish({ type: "reconnecting" });
              }
            }
            if (!scope || scope.all) yield* notify({ all: true, work_all: true });
            else if (repair) yield* notify(mergeChanges(scope, { transcript: true }));
            else if (hasScopeChange(scope)) yield* notify(scope);
          }),
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
            Stream.succeed({
              type: "snapshot" as const,
              snapshot: value,
              projection_order: { epoch, sequence: projectionSequence, baseline: true },
            }),
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
  override clone(): AbraAgent {
    const clone: AbraAgent = super.clone();
    clone.runner = this.runner;
    return clone;
  }
}

/** CopilotKit hosting and application state composition only. */
export class AbraRunner extends AgentRunner {
  private adapter: NativeAgentAdapter;
  constructor(backend: WebBackend, feed: Pick<WorkspaceFeed, "notify" | "updates">) {
    super();
    this.adapter = new NativeAgentAdapter({
      sessionID: backend.sessionID,
      current:
        backend.agentStatus ?? backend.observe({}).pipe(Effect.map(({ busy }) => ({ busy }))),
      submit: (input) => backend.submit(input),
      receipt: (id) => backend.receipt(id),
      stop: backend.stop,
      notifyAdmission: feed.notify({ admissions: true, transcript: true }),
      updates: feed.updates.pipe(
        Stream.map((event): NativeObservation =>
          event.type === "snapshot"
            ? {
                type: "snapshot",
                native: backend.nativeSnapshot?.() ?? {
                  ...event.snapshot,
                  completions: backend.completionEvidence?.() ?? [],
                },
                order: event.projection_order ?? event.snapshot.observation,
                state: (baseline) => ({
                  workspace: Schema.encodeSync(WorkspaceSnapshotSchema)({
                    ...event.snapshot,
                    observation: event.snapshot.observation
                      ? { ...event.snapshot.observation, baseline }
                      : undefined,
                  }),
                }),
              }
            : event.type === "native"
              ? { type: "snapshot", native: event.native, order: event.projection_order }
              : {
                  type: "custom",
                  event:
                    event.type === "freshness"
                      ? { type: EventType.CUSTOM, name: "abracode.freshness", value: event }
                      : {
                          type: EventType.CUSTOM,
                          name: "abracode.connection",
                          value: { status: "reconnecting" },
                        },
                },
        ),
      ),
    });
  }
  override isThreadAccessible(threadId: string) {
    return this.adapter.accessible(threadId);
  }
  run(request: AgentRunnerRunRequest) {
    return this.adapter.run(request.threadId, request.agent.agentId, request.input);
  }
  connect(request: AgentRunnerConnectRequest) {
    return this.adapter.connect(request.threadId, request.agentId);
  }
  isRunning(request: AgentRunnerIsRunningRequest) {
    return this.adapter.isRunning(request.threadId);
  }
  stop(request: AgentRunnerStopRequest) {
    return this.adapter.stop(request.threadId, request.runId);
  }
}
