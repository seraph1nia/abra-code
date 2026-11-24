import type { SessionInspection } from "./session-inspection.ts";
import type { PlanningBaselines } from "./planning.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import { WorkerContexts, readWorkerContext } from "./worker-context.ts";
import { Messages } from "./messages.ts";
import {
  messageRequests,
  requiresResponse,
  needsDisposition,
  requestPromptIDs,
} from "@abracode/contracts/workflow/message-contracts";
import { join } from "node:path";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { synchronizeExecution, removeOwnedField, type Records } from "../storage/store.ts";
import {
  SessionId,
  IssueId,
  Timestamp,
  timestamp,
  timestampAt,
} from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import {
  CrewError,
  ensure,
  type Config,
  type Execution,
  type Role,
  type WorkerError,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";

import { type Runtime, type SessionState } from "../opencode/runtime.ts";
import { diagnosticError } from "../opencode/diagnostics.ts";
import { type Capacity } from "./capacity.ts";
import { type Coordination } from "./coordination.ts";
import { type Queries } from "./queries.ts";
import { type Git } from "../git/repository.ts";
import { isActiveWorker, nativeSessionIntent, workerSessionID } from "./worker-assignment.ts";
import { type AttentionService } from "./attention.ts";

export { workerSessionID } from "./worker-assignment.ts";
const idleCapacity = {
  capacity_observed_idle: true,
  capacity_reservation: removeOwnedField,
} as const;
type WorkerTurn =
  | { kind: "absent" }
  | { kind: "waiting" }
  | { kind: "unadmitted"; sessionID: SessionId; outcome?: SessionState["outcome"] }
  | { kind: "completed"; role: Role }
  | {
      kind: "stopped";
      phase: "failed" | "interrupted";
      error: CrewError;
      failure?: Execution["worker_failure"];
    };
type ReconciledTurn = Exclude<WorkerTurn, { kind: "unadmitted" }>;
/** Owns native admission, model selection, stop confirmation and worker observations. */
export class WorkerSessions {
  constructor(
    private config: Config,
    private records: Records,
    private runtime: Runtime,
    private capacity: Capacity,
    private coordination: Coordination,
    private queries: Queries,
    private git: Git,
    private spec: OpenSpec,
    attention: AttentionService,
    private inspection: SessionInspection,
    private planning: Pick<PlanningBaselines, "beforeAdmission" | "preparedAdmission">,
    assets?: string,
  ) {
    this.contexts = new WorkerContexts(records, config, assets);
    this.messages = new Messages(records, runtime, capacity, queries, attention);
  }
  recordFailure = Effect.fn("WorkerSessions.recordFailure")(
    function* (this: WorkerSessions, sessionID: SessionId, error: WorkerError) {
      return yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.records.workerAssignment(sessionID);
            if (!e || e.current_phase === "completed") return;
            const role = (["explore", "apply", "review", "research"] as const).find(
              (r) => this.sessionID(e, r) === sessionID,
            );
            if (!role || role !== e.active_role) return;
            // Native failure events carry no prompt ID and may arrive after
            // reconciliation has already stopped this turn with exact evidence.
            // Preserve that stronger observation rather than erasing its binding.
            const prior = e.worker_failure;
            if (
              !isActiveWorker(e, sessionID, { role }) &&
              prior?.session_id === sessionID &&
              prior.prompt_id &&
              (prior.prompt_id === e.prompt_id ||
                messageRequests(e.messages).some(
                  (m) =>
                    m.generation === e.control_generation &&
                    m.assignment_id === e.prompt_id &&
                    requestPromptIDs(m).includes(prior.prompt_id!),
                ))
            )
              return;
            yield* this.records.commitOwned(e, {
              worker_failure: {
                prompt_id: messageRequests(e.messages).some(
                  (m) =>
                    m.assignment_id === e.prompt_id &&
                    ["admission_uncertain", "admitted", "acknowledged", "answered"].includes(
                      m.status,
                    ),
                )
                  ? undefined
                  : e.prompt_id,
                session_id: sessionID,
                role,
                error: diagnosticError(error),
                at: yield* timestamp,
              },
            });
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  readonly contexts: WorkerContexts;
  readonly messages: Messages;
  private sessionID = workerSessionID;
  private project = (e: Execution) => this.queries.effectiveProject(e);
  private observe = Effect.fn("WorkerSessions.observe")(
    function* (this: WorkerSessions, e: Execution): Effect.fn.Return<WorkerTurn, CrewError> {
      if (!e.active_role) return { kind: "absent" };
      if (!(yield* this.messages.reconcile(e))) return { kind: "waiting" };
      let state = yield* this.runtime.session(this.sessionID(e)!, e.prompt_id);
      if (state.busy || state.completion_pending) return { kind: "waiting" };
      if (state.assignment) {
        if (state.assignment.outcome === "failed" || state.assignment.outcome === "interrupted")
          state = {
            ...state,
            outcome: state.assignment.outcome,
            outcome_prompt_id: state.assignment.id,
            error: state.assignment.error,
            error_at: state.assignment.at,
          };
        else if (state.outcome === "succeeded" && state.assignment.outcome !== "succeeded")
          return { kind: "unadmitted", sessionID: state.id };
      }
      if (state.outcome) {
        const current = yield* this.records.execution(e.issue_id);
        if (
          !(
            current &&
            current.control_generation === e.control_generation &&
            current.prompt_id === e.prompt_id
          )
        )
          return yield* new CrewError("STALE_OPERATION", "Worker observation was superseded");
        // A reporting tool can commit while the native completion read is in flight.
        synchronizeExecution(e, current);
      }
      if (state.outcome === "succeeded") {
        if (
          messageRequests(e.messages).some(
            (m) =>
              m.generation === e.control_generation &&
              m.assignment_id === e.prompt_id &&
              requiresResponse(m),
          )
        ) {
          yield* this.records.commitOwned(e, idleCapacity);
          yield* this.messages.recover(e);
          return { kind: "waiting" };
        }
        return { kind: "completed", role: e.active_role };
      }
      if (state.outcome === "failed" || state.outcome === "interrupted") {
        yield* this.messages.recover(e);
        return {
          kind: "stopped",
          phase: state.outcome,
          ...this.stoppedWorker(e, state, yield* timestamp),
        };
      }
      return { kind: "unadmitted", sessionID: state.id, outcome: state.outcome };
    }.bind(this),
    domainEffect,
  );
  /** An open obligation can outlast the turn that raised it. Observe without waking it. */
  releaseWaitingTurn = Effect.fn("WorkerSessions.releaseWaitingTurn")(
    function* (this: WorkerSessions, e: Execution) {
      const session = this.sessionID(e);
      const reservation = e.capacity_reservation;
      if (!session || !e.prompt_id || (!reservation && e.capacity_observed_idle)) return;
      if (
        reservation &&
        (reservation.session_id !== session || reservation.prompt_id !== e.prompt_id)
      )
        return;
      const revision = e.revision;
      const observed = yield* this.runtime.session(session, e.prompt_id).pipe(Effect.result);
      // Keep the open question and its reservation when native evidence is unavailable.
      if (observed._tag === "Failure") return;
      const state = observed.success;
      if (state.busy || state.completion_pending || !state.outcome) return;
      if (state.assignment?.id !== e.prompt_id || !state.assignment.outcome) return;
      const requests = messageRequests(e.messages).filter(
        (m) => m.generation === e.control_generation && m.assignment_id === e.prompt_id,
      );
      if (
        requests.some(
          (m) =>
            m.status === "admission_uncertain" ||
            m.response_recovery?.status === "admission_uncertain" ||
            (reservation?.status === "preparing" &&
              (m.status === "pending" || m.response_recovery?.status === "pending")),
        )
      )
        return;
      yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          // A concurrent steer or control change invalidates this native observation.
          const current = yield* this.records.execution(e.issue_id);
          if (current?.revision === revision) yield* this.records.commitOwned(e, idleCapacity);
        }),
      );
    }.bind(this),
    domainEffect,
  );
  /** Observe completion only: an explicit checkpoint never recovers prompt admission. */
  requireCompleted = Effect.fn("WorkerSessions.requireCompleted")(
    function* (this: WorkerSessions, e: Execution) {
      const turn = yield* this.observe(e);
      if (turn.kind === "absent") return;
      if (turn.kind === "waiting")
        return yield* new CrewError("WRITER_BUSY", "A managed session still runs in this worktree");
      if (turn.kind === "stopped" && turn.phase === "failed") {
        yield* this.records.commitOwned(e, {
          ...idleCapacity,
          ...(turn.failure && { worker_failure: turn.failure }),
        });
        return yield* turn.error;
      }
      yield* this.records.commitOwned(e, idleCapacity);
      if (turn.kind !== "completed") {
        const outcome = turn.kind === "stopped" ? turn.phase : (turn.outcome ?? "unknown");
        return yield* new CrewError("SESSION_OUTCOME", `Worker outcome is ${outcome}`);
      }
      if (turn.role === "apply" && e.worktree_directory && e.apply_session_id && e.prompt_id) {
        e.finishing = {
          ...e.finishing,
          schema_version: 1,
          attribution: {
            schema_version: 1,
            generation: e.control_generation,
            fingerprint: yield* this.git.fingerprint(e.worktree_directory),
            head: yield* this.git.head(e.worktree_directory),
            session_id: e.apply_session_id,
            prompt_id: e.prompt_id,
            at: yield* timestamp,
          },
        };
        yield* this.records.saveFinishing(e, ["attribution"]);
      }
      yield* this.records.commitOwned(e, { active_role: removeOwnedField });
      return turn.role;
    }.bind(this),
    domainEffect,
  );
  /** Recover retained identities; only the controller may authorize a fresh turn. */
  reconcile = Effect.fn("WorkerSessions.reconcile")(
    function* (this: WorkerSessions, e: Execution): Effect.fn.Return<ReconciledTurn, CrewError> {
      const turn = yield* this.observe(e);
      if (turn.kind === "absent") {
        if (!e.session_intent) return turn;
        yield* this.admit(e, e.session_intent.role);
        return { kind: "waiting" };
      }
      if (
        turn.kind === "completed" ||
        turn.kind === "stopped" ||
        (turn.kind === "unadmitted" && turn.outcome)
      )
        yield* this.records.commitOwned(e, idleCapacity);
      if (turn.kind === "stopped" && turn.failure) {
        yield* this.records.commitOwned(e, { worker_failure: turn.failure });
      }
      if (turn.kind !== "unadmitted") return turn;
      if (!e.prompt_id)
        return yield* new CrewError("PROMPT_AMBIGUOUS", "No persisted prompt admission ID");
      yield* this.planning.beforeAdmission(e, e.active_role!);
      const selection = yield* this.runtime
        .preflight(e, e.active_role!, e.prompt_id)
        .pipe(Effect.tapError((error) => this.contexts.failure(e, e.active_role!, error)));
      if (!selection) return { kind: "waiting" };
      if (!e.worker_context_id)
        return yield* new CrewError(
          "LEGACY_CONTEXT",
          "Unadmitted legacy prompt has no captured payload; inspect native evidence and explicitly retry a new turn",
        );
      const context = yield* readWorkerContext(this.records.store, e.worker_context_id);
      yield* this.runtime.prompt(turn.sessionID, context.prompt, e.prompt_id);
      return { kind: "waiting" };
    }.bind(this),
    domainEffect,
  );
  validateLocations = (e: Execution) => this.inspection.validateLocations(e);
  idle = (e: Execution) => this.inspection.idle(e);
  launch = (e: Execution, role: Role) => this.admit(e, role);
  notifyCompletion = (
    session: SessionId,
    message: import("@abracode/contracts/identities").MessageId,
    issue: IssueId,
  ) =>
    this.runtime.notify(
      session,
      `[AbraCode ${issue} completed] Delivery confirmed, worktree retired, issue closed. Dependent work recalculated.`,
      message,
    );
  private admit = Effect.fn("WorkerSessions.admit")(
    function* (this: WorkerSessions, e: Execution, role: Role) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "Return external branch custody before admitting a native writer or changing its scope",
        );
      yield* this.idle(e);
      yield* this.planning.beforeAdmission(e, role);
      if (e.workflow_policy === "full-openspec") yield* this.spec.assertSchema(e);
      const project = yield* this.project(e);
      if (!(yield* this.capacity.reserve(e, role, project))) return;
      let loadedIssue: import("../domain.ts").Issue | undefined;
      const loadIssue = () =>
        loadedIssue
          ? Effect.succeed(loadedIssue)
          : this.queries.issue(e.issue_id).pipe(
              Effect.tap((issue) =>
                Effect.sync(() => {
                  loadedIssue = issue;
                }),
              ),
            );
      if (e.configuration_snapshot?.agent_selection_version === 1) {
        const intent = e.session_intent ?? {
          role,
          id: this.sessionID(e, role) ?? Session.ID.create(),
          prompt: SessionMessage.ID.create(),
        };
        if (intent.role !== role || !intent.prompt)
          return yield* new CrewError(
            "PREPARATION_INTENT",
            "Retained preparation identity conflicts with the assigned role",
          );
        yield* this.records.commitOwned(e, { session_intent: intent });
        yield* this.contexts.prepareAgent(e, role, yield* loadIssue(), intent.prompt).pipe(
          Effect.onInterrupt(() => this.capacity.releasePreparation(e, role)),
          Effect.tapError((error) => this.contexts.failure(e, role, error)),
          Effect.tapError(() => this.capacity.releasePreparation(e, role)),
        );
      }
      const environment = yield* this.runtime.preflight(e, role).pipe(
        Effect.tapError((error) => this.contexts.failure(e, role, error)),
        Effect.tapError(() => this.capacity.releasePreparation(e, role)),
      );
      if (!environment)
        return yield* new CrewError(
          "CONTEXT_SELECTION",
          "New worker admission requires resolved environment",
        );
      if (e.session_intent?.prompt) {
        yield* this.records.commitOwned(e, {
          session_intent: { ...e.session_intent, native_started: true },
        });
      }
      let id = this.sessionID(e, role);
      if (!id) {
        const intent = e.session_intent ?? { role, id: Session.ID.create() };
        if (intent.role !== role)
          return yield* new CrewError(
            "SESSION_INTENT",
            "A different role has an unresolved session intent",
          );
        yield* this.records.commitOwned(e, { session_intent: intent });
        // Native create accepts a client-generated ID. A missing-response retry cannot create a second session.
        id = yield* this.runtime.createSession(e, role, intent.id);
      } else yield* this.runtime.refreshPermissions(e, role, id);
      yield* this.runtime.switchAgent(id, environment.agent);
      const model = environment.model;
      if (model) yield* this.runtime.switchModel(id, model);
      const prompt = e.session_intent?.prompt ?? SessionMessage.ID.create();
      const artifacts =
        e.workflow_policy === "full-openspec"
          ? (yield* this.queries.specStatus(e)).artifacts.map((artifact) =>
              join(
                e.worktree_directory!,
                "openspec/changes",
                e.openspec_change,
                artifact.outputPath,
              ),
            )
          : [];
      const assignment = { [`${role}_session_id`]: id, active_role: role, prompt_id: prompt };
      const context = yield* this.contexts.prepare(
        { ...e, ...assignment },
        role,
        yield* loadIssue(),
        environment,
        id,
        prompt,
        artifacts,
      );
      yield* this.records.commitOwned(e, {
        ...assignment,
        session_intent: removeOwnedField,
        resume_after_decision: removeOwnedField,
        ...(e.messages && {
          messages: e.messages.map((m) =>
            m.type !== "finding" && needsDisposition(m)
              ? { ...m, status: "superseded" as const }
              : m,
          ),
        }),
        worker_started_at: yield* Clock.currentTimeMillis,
        progress: removeOwnedField,
        capacity_reservation: {
          role,
          generation: e.control_generation,
          status: "uncertain",
          session_id: id,
          prompt_id: prompt,
        },
        worker_context_id: context.prompt_id,
      });
      yield* this.planning.preparedAdmission(e, role);
      yield* this.runtime.prompt(id, context.prompt, prompt);
      const saved = yield* this.records.update(e.issue_id, (current) => {
        ensure(
          current.control_generation === e.control_generation && current.prompt_id === e.prompt_id,
          "STALE_OPERATION",
          "Prompt admission was superseded",
        );
        return {
          ...current,
          capacity_reservation: {
            role,
            generation: current.control_generation,
            status: "admitted",
            session_id: id,
            prompt_id: e.prompt_id,
          },
        };
      });
      synchronizeExecution(e, saved);
    }.bind(this),
    domainEffect,
  );
  /** Called under exclusive execution ownership, outside shared coordination. */
  confirmStopped = Effect.fn("WorkerSessions.confirmStopped")(
    function* (this: WorkerSessions, e: Execution) {
      const intent = nativeSessionIntent(e);
      if (intent) {
        const state = yield* this.runtime.session(intent.id);
        yield* this.runtime.interrupt(state.id, e.prompt_id);
      }
      for (const role of ["explore", "apply", "review", "research"] as const) {
        const sid = this.sessionID(e, role);
        if (sid) {
          const followups = messageRequests(e.messages)
            .filter((m) => m.recipient_session_id === sid && m.status !== "cancelled")
            .flatMap(requestPromptIDs);
          yield* this.runtime.interrupt(sid, e.prompt_id, followups);
        }
      }
      yield* this.idle(e);
      return {
        ...idleCapacity,
        active_role: removeOwnedField,
        ...(e.session_intent?.prompt && !e.session_intent.native_started
          ? ({ session_intent: removeOwnedField } as const)
          : {}),
      } as const;
    }.bind(this),
    domainEffect,
  );
  private stoppedWorker(e: Execution, state: SessionState, observedAt: Timestamp) {
    const failure = state.error
      ? {
          prompt_id: state.outcome_prompt_id ?? e.prompt_id,
          session_id: state.id,
          role: e.active_role,
          model: state.model,
          error: diagnosticError(state.error),
          at: state.error_at === undefined ? observedAt : timestampAt(state.error_at),
        }
      : undefined;
    const error =
      state.error ??
      (state.outcome === "failed" && e.worker_failure?.session_id === state.id
        ? e.worker_failure.error
        : undefined);
    const detail = error
      ? `: ${error.type}${error.status ? ` (${error.status})` : ""}: ${error.message}`
      : "";
    const model = state.model ? ` using ${state.model.providerID}/${state.model.id}` : "";
    return {
      failure,
      error: new CrewError(
        "WORKER_STOPPED",
        `Session ${state.id} ${state.outcome}${model}${detail}`,
      ),
    };
  }
}
