import { Effect } from "effect";
import type { IssueId, SessionId } from "@abracode/contracts/identities";
import type { Execution } from "../domain.ts";
import { hasWorkerSession, workerSessionIDs } from "../workflow/worker-assignment.ts";
import type { Records } from "./store.ts";

const terminalWorkerPhases = new Set<string>(["completed", "cancelled", "archived"]);
const maxWorkerTickets = 2048;

export class WorkerTickets {
  private tickets = new Map<SessionId, IssueId>();
  remember(execution: Execution) {
    if (terminalWorkerPhases.has(execution.current_phase)) {
      for (const session of workerSessionIDs(execution)) {
        if (session) this.tickets.delete(session);
      }
      for (const [session, issueId] of this.tickets) {
        if (issueId === execution.issue_id) this.tickets.delete(session);
      }
      return;
    }
    for (const session of workerSessionIDs(execution)) {
      if (!session) continue;
      this.tickets.delete(session);
      this.tickets.set(session, execution.issue_id);
      if (this.tickets.size > maxWorkerTickets) {
        const oldest = this.tickets.keys().next().value;
        if (oldest !== undefined) this.tickets.delete(oldest);
      }
    }
  }

  lookup = Effect.fn("Records.workerAssignment")(
    { self: this },
    function* (records: Records, session: SessionId) {
      const ticket = this.tickets.get(session);
      if (ticket) {
        const current = yield* records.execution(ticket).pipe(Effect.result);
        if (
          current._tag === "Success" &&
          current.success &&
          hasWorkerSession(current.success, session)
        )
          return current.success;
        if (
          current._tag === "Failure" &&
          ![
            "INVALID_DATA",
            "INVALID_RECORD",
            "UNSUPPORTED_RECORD_VERSION",
            "RECORD_IDENTITY",
          ].includes(current.failure.code)
        )
          return yield* current.failure;
        this.tickets.delete(session);
      }
      const found = (yield* records.executions).find((e) => hasWorkerSession(e, session));
      if (found) this.remember(found);
      return found;
    },
  );
}
