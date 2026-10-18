import { WorkerContexts, readWorkerContext } from "./worker-context.ts";
import { Messages } from "./messages.ts";
import {
  messageRequests,
  requiresResponse,
  needsDisposition,
  requestPromptIDs,
} from "./message-contracts.ts";
import { join } from "node:path";
import { externalOwns } from "../validation/contracts.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";
import { SessionId, IssueId, Timestamp, timestamp } from "../identities.ts";
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
import { isActiveWorker, workerSessionID } from "./worker-assignment.ts";
import { type AttentionService } from "./attention.ts";

export { workerSessionID } from "./worker-assignment.ts";
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
    attention: AttentionService,
  ) {
    this.contexts = new WorkerContexts(records, config);
    this.messages = new Messages(records, runtime, capacity, queries, attention);
  }
  recordFailure = Effect.fn("WorkerSessions.recordFailure")(
    function* (this: WorkerSessions, sessionID: SessionId, error: WorkerError) {
      return yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = (yield* this.records.executions()).find((entry) =>
              (["explore", "apply", "review", "research"] as const).some(
                (role) => this.sessionID(entry, role) === sessionID,
              ),
            );
            if (!e || e.current_phase === "completed") return;
            const role = (["explore", "apply", "review", "research"] as const).find(
              (r) => this.sessionID(e, r) === sessionID,
            );
            if (role !== e.active_role) return;
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
            e.worker_failure = {
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
            };
            yield* this.records.save(e);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  private contexts: WorkerContexts;
  readonly messages: Messages;
  private sessionID = workerSessionID;
  private project = (e: Execution) => this.queries.effectiveProject(e);
  private get = (id: IssueId) => this.queries.get(id);
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
        e.capacity_observed_idle = true;
        delete e.capacity_reservation;
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
          yield* this.records.save(e);
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
  /** Observe completion only: an explicit checkpoint never recovers prompt admission. */
  requireCompleted = Effect.fn("WorkerSessions.requireCompleted")(
    function* (this: WorkerSessions, e: Execution) {
      const turn = yield* this.observe(e);
      if (turn.kind === "absent") return;
      if (!(turn.kind !== "waiting"))
        return yield* new CrewError("WRITER_BUSY", "A managed session still runs in this worktree");
      e.capacity_observed_idle = true;
      delete e.capacity_reservation;
      if (turn.kind === "stopped" && turn.phase === "failed") {
        if (turn.failure) e.worker_failure = turn.failure;
        return yield* turn.error;
      }
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
      delete e.active_role;
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
        yield* this.records.save(e);
      if (turn.kind === "stopped" && turn.failure) e.worker_failure = turn.failure;
      if (turn.kind !== "unadmitted") return turn;
      if (!e.prompt_id)
        return yield* new CrewError("PROMPT_AMBIGUOUS", "No persisted prompt admission ID");
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
  validateLocations = Effect.fn("WorkerSessions.validateLocations")(
    function* (this: WorkerSessions, e: Execution) {
      for (const role of ["explore", "apply", "review", "research"] as const) {
        const id = this.sessionID(e, role);
        if (id) {
          if (!((yield* this.runtime.session(id)).directory === e.worktree_directory))
            return yield* new CrewError(
              "SESSION_LOCATION",
              "Managed session moved out of owned worktree",
            );
        }
      }
    }.bind(this),
    domainEffect,
  );
  idle = Effect.fn("WorkerSessions.idle")(
    function* (this: WorkerSessions, e: Execution) {
      if (messageRequests(e.messages).some((m) => m.status === "admission_uncertain"))
        return yield* new CrewError(
          "MESSAGE_UNCERTAIN",
          "Pause and confirm native stop before replacing an uncertain instruction",
        );
      for (const role of ["explore", "apply", "review", "research"] as const) {
        const id = this.sessionID(e, role);
        if (id) {
          if ((yield* this.runtime.session(id)).busy)
            return yield* new CrewError(
              "WRITER_BUSY",
              "A managed session still runs in this worktree",
            );
        }
      }
    }.bind(this),
    domainEffect,
  );
  launch = (e: Execution, role: Role) => this.admit(e, role);
  notifyCompletion = (
    session: SessionId,
    message: import("../identities.ts").MessageId,
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
      const project = yield* this.project(e);
      if (!(yield* this.capacity.reserve(e, role, project))) return;
      const environment = yield* this.runtime.preflight(e, role).pipe(
        Effect.tapError((error) => this.contexts.failure(e, role, error)),
        Effect.tapError(() => {
          delete e.capacity_reservation;
          e.capacity_observed_idle = true;
          return this.records.save(e);
        }),
      );
      if (!environment)
        return yield* new CrewError(
          "CONTEXT_SELECTION",
          "New worker admission requires resolved environment",
        );
      let id = this.sessionID(e, role);
      if (!id) {
        e.session_intent ??= { role, id: Session.ID.create() };
        if (!(e.session_intent.role === role))
          return yield* new CrewError(
            "SESSION_INTENT",
            "A different role has an unresolved session intent",
          );
        yield* this.records.save(e);
        // Native create accepts a client-generated ID. A missing-response retry cannot create a second session.
        id = yield* this.runtime.createSession(e, role, e.session_intent.id);
        e[`${role}_session_id`] = id;
        delete e.session_intent;
      } else yield* this.runtime.refreshPermissions(e, role, id);
      e.active_role = role;
      yield* this.runtime.switchAgent(id, environment.agent);
      const model = environment.model;
      if (model) yield* this.runtime.switchModel(id, model);
      delete e.resume_after_decision;
      e.prompt_id = SessionMessage.ID.create();
      e.messages = e.messages?.map((m) =>
        m.type !== "finding" && needsDisposition(m) ? { ...m, status: "superseded" as const } : m,
      );
      e.worker_started_at = yield* Clock.currentTimeMillis;
      delete e.progress;
      e.capacity_reservation = {
        role,
        generation: e.control_generation,
        status: "uncertain",
        session_id: id,
        prompt_id: e.prompt_id,
      };
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
      const context = yield* this.contexts.prepare(
        e,
        role,
        yield* this.queries.issue(e.issue_id),
        environment,
        id,
        e.prompt_id,
        artifacts,
      );
      e.worker_context_id = context.prompt_id;
      yield* this.records.save(e);
      yield* this.runtime.prompt(id, context.prompt, e.prompt_id);
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
      if (e.session_intent) {
        const state = yield* this.runtime.session(e.session_intent.id);
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
      e.capacity_observed_idle = true;
      delete e.capacity_reservation;
      delete e.active_role;
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
          at:
            state.error_at === undefined
              ? observedAt
              : Timestamp.make(new Date(state.error_at).toISOString()),
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
