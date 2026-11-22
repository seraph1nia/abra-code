import type { ManagedExecution } from "../domain.ts";
import type { PublicationDestination } from "./finishing-contracts.ts";

/** Repair rounds may follow one another without an intervening publication. */
export function publicationDestination(e: ManagedExecution): PublicationDestination {
  const sync = e.finishing?.synchronization?.at(-1);
  if (sync?.stage === "publishing")
    return { kind: "synchronization", predecessor: sync.published, pr: sync.pr };
  const pr = e.pull_request_reference ?? e.finishing?.publication?.pr;
  const round = e.rounds?.findLast((entry) => entry.prior_delivered_commit);
  if (round?.prior_delivered_commit)
    return {
      kind: "correction",
      predecessor: round.prior_delivered_commit,
      pr: pr ?? round.pull_request_reference,
    };
  if (e.provisional)
    return { kind: "provisional", predecessor: e.provisional.head, pr: pr ?? e.provisional.pr };
  return { kind: "initial", pr };
}
