import { Schema } from "effect";
import { retainConversation, type Conversation } from "./conversation.ts";
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
  conversation: Conversation;
};
type Cancel = () => void;
export type ObservationClock = { after: (delay: number, action: () => void) => Cancel };
export type ObservationVisibility = {
  hidden: () => boolean;
  subscribe: (listener: () => void) => Cancel;
};
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
  visibility?: ObservationVisibility;
  random?: () => number;
};
const clock: ObservationClock = {
  after: (delay, action) => {
    const timer = setTimeout(action, delay);
    return () => clearTimeout(timer);
  },
};
const browserVisibility: ObservationVisibility = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  subscribe: (listener) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const reconnectBaseMs = 1000;
const reconnectMaxMs = 30_000;

/** Validated snapshots are JSON values. Preserve unchanged subtrees across wire decoding. */
function retainJSON<A>(previous: A, next: A): A {
  if (
    previous === next ||
    !record(previous) ||
    !record(next) ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return next;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return next;
  let same = true;
  const result = (Array.isArray(next) ? [...next] : { ...next }) as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(previous, key)) return next;
    result[key] = retainJSON(previous[key], next[key]);
    if (result[key] !== previous[key]) same = false;
  }
  return same ? previous : (result as A);
}

/** One browser observation lifetime. No drafts, admissions, history, navigation or native Stop. */
export class WorkspaceObservation {
  private value: ObservationState;
  private listeners = new Set<(value: ObservationState) => void>();
  private retired = new Set<string>();
  private disposed = false;
  private publishing = false;
  private pending: ChangeScope = {};
  private invalidationTimer?: Cancel;
  private reconnectTimer?: Cancel;
  private reconnectAttempts = 0;
  private connecting = false;
  private needsReconnect = false;
  private readonly abort = new AbortController();
  private baselineAbort?: AbortController;
  private refreshing?: Promise<void>;
  private demand?: Observation;
  private queued = false;
  private unsubscribe: Cancel;
  private unsubscribeVisibility: Cancel;
  private clock: ObservationClock;
  private visibility: ObservationVisibility;
  private random: () => number;

  constructor(
    initial: WorkspaceSnapshot,
    private adapters: ObservationAdapters,
    retained?: Conversation,
  ) {
    this.value = {
      workspace: initial,
      stateError: "",
      connectionError: "",
      conversation: retainConversation(retained, initial),
    };
    this.clock = adapters.clock ?? clock;
    this.visibility = adapters.visibility ?? browserVisibility;
    this.random = adapters.random ?? Math.random;
    this.unsubscribe = adapters.transport.subscribe({
      state: (state) => this.receive(state),
      custom: (event) => this.custom(event),
    });
    this.unsubscribeVisibility = this.visibility.subscribe(() => this.onVisibilityChange());
    this.receive(adapters.transport.current());
    if (this.visibility.hidden()) this.needsReconnect = true;
    else this.connect();
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
    this.update({
      workspace: retainJSON(this.value.workspace, next),
      conversation: retainConversation(this.value.conversation, next),
    });
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
    if (this.disposed || this.publishing || !record(state) || !Object.hasOwn(state, "workspace"))
      return;
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
    this.reconnectAttempts = 0;
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
      ) {
        this.reconnectAttempts = 0;
        this.update({ workspace: { ...this.value.workspace, at: value.at }, connectionError: "" });
      }
    }
    if (event.name === "abracode.connection" && value.status === "reconnecting")
      this.update({
        connectionError:
          "Native observation unavailable. Reconnecting; showing the last valid state.",
      });
  }
  private nextReconnectDelay() {
    const base = Math.min(
      reconnectMaxMs,
      reconnectBaseMs * 2 ** Math.min(this.reconnectAttempts, 5),
    );
    const jittered = Math.round(base * (0.75 + this.random() * 0.25));
    this.reconnectAttempts++;
    return Math.min(reconnectMaxMs, Math.max(1, jittered));
  }
  private scheduleReconnect() {
    if (this.disposed) return;
    this.reconnectTimer?.();
    this.reconnectTimer = undefined;
    if (this.visibility.hidden()) {
      this.needsReconnect = true;
      return;
    }
    const delay = this.nextReconnectDelay();
    this.reconnectTimer = this.clock.after(delay, () => {
      this.reconnectTimer = undefined;
      this.connect();
    });
  }
  private onVisibilityChange() {
    if (this.disposed) return;
    if (this.visibility.hidden()) {
      if (this.reconnectTimer) {
        this.reconnectTimer();
        this.reconnectTimer = undefined;
        this.needsReconnect = true;
      }
      return;
    }
    if (this.needsReconnect && !this.connecting) {
      this.needsReconnect = false;
      this.reconnectAttempts = 0;
      this.connect();
    }
  }
  private connect() {
    if (this.disposed || this.connecting) return;
    if (this.visibility.hidden()) {
      this.needsReconnect = true;
      return;
    }
    this.connecting = true;
    this.needsReconnect = false;
    void Promise.resolve()
      .then(() => (this.disposed ? undefined : this.adapters.transport.connect()))
      .catch(() => this.update({ connectionError: "Live connection interrupted. Reconnecting…" }))
      .finally(() => {
        this.connecting = false;
        if (!this.disposed) this.scheduleReconnect();
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
        this.publishing = true;
        try {
          this.adapters.transport.publish(this.value.workspace);
        } finally {
          this.publishing = false;
        }
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
    this.unsubscribeVisibility();
    this.listeners.clear();
    this.invalidationTimer?.();
    this.reconnectTimer?.();
    this.baselineAbort?.abort();
    this.abort.abort();
    this.adapters.transport.detach();
  };
}
