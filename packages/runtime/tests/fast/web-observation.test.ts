import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import {
  WorkspaceObservation,
  type ObservationAdapters,
  type ObservationClock,
} from "@abracode/web/observation-client";
import { WorkspaceStateJson } from "../../src/web/workspace-wire.ts";
import type { WorkspaceSnapshot } from "../../src/web/contracts.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
class Clock implements ObservationClock {
  jobs = new Map<number, () => void>();
  after = (_delay: number, action: () => void) => {
    const key = ++this.sequence;
    this.jobs.set(key, action);
    return () => {
      this.jobs.delete(key);
    };
  };
  private sequence = 0;
  run() {
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    jobs.forEach((job) => job());
  }
}
const snapshot = (epoch: string, sequence: number, baseline = false, changes = {}) => ({
  ...new WorkspaceFixture().value,
  observation: { epoch, sequence, baseline, changes },
});
function fixture() {
  let receive!: Parameters<ObservationAdapters["transport"]["subscribe"]>[0];
  const clock = new Clock(),
    reads: {
      signal: AbortSignal;
      resolve: (value: WorkspaceSnapshot) => void;
      reject: (error: Error) => void;
    }[] = [];
  const published: WorkspaceSnapshot[] = [],
    invalidations: unknown[] = [],
    errors: string[] = [];
  let detached = 0,
    unsubscribed = 0,
    connections = 0;
  let disconnected!: () => void;
  const owner = new WorkspaceObservation(snapshot("first", 1, true), {
    transport: {
      current: () => ({}),
      subscribe: (listener) => {
        receive = listener;
        return () => {
          unsubscribed++;
        };
      },
      connect: () => {
        connections++;
        return new Promise<void>((resolve) => {
          disconnected = resolve;
        });
      },
      detach: () => {
        detached++;
      },
      publish: (value) => {
        published.push(value);
      },
    },
    baseline: (signal) =>
      new Promise((resolve, reject) => {
        reads.push({ signal, resolve, reject });
      }),
    invalidate: async (scope) => {
      invalidations.push(scope);
    },
    error: (error) => {
      errors.push(error);
    },
    clock,
  });
  return {
    owner,
    reads,
    clock,
    invalidations,
    published,
    errors,
    state: (value: WorkspaceSnapshot) =>
      receive.state(Schema.encodeSync(WorkspaceStateJson)({ workspace: value })),
    custom: (event: { name: string; value: unknown }) => receive.custom(event),
    malformed: () => receive.state({ workspace: { busy: "invalid" } }),
    disconnect: () => disconnected(),
    counts: () => ({ detached, unsubscribed, connections }),
  };
}

test("complete observation excludes retired baselines and coalesces gaps with explicit refresh", async () => {
  const f = fixture();
  await tick();
  const refresh = f.owner.refresh();
  f.state(snapshot("first", 4));
  assert.equal(f.reads.length, 1);
  f.state(snapshot("second", 1, true));
  f.reads[0]!.resolve(snapshot("first", 5, true));
  await refresh;
  await tick();
  assert.equal(f.owner.current().workspace.observation?.epoch, "second");
  assert.equal(f.published[0]!.observation?.epoch, "second");
  assert.equal(f.reads.length, 1);
  f.state(snapshot("second", 3));
  const overlapping = f.owner.refresh();
  assert.equal(f.reads.length, 2);
  f.reads[1]!.resolve(snapshot("second", 3, true));
  await overlapping;
  await tick();
  assert.equal(f.owner.current().workspace.observation?.sequence, 3);
  assert.equal(f.reads.length, 2);
  // Duplicate and reordered updates cannot move state or start recovery.
  f.state(snapshot("second", 2));
  f.state(snapshot("second", 3));
  assert.equal(f.owner.current().workspace.observation?.sequence, 3);
  assert.equal(f.reads.length, 2);
  f.owner.dispose();
});

test("unavailable baselines preserve last valid data and later recovery invalidates off-page IDs", async () => {
  const f = fixture();
  f.malformed();
  f.reads[0]!.reject(new Error("Baseline offline"));
  await tick();
  assert.equal(f.owner.current().workspace.observation?.sequence, 1);
  assert.match(f.owner.current().connectionError, /unavailable/);
  assert.deepEqual(f.errors, ["Baseline offline"]);
  assert.equal(f.clock.jobs.size, 0);
  const refresh = f.owner.refresh();
  f.reads[1]!.resolve(snapshot("first", 8, true, { issues: ["abra-outside-page"] }));
  await refresh;
  f.clock.run();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.invalidations)), [
    { issues: ["abra-outside-page"] },
  ]);
  assert.equal(f.owner.current().connectionError, "");
  f.owner.dispose();
});

test("disposal aborts reads and timers, detaches only observation and suppresses late callbacks", async () => {
  const f = fixture();
  await tick();
  f.state(snapshot("first", 2, false, { issues: ["abra-offpage"] }));
  const pending = f.owner.refresh();
  let callbacks = 0;
  f.owner.subscribe(() => {
    callbacks++;
  });
  f.disconnect();
  await tick();
  assert.equal(f.clock.jobs.size, 2); // invalidation and reconnect; no browser polling timer
  f.owner.dispose();
  assert.equal(f.clock.jobs.size, 0);
  assert.equal(f.reads[0]!.signal.aborted, true);
  f.reads[0]!.resolve(snapshot("replacement", 1, true, { all: true }));
  await pending;
  f.clock.run();
  await tick();
  f.state(snapshot("replacement", 2));
  assert.equal(callbacks, 0);
  assert.equal(f.invalidations.length, 0);
  assert.equal(f.published.length, 0);
  assert.equal(f.owner.current().workspace.observation?.sequence, 2);
  assert.deepEqual(f.counts(), { detached: 1, unsubscribed: 1, connections: 1 });
});

test("a second gap during recovery schedules only the needed follow-up baseline", async () => {
  const f = fixture();
  const first = f.owner.refresh();
  f.state(snapshot("first", 4));
  f.state(snapshot("first", 8));
  f.reads[0]!.resolve(snapshot("first", 4, true));
  await first;
  await tick();
  assert.equal(f.reads.length, 2);
  f.reads[1]!.resolve(snapshot("first", 8, true));
  await tick();
  assert.equal(f.owner.current().workspace.observation?.sequence, 8);
  assert.equal(f.reads.length, 2);
  f.owner.dispose();
});
