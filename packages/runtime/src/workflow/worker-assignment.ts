import { WorkflowError } from "../errors.ts";
import { type Execution, type Role, type Phase, type Policy } from "../domain.ts";
import { type SessionId } from "@abracode/contracts/identities";
import { Effect } from "effect";
import { type Runtime } from "../opencode/runtime.ts";
import { messageRequests } from "@abracode/contracts/workflow/message-contracts";

export const workerSessionID = (e: Execution, role = e.active_role) =>
  role ? e[`${role}_session_id`] : undefined;
/** Legacy intents are written at native creation. New intents also cover preflight. */
export function nativeSessionIntent(e: Execution) {
  const intent = e.session_intent;
  if (intent && (!intent.prompt || intent.native_started)) return intent;
}

export const historicalWorkers = (e: Execution) => [
  ...(e.rounds?.flatMap((r) => r.worker_sessions ?? []) ?? []),
  ...(e.finishing?.synchronization?.flatMap((a) => a.worker_sessions) ?? []),
];

export function workerSessionIDs(e: Execution) {
  return [
    e.explore_session_id,
    e.apply_session_id,
    e.review_session_id,
    e.research_session_id,
    e.session_intent?.id,
    ...historicalWorkers(e).map((worker) => worker.id),
  ];
}

export function hasWorkerSession(e: Execution, session: SessionId): boolean {
  return workerSessionIDs(e).includes(session);
}

/** Evaluate fresh retained state at each entry point; never cache this across asynchronous work. */
export function isActiveWorker(
  e: Execution | undefined,
  session: SessionId,
  expected: { role?: Role; generation?: number } = {},
): boolean {
  const role = e?.active_role;
  return !!(
    e &&
    role &&
    !e.stop_status &&
    phaseRole(e.current_phase) === role &&
    workerSessionID(e) === session &&
    (expected.role === undefined || expected.role === role) &&
    (expected.generation === undefined || expected.generation === e.control_generation)
  );
}

/** Policy selects initial admission; phase identifies the same worker during recovery. */
export const initialRole = (policy: Policy): Role =>
  policy === "research-only" ? "research" : policy === "lightweight-fix" ? "apply" : "explore";

export const phaseRole = (phase: Phase): Role | undefined => {
  switch (phase) {
    case "exploring":
    case "planning":
      return "explore";
    case "applying":
      return "apply";
    case "researching":
      return "research";
    case "verifying":
      return "review";
    default:
      return undefined;
  }
};

const workerRoles = ["explore", "apply", "review", "research"] as const;

export class SessionInspection {
  constructor(private runtime: Pick<Runtime, "session">) {}

  private states(e: Execution) {
    const sessions = workerRoles
      .map((role) => workerSessionID(e, role))
      .filter((id) => id !== undefined);
    return Effect.forEach(sessions, (id) => this.runtime.session(id), { concurrency: "unbounded" });
  }

  validateLocations = Effect.fn("SessionInspection.validateLocations")(
    { self: this },
    function* (e: Execution) {
      const states = yield* this.states(e);
      if (states.some((state) => state.directory !== e.worktree_directory))
        return yield* new WorkflowError(
          "SESSION_LOCATION",
          "Managed session moved out of owned worktree",
        );
      return states;
    },
  );

  idle = Effect.fn("SessionInspection.idle")({ self: this }, function* (e: Execution) {
    if (messageRequests(e.messages).some((m) => m.status === "admission_uncertain"))
      return yield* new WorkflowError(
        "MESSAGE_UNCERTAIN",
        "Pause and confirm native stop before replacing an uncertain instruction",
      );
    const states = yield* this.states(e);
    if (states.some((state) => state.busy))
      return yield* new WorkflowError(
        "WRITER_BUSY",
        "A managed session still runs in this worktree",
      );
  });
}
