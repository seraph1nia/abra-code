import { externalOwns } from "../validation/contracts.ts";
import { admissionWait } from "../observability.ts";
import { ExecutionId, type IssueId, type RepositoryId, type RequestId } from "../identities.ts";
import { Clock, Effect } from "effect";
import { domainEffect } from "../effect.ts";
import {
  CrewError,
  type Execution,
  type Config,
  type ManagedExecution,
  type Project,
  type ReadinessBlocker,
  type Role,
} from "../domain.ts";
import { removeOwnedField, type ExecutionPatch, type Records } from "../storage/store.ts";
import { type Coordination } from "./coordination.ts";

export const consumesWorker = (e: ManagedExecution) =>
  e.current_phase !== "completed" &&
  (externalOwns(e) || !!e.capacity_reservation || (!!e.active_role && !e.capacity_observed_idle));
// Admission covers claiming/provisioning and reserved native work. A durable
// claim, worktree or approval can outlive every turn without owning a slot.
export const consumesRetained = (e: ManagedExecution) =>
  consumesWorker(e) ||
  (!e.capacity_observed_idle &&
    !e.capacity_wait &&
    (e.current_phase === "claiming" || e.current_phase === "provisioning"));

type Owners = ReadonlyMap<ExecutionId, IssueId>;
export type CapacitySummary = {
  retained: Owners;
  active: Owners;
  retainedByRepository: ReadonlyMap<RepositoryId, Owners>;
  activeByRepository: ReadonlyMap<RepositoryId, Owners>;
  byRole: ReadonlyMap<Role, Owners>;
};

export function summarizeCapacity(executions: readonly ManagedExecution[]): CapacitySummary {
  const retained = new Map<ExecutionId, IssueId>();
  const active = new Map<ExecutionId, IssueId>();
  const retainedByRepository = new Map<RepositoryId, Map<ExecutionId, IssueId>>();
  const activeByRepository = new Map<RepositoryId, Map<ExecutionId, IssueId>>();
  const byRole = new Map<Role, Map<ExecutionId, IssueId>>();
  function add<K>(groups: Map<K, Map<ExecutionId, IssueId>>, key: K, execution: ManagedExecution) {
    const owners = groups.get(key) ?? new Map<ExecutionId, IssueId>();
    owners.set(execution.execution_id, execution.issue_id);
    groups.set(key, owners);
  }
  for (const execution of executions) {
    if (!consumesRetained(execution)) continue;
    retained.set(execution.execution_id, execution.issue_id);
    add(retainedByRepository, execution.repository_id, execution);
    if (!consumesWorker(execution)) continue;
    active.set(execution.execution_id, execution.issue_id);
    add(activeByRepository, execution.repository_id, execution);
    const role = execution.capacity_reservation?.role ?? execution.active_role;
    if (role) add(byRole, role, execution);
  }
  return { retained, active, retainedByRepository, activeByRepository, byRole };
}

export function capacitySummaryBlockers(
  config: Config,
  project: Project,
  summary: CapacitySummary,
  role: Role,
  newExecution: boolean,
  own?: ExecutionId,
): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];
  const add = (
    kind: "active" | "retained" | "role",
    label: string,
    owners: Owners | undefined,
    limit: number,
  ) => {
    const count = (owners?.size ?? 0) - (own && owners?.has(own) ? 1 : 0);
    if (count < limit) return;
    const consuming = [...(owners ?? [])].flatMap(([id, issue]) => (id === own ? [] : [issue]));
    blockers.push({
      code: "capacity",
      capacity_kind: kind,
      consuming,
      message: `${label} capacity reached (${consuming.join(", ")})`,
    });
  };
  if (newExecution || (own && !summary.retained.has(own))) {
    add("retained", "Global execution slot", summary.retained, config.max_executions);
    add(
      "retained",
      "Repository execution slot",
      summary.retainedByRepository.get(project.id),
      project.max_executions,
    );
  }
  add("active", "Global active worker", summary.active, config.max_workers);
  add(
    "active",
    "Repository active worker",
    summary.activeByRepository.get(project.id),
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
  add("role", `${role} worker`, summary.byRole.get(role), roleLimit);
  return blockers;
}

export function capacityBlockers(
  config: Config,
  project: Project,
  executions: readonly ManagedExecution[],
  role: Role,
  newExecution: boolean,
  own?: ExecutionId,
) {
  return capacitySummaryBlockers(
    config,
    project,
    summarizeCapacity(executions),
    role,
    newExecution,
    own,
  );
}
/** Native admission reservations are persisted atomically, before resource/session submission. */
export class Capacity {
  constructor(
    private config: Config,
    private records: Records,
    private coordination: Coordination,
  ) {}
  releasePreparation(e: Execution, role: Role) {
    return this.records.coordinateCommit(() =>
      Effect.gen({ self: this }, function* () {
        const current = yield* this.records.execution(e.issue_id);
        const reservation = current?.capacity_reservation;
        if (
          reservation?.status !== "preparing" ||
          reservation.role !== role ||
          reservation.generation !== e.control_generation
        )
          return yield* new CrewError("STALE_OPERATION", "Preparation reservation was superseded");
        yield* this.records.commitOwned(e, {
          capacity_reservation: removeOwnedField,
          capacity_observed_idle: true,
        });
      }),
    );
  }
  reserve(
    e: ManagedExecution,
    role: Role,
    project: Project,
    newExecution = false,
    request?: RequestId,
  ) {
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
          let patch: ExecutionPatch;
          if (blockers.length) {
            yield* admissionWait(role);
            const now = yield* Clock.currentTimeMillis;
            patch = {
              capacity_wait: {
                request_id: request,
                role,
                reasons: blockers.map((b) => b.message),
                consuming: [...new Set(blockers.flatMap((b) => b.consuming ?? []))],
                next_check_at: now + 1000,
              },
            };
          } else {
            patch = {
              capacity_wait: removeOwnedField,
              capacity_observed_idle: false,
              capacity_reservation: {
                role,
                generation: e.control_generation,
                status: "preparing",
                ...(request && { session_id: e[`${role}_session_id`], prompt_id: e.prompt_id }),
              },
            };
          }
          if (newExecution && blockers.length) return false;
          if (newExecution) yield* this.records.create(e, patch);
          else yield* this.records.commitOwned(e, patch);
          return blockers.length === 0;
        }),
      ),
    );
  }
}
