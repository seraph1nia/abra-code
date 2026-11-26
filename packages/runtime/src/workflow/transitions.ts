import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
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
import { type Records, type ExecutionPatch, removeOwnedField } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Queries } from "./queries.ts";

const INTERRUPTED_PHASES = ["blocked", "failed", "interrupted", "recovery_required"] as const;
export const ALLOWED_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  queued: ["claiming", "provisioning", "planning", ...INTERRUPTED_PHASES],
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
  blocked: INTERRUPTED_PHASES,
  interrupted: INTERRUPTED_PHASES,
  failed: INTERRUPTED_PHASES,
  recovery_required: INTERRUPTED_PHASES,
};

type TransitionRecord = Pick<Execution, "current_phase" | "resume_phase" | "stop_status">;
type RecoveryCommand = "replan" | "scope" | "review_retry" | "correction" | "adopt_external";

export function canTransition(
  record: TransitionRecord,
  to: Phase,
  command?: RecoveryCommand,
): boolean {
  if (ALLOWED_TRANSITIONS[record.current_phase].includes(to)) return true;
  if (
    !INTERRUPTED_PHASES.some((phase) => phase === record.current_phase) ||
    record.stop_status === "requested"
  )
    return false;
  if (to === "completed" || to === "queued") return false;
  if (record.resume_phase === to) return true;
  if (command === "review_retry") return record.resume_phase === "verifying" && to === "applying";
  if (record.stop_status) return false;
  switch (command) {
    case "replan":
      return to === "planning";
    case "scope":
      return to === "awaiting_plan_approval";
    case "correction":
      return to === "applying" || to === "planning";
    case "adopt_external":
      return to === "verifying" && record.resume_phase === "validating_external";
    default:
      return false;
  }
}

export function assertTransition(
  record: TransitionRecord,
  to: Phase,
  command?: RecoveryCommand,
): void {
  if (!canTransition(record, to, command))
    throw new WorkflowError(
      "INVALID_TRANSITION",
      `Invalid workflow phase transition: ${record.current_phase} -> ${to}`,
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
    { self: this },
    function* (e: Execution) {
      const stopped = yield* this.sessions.confirmStopped(e);
      return yield* this.records.commitOwned(e, {
        ...stopped,
        stop_status: "confirmed",
        ...(e.operation && { operation: { ...e.operation, status: "stopped" } }),
      });
    },
  );
  pause = Effect.fn("ExecutionTransitions.pause")({ self: this }, function* (id: IssueId) {
    const paused = yield* this.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        let e = yield* this.queries.get(id);
        if (e.pending_issue_status) e = yield* this.operations.reflectIssue(e);
        if (terminal(e))
          return yield* new WorkflowError("CONTROL_PHASE", "Completed work cannot be paused");
        yield* tryDomainValue(assertTransition, e, "interrupted");
        if (
          e.current_phase !== "interrupted" &&
          !(e.resume_phase && ["failed", "blocked", "recovery_required"].includes(e.current_phase))
        )
          e = { ...e, resume_phase: e.current_phase };
        e = { ...e, current_phase: "interrupted" };
        e = { ...e, stop_status: "requested" };
        return yield* this.records.commitControl(e);
      }),
    );
    yield* this.operations.notifyControl(id);
    yield* this.operations.stop(id);
    return yield* this.operations
      .quiescent(id, () =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.queries.get(id);
          if (
            current.stop_status !== "requested" ||
            current.control_generation !== paused.control_generation
          )
            return current;
          return yield* this.confirmStop(current);
        }),
      )
      .pipe(
        Effect.catchIf(
          (error) => error.code === "LOCKED",
          () => this.queries.get(id),
        ),
      );
  });
  move = Effect.fn("ExecutionTransitions.move")(
    { self: this },
    function* (
      e: Execution,
      phase: Phase,
      changes: ExecutionPatch | ((current: ManagedExecution) => ExecutionPatch) = {},
      command?: RecoveryCommand,
    ) {
      yield* tryDomainValue(assertTransition, e, phase, command);
      return yield* this.records.commitOwned(e, (current) => {
        assertTransition(current, phase, command);
        const resolved = typeof changes === "function" ? changes(current) : changes;
        return {
          ...resolved,
          current_phase: phase,
          error_or_recovery_reason: removeOwnedField,
        };
      });
    },
  );
  notice = Effect.fn("ExecutionTransitions.notice")(
    { self: this },
    function* (e: Execution, text: string) {
      if (e.supervisor_session_id)
        yield* this.runtime
          .notify(e.supervisor_session_id, `[AbraCode ${e.issue_id} ${e.current_phase}] ${text}`)
          .pipe(Effect.ignore);
    },
  );
  fail = Effect.fn("ExecutionTransitions.fail")(
    { self: this },
    function* (e: Execution, error: unknown, phase: Phase = "blocked") {
      if (
        error instanceof CrewError &&
        ["STALE_OPERATION", "STALE_REVISION", "STOP_REQUESTED"].includes(error.code)
      )
        return yield* this.queries.get(e.issue_id);
      const reason = CrewError.from(error).message;
      yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          e = yield* this.records.commitOwned(e, () => undefined);
          const release =
            !e.active_role &&
            !e.session_intent &&
            !e.explore_session_id &&
            !e.apply_session_id &&
            !e.review_session_id &&
            !e.research_session_id;

          if (e.pending_issue_status) {
            e = yield* this.operations.reflectIssue(e);
            return;
          }
          yield* tryDomainValue(assertTransition, e, phase);
          const issue =
            phase === "blocked" || phase === "failed"
              ? yield* this.work.show(e.issue_id)
              : undefined;
          const block = issue?.assignee === e.execution_id && issue.status === "in_progress";
          const keepResume = ["blocked", "failed", "recovery_required", "interrupted"].includes(
            e.current_phase,
          );
          e = yield* this.records.commitOwned(e, {
            ...(block && { pending_issue_status: "blocked" }),
            ...(!keepResume && { resume_phase: e.current_phase }),
            current_phase: phase,
            error_or_recovery_reason: reason,
            ...(release && {
              capacity_observed_idle: true,
              capacity_reservation: removeOwnedField,
            }),
          });
          if (block) e = yield* this.operations.reflectIssue(e);
        }),
      );
      yield* this.notice(e, reason);
      return e;
    },
  );
}
