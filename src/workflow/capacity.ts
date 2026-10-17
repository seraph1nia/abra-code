import { externalOwns } from "../validation/contracts.ts";
import { admissionWait } from "../observability.ts";
import { ExecutionId } from "../identities.ts";
import { Clock, Effect } from "effect";
import { domainEffect } from "../effect.ts";
import {
  type Config,
  type ManagedExecution,
  type Project,
  type ReadinessBlocker,
  type Role,
} from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Coordination } from "./coordination.ts";

export const consumesWorker = (e: ManagedExecution) =>
  e.current_phase !== "completed" &&
  (externalOwns(e) || !!e.capacity_reservation || (!!e.active_role && !e.capacity_observed_idle));
export function capacityBlockers(
  config: Config,
  project: Project,
  executions: readonly ManagedExecution[],
  role: Role,
  newExecution: boolean,
  own?: ExecutionId,
): ReadinessBlocker[] {
  const retained = executions.filter(
    (e) => e.current_phase !== "completed" && e.execution_id !== own,
  );
  const active = retained.filter(consumesWorker);
  const blockers: ReadinessBlocker[] = [];
  const add = (
    kind: "active" | "retained" | "role",
    label: string,
    owners: ManagedExecution[],
    limit: number,
  ) => {
    if (owners.length >= limit)
      blockers.push({
        code: "capacity",
        capacity_kind: kind,
        consuming: owners.map((e) => e.issue_id),
        message: `${label} capacity reached (${owners.map((e) => e.issue_id).join(", ")})`,
      });
  };
  if (newExecution) {
    add("retained", "Global retained execution", retained, config.max_executions);
    add(
      "retained",
      "Repository retained execution",
      retained.filter((e) => e.repository_id === project.id),
      project.max_executions,
    );
  }
  add("active", "Global active worker", active, config.max_workers);
  add(
    "active",
    "Repository active worker",
    active.filter((e) => e.repository_id === project.id),
    project.max_workers,
  );
  const roleLimit =
    role === "research"
      ? config.research_capacity
      : role === "explore"
        ? config.explore_capacity
        : role === "review"
          ? config.review_capacity
          : config.max_workers;
  add(
    "role",
    `${role} worker`,
    active.filter((e) => (e.capacity_reservation?.role ?? e.active_role) === role),
    roleLimit,
  );
  return blockers;
}
/** Native admission reservations are persisted atomically, before resource/session submission. */
export class Capacity {
  constructor(
    private config: Config,
    private records: Records,
    private coordination: Coordination,
  ) {}
  reserve(e: ManagedExecution, role: Role, project: Project, newExecution = false) {
    return this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const executions = [
            ...(yield* this.records.executions()),
            ...(yield* this.records.setupScan()).values,
          ];
          const blockers = capacityBlockers(
            this.config,
            project,
            executions,
            role,
            newExecution,
            e.execution_id,
          );
          if (blockers.length) {
            yield* admissionWait(role);
            const now = yield* Clock.currentTimeMillis;
            e.capacity_wait = {
              role,
              reasons: blockers.map((b) => b.message),
              consuming: [...new Set(blockers.flatMap((b) => b.consuming ?? []))],
              next_check_at: now + 1000,
            };
            yield* e.setup === true ? this.records.saveSetup(e) : this.records.save(e);
            return false;
          }
          delete e.capacity_wait;
          e.capacity_observed_idle = false;
          e.capacity_reservation = {
            role,
            generation: e.control_generation,
            status: "preparing",
          };
          yield* e.setup === true ? this.records.saveSetup(e) : this.records.save(e);
          return true;
        }),
      ),
    );
  }
}
