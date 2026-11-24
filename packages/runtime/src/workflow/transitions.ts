import { type IssueId } from "@abracode/contracts/identities";
import { type Operations } from "./operations.ts";
import { type WorkerSessions } from "./sessions.ts";
import { Effect } from "effect";
import {
  CrewError,
  terminal,
  type Execution,
  type ManagedExecution,
  type Phase,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records, type ExecutionPatch, removeOwnedField } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Queries } from "./queries.ts";

const INTERRUPTED_PHASES = ["blocked", "failed", "interrupted", "recovery_required"] as const;
const ACTIVE_PHASES = [
  "claiming",
  "provisioning",
  "exploring",
  "planning",
  "awaiting_plan_approval",
  "researching",
  "applying",
  "validating_external",
  "verifying",
  "archiving",
  "delivering",
  "awaiting_merge",
  "cleaning",
] as const;

export const ALLOWED_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  queued: ["claiming", "provisioning", "planning", "completed", ...INTERRUPTED_PHASES],
  claiming: ["provisioning", "planning", "awaiting_plan_approval", ...INTERRUPTED_PHASES],
  provisioning: ["exploring", "planning", "awaiting_plan_approval", ...INTERRUPTED_PHASES],
  exploring: ["planning", "awaiting_plan_approval", ...INTERRUPTED_PHASES],
  planning: ["planning", "awaiting_plan_approval", ...INTERRUPTED_PHASES],
  awaiting_plan_approval: [
    "awaiting_plan_approval",
    "planning",
    "applying",
    "researching",
    "verifying",
    ...INTERRUPTED_PHASES,
  ],
  researching: ["planning", "awaiting_plan_approval", "cleaning", ...INTERRUPTED_PHASES],
  applying: [
    "applying",
    "planning",
    "awaiting_plan_approval",
    "validating_external",
    "verifying",
    ...INTERRUPTED_PHASES,
  ],
  validating_external: [
    "validating_external",
    "planning",
    "awaiting_plan_approval",
    "verifying",
    ...INTERRUPTED_PHASES,
  ],
  verifying: ["planning", "awaiting_plan_approval", "applying", "archiving", ...INTERRUPTED_PHASES],
  archiving: ["delivering", "planning", "applying", ...INTERRUPTED_PHASES],
  delivering: ["awaiting_merge", "planning", "applying", ...INTERRUPTED_PHASES],
  awaiting_merge: ["cleaning", "planning", "applying", "verifying", ...INTERRUPTED_PHASES],
  cleaning: ["completed", ...INTERRUPTED_PHASES],
  completed: [],
  blocked: [...ACTIVE_PHASES, ...INTERRUPTED_PHASES],
  interrupted: [...ACTIVE_PHASES, ...INTERRUPTED_PHASES],
  failed: [...ACTIVE_PHASES, ...INTERRUPTED_PHASES],
  recovery_required: [...ACTIVE_PHASES, ...INTERRUPTED_PHASES],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Phase, to: Phase): void {
  if (!canTransition(from, to))
    throw new CrewError(
      "INVALID_TRANSITION",
      `Invalid workflow phase transition: ${from} -> ${to}`,
    );
}

export interface DeliveryArtifactResetOptions {
  readonly clearDeliveryArtifacts?: boolean;
  readonly clearDeliveredCommit?: boolean;
  readonly clearForgeObservation?: boolean;
  readonly clearReviewSession?: boolean;
  readonly clearPlanningArtifacts?: boolean;
  readonly clearReportArtifacts?: boolean;
}

/** Shared typed field-removal patch for resetting delivery/verification/planning artifacts. */
export function resetDeliveryArtifactsPatch(
  options: DeliveryArtifactResetOptions = {},
): ExecutionPatch {
  return {
    verification_receipt: removeOwnedField,
    review_receipt: removeOwnedField,
    active_role: removeOwnedField,
    capacity_reservation: removeOwnedField,
    ...(options.clearDeliveryArtifacts && {
      delivery_receipt: removeOwnedField,
      delivery_wait: removeOwnedField,
      archive_path: removeOwnedField,
      archived_tree: removeOwnedField,
    }),
    ...(options.clearDeliveredCommit && { delivered_commit: removeOwnedField }),
    ...(options.clearForgeObservation && { forge_observation: removeOwnedField }),
    ...(options.clearReviewSession && { review_session_id: removeOwnedField }),
    ...(options.clearPlanningArtifacts && {
      plan_fingerprint: removeOwnedField,
      explore_session_id: removeOwnedField,
      apply_session_id: removeOwnedField,
      review_session_id: removeOwnedField,
    }),
    ...(options.clearReportArtifacts && {
      report_intent: removeOwnedField,
      report_receipt: removeOwnedField,
      report_acceptance_met: removeOwnedField,
    }),
  };
}

