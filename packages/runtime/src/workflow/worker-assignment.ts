import { type Execution, type Role } from "../domain.ts";
import { type SessionId } from "../identities.ts";
import { phaseRole } from "./roles.ts";

export const workerSessionID = (e: Execution, role = e.active_role) =>
  role ? e[`${role}_session_id`] : undefined;
export const historicalWorkers = (e: Execution) => [
  ...(e.rounds?.flatMap((r) => r.worker_sessions ?? []) ?? []),
  ...(e.finishing?.synchronization?.flatMap((a) => a.worker_sessions) ?? []),
];

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
