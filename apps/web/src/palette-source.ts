/* oxlint-disable effecttsgo/unstable-api-usage -- Cancelling the picker releases its typed HTTP atom subscriptions. */
import { useContext } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { SearchCommand } from "@abracode/presentation/ui/search-dialog";
const idle = Atom.make(AsyncResult.initial<never, never>());
export const sources = [
  "work",
  "session",
  "thought",
  "memory",
  "github",
  "agent",
  "repo",
  "attention",
  "page",
  "command",
  "message",
  "evidence",
  "surface",
  "review",
] as const;
export type Source = (typeof sources)[number];
export type Hit = SearchCommand & {
  source: Source;
  identity: string;
  effect: "Open" | "Prepare draft" | "Open form" | "Attach to chat";
  aliases?: readonly string[];
};
export function useSource<A, E>(
  enabled: boolean,
  read: () => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  const atom = enabled ? read() : idle;
  const result = useAtomValue(atom);
  const registry = useContext(RegistryContext);
  return {
    data: enabled && AsyncResult.isSuccess(result) ? result.value : undefined,
    failed: enabled && AsyncResult.isFailure(result),
    loading: enabled && (result.waiting || AsyncResult.isInitial(result)),
    retry: () => registry.refresh(atom),
  };
}

export function sourceFeedback() {
  const more: SearchCommand[] = [];
  const status: string[] = [];
  const report = (
    label: string,
    part: { failed: boolean; loading: boolean; retry: () => void },
  ) => {
    if (part.failed) {
      status.push(label + " unavailable");
      more.push({ id: "retry-" + label, label: "Retry " + label, run: part.retry, keepOpen: true });
    } else if (part.loading) status.push("Searching " + label + "…");
  };
  return { more, status, report };
}