/** In-place variant for control-generation saves (e.g. scope revisions) that write the full aggregate. */
export function resetDeliveryArtifacts(
  e: Execution,
  options: DeliveryArtifactResetOptions = {},
): void {
  const patch = resetDeliveryArtifactsPatch(options);
  for (const field of Object.keys(patch)) Reflect.deleteProperty(e, field);
}

/** Phase writes, failure reflection and notifications share one lifecycle implementation. */
export class ExecutionTransitions {
  constructor(
    private records: Records,
    private work: WorkGraph,
    private runtime: Runtime,
    private coordination: Coordination,
    private queries: Pick<Queries, "get">,
    private operations: Operations,
    private sessions: WorkerSessions,
  ) {}
  confirmStop = Effect.fn("ExecutionTransitions.confirmStop")(
    function* (this: ExecutionTransitions, e: Execution) {
      const stopped = yield* this.sessions.confirmStopped(e);
      return yield* this.records.commitOwned(e, {
        ...stopped,
        stop_status: "confirmed",
        ...(e.operation && { operation: { ...e.operation, status: "stopped" } }),
      });
    }.bind(this),
    domainEffect,
  );
  pause = Effect.fn("ExecutionTransitions.pause")(
    function* (this: ExecutionTransitions, id: IssueId) {
      yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.queries.get(id);
            if (terminal(e))
              return yield* new CrewError("CONTROL_PHASE", "Completed work cannot be paused");
            assertTransition(e.current_phase, "interrupted");
            if (
              e.current_phase !== "interrupted" &&
              !(
                e.resume_phase &&
                ["failed", "blocked", "recovery_required"].includes(e.current_phase)
              )
            )
              e.resume_phase = e.current_phase;
            e.current_phase = "interrupted";
            e.stop_status = "requested";
            return yield* this.records.saveControl(e);
          }),
        ),
      );
      yield* this.operations.notifyControl(id);
      yield* this.operations.stop(id);
      return yield* this.operations
        .quiescent(id, () =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const current = yield* this.queries.get(id);
              return yield* this.confirmStop(current);
            }),
          ),
        )
        .pipe(
          Effect.catchIf(
            (error) => error.code === "LOCKED",
            () => this.queries.get(id),
          ),
        );
    }.bind(this),
    domainEffect,
  );
  move = Effect.fn("ExecutionTransitions.move")(
    function* (
      this: ExecutionTransitions,
      e: Execution,
      phase: Phase,
      changes: ExecutionPatch | ((current: ManagedExecution) => ExecutionPatch) = {},
    ) {
      assertTransition(e.current_phase, phase);
      return yield* this.records.commitOwned(e, (current) => {
        assertTransition(current.current_phase, phase);
        const resolved = typeof changes === "function" ? changes(current) : changes;
        return {
          ...resolved,
          current_phase: phase,
          error_or_recovery_reason: removeOwnedField,
        };
      });
    }.bind(this),
    domainEffect,
  );
  notice = Effect.fn("ExecutionTransitions.notice")(
    function* (this: ExecutionTransitions, e: Execution, text: string) {
      if (e.supervisor_session_id)
        yield* this.runtime
          .notify(e.supervisor_session_id, `[AbraCode ${e.issue_id} ${e.current_phase}] ${text}`)
          .pipe(Effect.catch(() => domainEffect(Effect.sync(() => {}))));
    }.bind(this),
    domainEffect,
  );
  fail = Effect.fn("ExecutionTransitions.fail")(
    function* (this: ExecutionTransitions, e: Execution, error: unknown, phase: Phase = "blocked") {
      if (
        error instanceof CrewError &&
        ["STALE_OPERATION", "STALE_REVISION", "STOP_REQUESTED"].includes(error.code)
      )
        return yield* this.queries.get(e.issue_id);
      const reason = CrewError.from(error).message;
      const release =
        !e.active_role &&
        !e.session_intent &&
        !e.explore_session_id &&
        !e.apply_session_id &&
        !e.review_session_id &&
        !e.research_session_id;
      yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            assertTransition(e.current_phase, phase);
            const keepResume = ["blocked", "failed", "recovery_required", "interrupted"].includes(
              e.current_phase,
            );
            yield* this.records.commitOwned(e, {
              ...(!keepResume && { resume_phase: e.current_phase }),
              current_phase: phase,
              error_or_recovery_reason: reason,
              ...(release && {
                capacity_observed_idle: true,
                capacity_reservation: removeOwnedField,
              }),
            });
            if (phase === "blocked" || phase === "failed") {
              const issue = yield* this.work.show(e.issue_id);
              if (issue.assignee === e.execution_id && issue.status === "in_progress")
                yield* this.work.block(e.issue_id, e.execution_id, reason);
            }
          }),
        ),
      );
      yield* this.notice(e, reason);
      return e;
    }.bind(this),
    domainEffect,
  );
}
