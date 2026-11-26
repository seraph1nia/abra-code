import type { AbsolutePath, MessageId, SessionId } from "@abracode/contracts/identities";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { Effect } from "effect";
import { CrewError } from "../domain.ts";
import type { Records } from "../storage/store.ts";

interface ExecutionAuthority {
  revision?: string;
  worktrees: readonly AbsolutePath[];
  prompts: ReadonlyMap<SessionId, ReadonlySet<MessageId>>;
}
const indexes = new WeakMap<Records, ExecutionAuthority>();

/** Read the same record revision and its authority under shared coordination. A writer
 * fences cached views before changing any managed record, including cross-process writes. */
export const executionAuthority = (records: Records) =>
  records.coordination.with(
    () =>
      Effect.gen(function* () {
        const revision = yield* records.observationRevision;
        const cached = indexes.get(records);
        if (cached && cached.revision === revision) return cached;
        const scan = yield* records.executionScan;
        if (scan.diagnostics.length)
          return yield* new CrewError(
            "EXECUTION_AUTHORITY",
            "Cannot verify authority from unreadable execution records",
          );
        const worktrees: AbsolutePath[] = [];
        const prompts = new Map<SessionId, Set<MessageId>>();
        for (const execution of scan.values) {
          if (externalOwns(execution) && execution.worktree_directory)
            worktrees.push(execution.worktree_directory);
          for (const incident of execution.attention ?? []) {
            if (!incident.session_id || !incident.prompt_id) continue;
            let owned = prompts.get(incident.session_id);
            if (!owned) prompts.set(incident.session_id, (owned = new Set()));
            owned.add(incident.prompt_id);
          }
        }
        const index = { revision, worktrees, prompts };
        indexes.set(records, index);
        return index;
      }),
    { shared: true },
  );
