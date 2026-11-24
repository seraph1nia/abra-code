import { Effect } from "effect";
import type { Tool } from "@opencode/schema/tool";
import type { IssueId, MessageId, SessionId } from "@abracode/contracts/identities";
import { CrewError, type Execution, type Role } from "../domain.ts";
import type { Controller } from "../workflow/controller.ts";
import type { LeadRecord } from "../workflow/lead-contracts.ts";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import type { WorkerContext } from "../workflow/worker-context-contracts.ts";
import { roleFor } from "./guards.ts";
import type { SessionState } from "./session-observer.ts";
import { verifiedWorkerCaller } from "./tool-caller.ts";

/** Check whether a lead principal is currently enabled, active, and bound to this session. */
export const isCurrentActiveLead = (
  lead: LeadRecord | undefined,
  sessionID: SessionId,
  agent: string,
): lead is LeadRecord =>
  !!lead &&
  lead.enabled &&
  !lead.stop_pending &&
  lead.session_id === sessionID &&
  agent === "project-lead";

/** Assert the caller is an active registered project lead for this session. */
export const assertActiveLead = (
  controller: Controller,
  sessionID: SessionId,
  agent: string,
  options: {
    readonly lead?: LeadRecord;
    readonly central?: boolean;
    readonly allowed?: boolean;
    readonly code?: string;
    readonly message?: string;
  } = {},
): Effect.Effect<LeadRecord, CrewError> =>
  Effect.gen(function* () {
    const lead = "lead" in options ? options.lead : yield* controller.lead().principal(sessionID);
    if (
      (options.central !== undefined && !options.central) ||
      (options.allowed !== undefined && !options.allowed) ||
      !isCurrentActiveLead(lead, sessionID, agent)
    )
      return yield* new CrewError(
        options.code ?? "LEAD_FORBIDDEN",
        options.message ?? "Project leads use only their scoped management endpoint",
      );
    return lead;
  });

/** Assert the caller is the central Abra supervisor session. */
export function assertSupervisor(
  controller: Controller,
  sessionID: SessionId,
  options: {
    readonly central?: boolean;
    readonly agent?: string;
    readonly verifyNative: true;
    readonly nativeSession?: SessionState;
    readonly requireSupervisorMetadata?: boolean;
    readonly checkNotWorker?: boolean;
    readonly code?: string;
    readonly message?: string;
  },
): Effect.Effect<SessionState, CrewError>;
export function assertSupervisor(
  controller: Controller,
  sessionID: SessionId,
  options?: {
    readonly central?: boolean;
    readonly agent?: string;
    readonly verifyNative?: false;
    readonly checkNotWorker?: boolean;
    readonly code?: string;
    readonly message?: string;
  },
): Effect.Effect<void, CrewError>;
export function assertSupervisor(
  controller: Controller,
  sessionID: SessionId,
  options: {
    readonly central?: boolean;
    readonly agent?: string;
    readonly verifyNative?: boolean;
    readonly nativeSession?: SessionState;
    readonly requireSupervisorMetadata?: boolean;
    readonly checkNotWorker?: boolean;
    readonly code?: string;
    readonly message?: string;
  } = {},
): Effect.Effect<SessionState | void, CrewError> {
  return Effect.gen(function* () {
    const fail = (fallbackCode: string, fallbackMessage: string) =>
      new CrewError(options.code ?? fallbackCode, options.message ?? fallbackMessage);

    if (options.central === false)
      return yield* fail("SUPERVISOR_LOCATION", "Management tools only run in central checkout");
    if (options.checkNotWorker !== false && (yield* controller.queries.assignment(sessionID)))
      return yield* fail("WORKER_FORBIDDEN", "Workers cannot manage or approve executions");
    if (options.agent !== undefined && options.agent !== "abra")
      return yield* fail("ABRA_REQUIRED", "Talk to Abra to manage work");
    if (!options.verifyNative) return;
    const native = options.nativeSession ?? (yield* controller.queries.session(sessionID));
    const home = controller.queries.settings.home;
    if (
      native.agent !== "abra" ||
      native.directory !== home ||
      (options.requireSupervisorMetadata && native.metadata?.abracode_supervisor_home !== home)
    )
      return yield* fail("ABRA_REQUIRED", "Use the central Abra session");
    return native;
  });
}

/** Assert the caller is an active assigned worker session matching optional role/generation/issue constraints. */
export const assertActiveWorker = (
  controller: Controller,
  sessionID: SessionId,
  options: {
    readonly execution?: Execution;
    readonly role?: Role;
    readonly generation?: number;
    readonly issueId?: IssueId;
    readonly code?: string;
    readonly message?: string;
  } = {},
): Effect.Effect<{ readonly execution: Execution; readonly role: Role }, CrewError> =>
  Effect.gen(function* () {
    const execution =
      "execution" in options ? options.execution : yield* controller.queries.assignment(sessionID);
    if (!execution)
      return yield* new CrewError(
        options.code ?? "WORKER_REQUIRED",
        options.message ?? "Assigned worker session required",
      );
    const role = options.role ?? roleFor(execution, sessionID);
    if (
      !isActiveWorker(execution, sessionID, {
        role: options.role,
        generation: options.generation,
      }) ||
      (options.issueId !== undefined && execution.issue_id !== options.issueId)
    )
      return yield* new CrewError(
        options.code ?? "INACTIVE_WORKER",
        options.message ?? "Worker no longer owns an active workflow phase",
      );
    return { execution, role };
  });

/** Assert a verified active worker caller with captured v2 context and prompt provenance. */
export const assertVerifiedWorker = (
  assignment: Execution,
  call: Pick<Tool.Context, "sessionID" | "agent">,
  capture: Effect.Effect<WorkerContext, CrewError>,
  origin: Effect.Effect<MessageId | undefined, CrewError>,
  options: {
    readonly code?: string;
    readonly message?: string;
  } = {},
) =>
  verifiedWorkerCaller(assignment, call, capture, origin).pipe(
    Effect.mapError((error) =>
      options.code || options.message
        ? new CrewError(options.code ?? error.code, options.message ?? error.message)
        : error,
    ),
  );
