import { Effect, Queue, Ref } from "effect";
import { type Timestamp } from "@abracode/contracts/identities";
import type { ChangeScope } from "@abracode/contracts/web/changes";
import { CrewError } from "../domain.ts";
import { type Queries, type ReadBundle } from "../workflow/queries.ts";
import { committedScope } from "./invalidations.ts";
import { type WorkSnapshot } from "./protocol.ts";

export type FleetCacheEntry = {
  data: NonNullable<WorkSnapshot["fleet"]>;
  at: Timestamp;
  workRevision: string;
  recordsRevision?: string;
  epoch: number;
};

type FleetCacheState = {
  finderObserved: boolean;
  fleetEpoch: number;
  fleetFailed: boolean;
  fleet?: FleetCacheEntry;
};

export class FleetCache {
  private readonly state = Ref.makeUnsafe<FleetCacheState>({
    finderObserved: false,
    fleetEpoch: 0,
    fleetFailed: false,
  });

  constructor(private readonly finderRequests?: Queue.Queue<void>) {}

  readonly requestFinderRefresh = Effect.gen({ self: this }, function* () {
    const { finderObserved } = yield* Ref.get(this.state);
    if (finderObserved && this.finderRequests) {
      yield* Queue.offer(this.finderRequests, undefined);
    }
  });

  invalidateFinder = (scope: ChangeScope) =>
    Effect.suspend(() => {
      if (!(scope.all || scope.projects || scope.work_all || scope.finder || scope.issues?.length))
        return Effect.void;
      return Ref.update(this.state, (current) => ({
        ...current,
        fleetEpoch: current.fleetEpoch + 1,
      })).pipe(Effect.andThen(this.requestFinderRefresh));
    });

  refreshFinder = (
    queries: Queries,
    snapshot: (
      closedPage?: number,
      bundle?: ReadBundle,
      includeLeads?: boolean,
    ) => Effect.Effect<WorkSnapshot, CrewError>,
  ) =>
    Effect.gen({ self: this }, function* () {
      const { fleetEpoch: epoch } = yield* Ref.get(this.state);
      const observation = yield* Effect.gen(function* () {
        const bundle = yield* queries.observe();
        if (yield* queries.refreshFinderReadiness(bundle)) yield* committedScope({ fleet: true });
        const snap = yield* snapshot(undefined, bundle, false);
        if (!snap.fleet)
          return yield* new CrewError("OBSERVATION_UNAVAILABLE", "Fleet evidence is unavailable");
        return {
          data: snap.fleet,
          at: snap.at,
          workRevision: bundle.source.work_revision,
          recordsRevision: bundle.recordsRevision,
          epoch,
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(new CrewError("OBSERVATION_UNAVAILABLE", "Fleet refresh timed out")),
        }),
        Effect.result,
      );
      if (observation._tag === "Failure") {
        const changed = yield* Ref.modify(
          this.state,
          (current) => [!current.fleetFailed, { ...current, fleetFailed: true }] as const,
        );
        if (changed) yield* committedScope({ fleet: true });
        return;
      }
      const next = observation.success;
      const changed = yield* Ref.modify(this.state, (current) => {
        const previous = current.fleet;
        const didChange =
          current.fleetFailed ||
          !previous ||
          previous.epoch !== next.epoch ||
          previous.workRevision !== next.workRevision ||
          previous.recordsRevision !== next.recordsRevision ||
          JSON.stringify(previous.data) !== JSON.stringify(next.data);
        return [didChange, { ...current, fleetFailed: false, fleet: next }] as const;
      });
      if (changed) yield* committedScope({ fleet: true });
    });

  observeForFinder = (workRevision: string, recordsRevision?: string) =>
    Effect.gen({ self: this }, function* () {
      const result = yield* Ref.modify(this.state, (current) => {
        const fleet = current.fleet;
        const fleetCurrent = Boolean(
          fleet &&
          !current.fleetFailed &&
          fleet.epoch === current.fleetEpoch &&
          fleet.workRevision === workRevision &&
          fleet.recordsRevision === recordsRevision,
        );
        const firstRequest = !current.finderObserved;
        return [
          {
            fleet,
            fleetCurrent,
            shouldRefresh: firstRequest || Boolean(fleet && !fleetCurrent),
          },
          { ...current, finderObserved: true },
        ] as const;
      });
      if (result.shouldRefresh) yield* this.requestFinderRefresh;
      return result;
    });
}
