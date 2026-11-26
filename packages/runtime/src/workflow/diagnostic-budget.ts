import { Effect } from "effect";
import type { IncidentId, IssueId } from "@abracode/contracts/identities";
import type { CrewError } from "../domain.ts";
import type { Records } from "../storage/store.ts";
import { leadAccounting } from "./leads/contracts.ts";

export interface DiagnosticCapacitySnapshot {
  readonly turnsUsed: number;
  readonly remainingTurns: number;
  readonly exhausted: boolean;
  readonly activeAttention: ReturnType<typeof activeAttentionFromExecutions>;
  readonly activeLeads: number;
  readonly totalActive: number;
}

function activeAttentionFromExecutions(
  executions: readonly {
    attention?: readonly { id: IncidentId; status: string; code: string; session_id?: string }[];
  }[],
  excludeIncidentId?: IncidentId,
) {
  return executions
    .flatMap((record) => record.attention ?? [])
    .filter(
      (item) =>
        item.id !== excludeIncidentId &&
        (item.status === "uncertain" || item.status === "admitted"),
    );
}

/** Check whether an issue's combined worker-attention + project-lead diagnostic turns reached budget. */
export const diagnosticTurnsExhausted = (
  records: Records,
  issueId: IssueId,
  attentionTurns: number | undefined,
  budget: number,
): Effect.Effect<boolean, CrewError> =>
  leadAccounting(records).pipe(
    Effect.map((leads) => (attentionTurns ?? 0) + leads.turns(issueId) >= budget),
  );

/** Read combined diagnostic turn consumption and shared management attention capacity. */
export const readDiagnosticCapacity = (
  records: Records,
  issueId: IssueId,
  options: {
    readonly attentionTurns?: number;
    readonly budget: number;
    readonly excludeIncidentId?: IncidentId;
    readonly excludeCurrentLeadActive?: boolean;
  },
): Effect.Effect<DiagnosticCapacitySnapshot, CrewError> =>
  Effect.gen(function* () {
    const [leads, executions] = yield* Effect.all(
      [
        leadAccounting(records),
        records.capacityRecords().pipe(Effect.map((scan) => scan.executions)),
      ],
      {
        concurrency: 2,
      },
    );
    const activeAttention = activeAttentionFromExecutions(executions, options.excludeIncidentId);
    const turnsUsed = (options.attentionTurns ?? 0) + leads.turns(issueId);
    const remainingTurns = Math.max(0, options.budget - turnsUsed);
    const activeLeads = leads.active - (options.excludeCurrentLeadActive ? 1 : 0);
    return {
      turnsUsed,
      remainingTurns,
      exhausted: turnsUsed >= options.budget,
      activeAttention,
      activeLeads,
      totalActive: activeAttention.length + activeLeads,
    };
  });
