import { Context, Effect, Option } from "effect";
import type { Records } from "./store.ts";
import { CrewError, type SavedExecution, type SetupExecution } from "../domain.ts";
import type { IssueId, RepositoryId } from "@abracode/contracts/identities";
import type { RecordDiagnostic } from "./contracts.ts";

type ActiveIndex = {
  records: Records;
  executions: Map<IssueId, SavedExecution>;
  setups: Map<RepositoryId, SetupExecution>;
  diagnostics: RecordDiagnostic[];
};
const needsActiveIndex = (e: SavedExecution) =>
  e.current_phase !== "completed" ||
  e.finishing?.completion_notice?.status === "pending" ||
  e.attention?.some((item) => item.status === "uncertain" || item.status === "admitted");
const activeIndex = Context.Reference<ActiveIndex | undefined>("abracode/active-execution-index", {
  defaultValue: () => undefined,
});
/** Audit storage before taking the exclusive admission lock. The revision
 * fence retries if another process wrote during capture. Nested admissions
 * reuse this transaction's active records and its fail-closed diagnostics. */
export function withActiveIndex<A, E, R>(
  records: Records,
  action: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CrewError, R> {
  return Effect.gen(function* () {
    if ((yield* activeIndex)?.records === records) return yield* action();
    for (let attempt = 0; attempt < 16; attempt++) {
      const revision = yield* records.coordination.with(() => records.observationRevision, {
        shared: true,
      });
      const [executions, setups] = yield* Effect.all([records.executionScan, records.setupScan], {
        concurrency: 2,
      });
      const index: ActiveIndex = {
        records,
        executions: new Map(executions.values.filter(needsActiveIndex).map((e) => [e.issue_id, e])),
        setups: new Map(
          setups.values
            .filter((e) => e.current_phase !== "completed")
            .map((e) => [e.repository_id, e]),
        ),
        diagnostics: [...executions.diagnostics, ...setups.diagnostics],
      };
      const result = yield* records.coordinateCommit(() =>
        records.observationRevision.pipe(
          Effect.flatMap((current) =>
            current === revision
              ? action().pipe(Effect.provideService(activeIndex, index), Effect.asSome)
              : Effect.succeed(Option.none<A>()),
          ),
        ),
      );
      if (Option.isSome(result)) return result.value;
    }
    return yield* new CrewError("LOCKED", "Execution inventory is changing; retry admission");
  });
}

export function capacityRecords(records: Records, selected: readonly IssueId[] = []) {
  return Effect.gen(function* () {
    const index = yield* activeIndex;
    if (index?.records === records) {
      const executions = [...index.executions.values()];
      for (const id of selected) {
        if (index.executions.has(id)) continue;
        const result = yield* Effect.result(records.execution(id));
        if (result._tag === "Success" && result.success) executions.push(result.success);
      }
      return { executions, setups: [...index.setups.values()], diagnostics: index.diagnostics };
    }
    const [executions, setups] = yield* Effect.all([records.executionScan, records.setupScan], {
      concurrency: 2,
    });
    return {
      executions: executions.values,
      setups: setups.values,
      diagnostics: [...executions.diagnostics, ...setups.diagnostics],
    };
  });
}

export function updateActiveIndex(records: Records, decoded: SavedExecution | SetupExecution) {
  return Effect.gen(function* () {
    const index = yield* activeIndex;
    if (index?.records === records) {
      if (decoded.setup) {
        if (decoded.current_phase === "completed") index.setups.delete(decoded.repository_id);
        else index.setups.set(decoded.repository_id, decoded);
      } else if (!needsActiveIndex(decoded)) index.executions.delete(decoded.issue_id);
      else index.executions.set(decoded.issue_id, decoded);
    }
  });
}
