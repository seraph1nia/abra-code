import { Schema } from "effect";
import { observationDecision } from "@abracode/contracts/web/observation";
import { mergeChanges, type ChangeScope, type Observation } from "@abracode/contracts/web/changes";
import {
  WorkspaceStateJson,
  WorkspaceSnapshotSchema,
} from "@abracode/contracts/web/workspace-wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";

export type ObservationState = {
  workspace: WorkspaceSnapshot;
  stateError: string;
  connectionError: string;
};
type Cancel = () => void;
export type ObservationClock = { after: (delay: number, action: () => void) => Cancel };
export type ObservationAdapters = {
  transport: {
    current: () => unknown;
    subscribe: (listener: {
      state: (state: unknown) => void;
      custom: (event: { name: string; value: unknown }) => void;
    }) => Cancel;
    connect: () => Promise<void>;
    detach: () => void;
    publish: (workspace: WorkspaceSnapshot) => void;
  };
  baseline: (signal: AbortSignal) => Promise<WorkspaceSnapshot>;
  invalidate: (scope: ChangeScope, signal: AbortSignal) => Promise<void>;
  error: (message: string) => void;
  clock?: ObservationClock;
};
const clock: ObservationClock = {
  after: (delay, action) => {
    const timer = setTimeout(action, delay);
    return () => clearTimeout(timer);
  },
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** One browser observation lifetime. No drafts, admissions, history, navigation or native Stop. */
export class WorkspaceObservation {
  private value: ObservationState;
  private listeners = new Set<(value: ObservationState) => void>();
  private retired = new Set<string>();
  private disposed = false;
  private pending: ChangeScope = {};
  private invalidationTimer?: Cancel;
  private reconnectTimer?: Cancel;
  private readonly abort = new AbortController();
  private baselineAbort?: AbortController;
  private refreshing?: Promise<void>;
  private demand?: Observation;
  private queued = false;
  private unsubscribe: Cancel;
  private clock: ObservationClock;

  constructor(
    initial: WorkspaceSnapshot,
    private adapters: ObservationAdapters,
  ) {
    this.value = { workspace: initial, stateError: "", connectionError: "" };
    this.clock = adapters.clock ?? clock;
    this.unsubscribe = adapters.transport.subscribe({
      state: (state) => this.receive(state),
      custom: (event) => this.custom(event),
    });
    this.receive(adapters.transport.current());
    this.connect();
  }
  current = () => this.value;
  subscribe = (listener: (value: ObservationState) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<ObservationState>) {
    if (this.disposed) return;
    this.value = { ...this.value, ...change };
    for (const listener of this.listeners) listener(this.value);
  }
  private accept(next: WorkspaceSnapshot) {
    if (
      next.session_id !== this.value.workspace.session_id ||
      !Number.isFinite(Date.parse(next.at))
    )
      return false;
    const current = this.value.workspace.observation,
      order = next.observation;
    if (order && this.retired.has(order.epoch)) return true;
    const decision = observationDecision(current, order);
    if (decision === "duplicate") return true;
    if (decision === "baseline_required") return false;
    if (current && order && current.epoch !== order.epoch) {
      this.retired.add(current.epoch);
      if (this.retired.size > 16) this.retired.delete(this.retired.values().next().value!);
    }
    this.update({ workspace: next });
    const changes = order?.changes ?? { all: true };
    if (
      changes.all ||
      changes.work_all ||
      changes.finder ||
      changes.projects ||
      changes.issues?.length
    ) {
      this.pending = mergeChanges(this.pending, changes);
      if (!this.invalidationTimer)
        this.invalidationTimer = this.clock.after(200, () => {
          this.invalidationTimer = undefined;
          if (this.disposed) return;
          const scope = this.pending;
          this.pending = {};
          void this.adapters.invalidate(scope, this.abort.signal).catch((error) => {
            if (!this.disposed)
              this.adapters.error(
                error instanceof Error ? error.message : "Work refresh unavailable.",
              );
          });
        });
    }
    return true;
  }
  private receive(state: unknown) {
    if (this.disposed || !record(state) || !Object.hasOwn(state, "workspace")) return;
    const parsed = Schema.decodeUnknownResult(WorkspaceStateJson)(state);
    if (
      parsed._tag === "Failure" ||
      parsed.success.workspace.session_id !== this.value.workspace.session_id
    ) {
      this.update({ stateError: "Workspace update unavailable. Showing the last valid state." });
      void this.refresh();
      return;
    }
    const next = parsed.success.workspace;
    if (!this.accept(next)) {
      this.demand = next.observation;
      this.queued = !!this.refreshing;
      this.update({
        stateError: "An older or invalid observation was received. Showing the last valid state.",
      });
      void this.refresh();
      return;
    }
    this.update({ stateError: "", connectionError: "" });
  }
  private custom(event: { name: string; value: unknown }) {
    if (this.disposed || !record(event.value)) return;
    const value = event.value;
    if (event.name === "abracode.freshness") {
      const order = this.value.workspace.observation;
      if (
        order &&
        value.epoch === order.epoch &&
        value.sequence === order.sequence &&
        typeof value.at === "string" &&
        Number.isFinite(Date.parse(value.at))
      )
        this.update({ workspace: { ...this.value.workspace, at: value.at }, connectionError: "" });
    }
    if (event.name === "abracode.connection" && value.status === "reconnecting")
      this.update({
        connectionError:
          "Native observation unavailable. Reconnecting; showing the last valid state.",
      });
  }
  private connect() {
    if (this.disposed) return;
    void Promise.resolve()
      .then(() => (this.disposed ? undefined : this.adapters.transport.connect()))
      .catch(() => this.update({ connectionError: "Live connection interrupted. Reconnecting…" }))
      .finally(() => {
        if (!this.disposed) this.reconnectTimer = this.clock.after(2000, () => this.connect());
      });
  }
  refresh = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.baselineAbort = new AbortController();
    let repaired = false;
    this.refreshing = this.adapters
      .baseline(this.baselineAbort.signal)
      .then((value) => {
        if (this.disposed) return;
        const parsed = Schema.decodeResult(Schema.toType(WorkspaceSnapshotSchema))(value);
        if (parsed._tag === "Failure" || !this.accept(parsed.success)) {
          this.update({
            stateError: "Workspace baseline unavailable. Showing the last valid state.",
          });
          return;
        }
        repaired = true;
        this.adapters.transport.publish(this.value.workspace);
        this.update({ stateError: "", connectionError: "" });
      })
      .catch((error) => {
        if (this.disposed) return;
        this.update({
          connectionError: "Native observation unavailable. Showing the last valid state.",
        });
        this.adapters.error(
          error instanceof Error ? error.message : "Workspace refresh unavailable.",
        );
      })
      .finally(() => {
        this.refreshing = undefined;
        const order = this.value.workspace.observation,
          demand = this.demand;
        const covered =
          !demand ||
          this.retired.has(demand.epoch) ||
          (order?.epoch === demand.epoch && order.sequence >= demand.sequence);
        const retry = repaired && this.queued && !covered;
        this.queued = false;
        if (retry && !this.disposed) void this.refresh();
      });
    return this.refreshing;
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.invalidationTimer?.();
    this.reconnectTimer?.();
    this.baselineAbort?.abort();
    this.abort.abort();
    this.adapters.transport.detach();
  };
}
