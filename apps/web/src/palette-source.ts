import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
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
  const refresh = useAtomRefresh(atom);
  return {
    data: enabled && AsyncResult.isSuccess(result) ? result.value : undefined,
    failed: enabled && AsyncResult.isFailure(result),
    loading: enabled && (result.waiting || AsyncResult.isInitial(result)),
    retry: refresh,
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

export function rankPaletteHits(
  hits: Hit[],
  filter: Source | undefined,
  confirmedPublications: Set<string>,
  input: string,
  lower: string,
  expanded: Partial<Record<Source, number>>,
  session?: string,
) {
  const rank = (h: Hit) =>
    h.identity.toLowerCase() === lower ? 0 : h.label.toLowerCase() === lower ? 1 : 2;

  const counts = new Map<Source, number>();
  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    seen.add(hit.id);
    return true;
  });
  const rows = unique
    .filter((h) => {
      if (filter && h.source !== filter) return false;
      if (confirmedPublications.has(h.id)) return true;
      if (!input) return h.source === "page" || h.source === "command";
      if (
        ["work", "thought", "github", "evidence", "memory"].includes(h.source) ||
        (h.source === "session" && h.identity !== session)
      )
        return true;
      return [h.identity, h.label, h.detail, ...(h.aliases ?? [])].some((s) =>
        s?.toLowerCase().includes(lower),
      );
    })
    .sort((a, b) => rank(a) - rank(b))
    .filter((h) => {
      const count = counts.get(h.source) ?? 0;
      counts.set(h.source, count + 1);
      return count < (expanded[h.source] ?? (h.source === "evidence" ? 12 : 8));
    })
    .map((h) => ({
      ...h,
      detail: [h.source, h.detail, h.identity, h.effect].filter(Boolean).join(" · "),
    }));
  return { rows, counts };
}
