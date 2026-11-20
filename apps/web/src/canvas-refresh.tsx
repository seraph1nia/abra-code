/* oxlint-disable effecttsgo/unstable-api-usage -- Register only mounted inspector query atoms. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import type { Atom } from "effect/reactivity";
import { Button } from "@abracode/presentation/ui/button";
import { RefreshCw } from "@abracode/presentation/icons";

export function createRefreshGroup() {
  const readers = new Map<object, Set<() => void>>();
  return {
    register(key: object, refresh: () => void) {
      const mounted = readers.get(key) ?? new Set<() => void>();
      const reader = () => refresh();
      mounted.add(reader);
      readers.set(key, mounted);
      return () => {
        mounted.delete(reader);
        if (!mounted.size) readers.delete(key);
      };
    },
    refresh: () => {
      for (const mounted of readers.values()) mounted.values().next().value?.();
    },
  };
}
export const CanvasRefresh = createContext<ReturnType<typeof createRefreshGroup> | undefined>(
  undefined,
);
export function CanvasRefreshProvider({ children }: { children: ReactNode }) {
  const [group] = useState(createRefreshGroup);
  return <CanvasRefresh.Provider value={group}>{children}</CanvasRefresh.Provider>;
}
export function RefreshCanvas() {
  const group = useContext(CanvasRefresh);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh canvas"
      title="Refresh canvas"
      onClick={group?.refresh}
    >
      <RefreshCw aria-hidden="true" />
    </Button>
  );
}
export function useCanvasRead<A>(query: Atom.Atom<A>, live = true) {
  const group = useContext(CanvasRefresh);
  const registry = useContext(RegistryContext);
  const refresh = useCallback(() => registry.refresh(query), [registry, query]);
  useEffect(
    () => (live ? group?.register(query, refresh) : undefined),
    [group, live, query, refresh],
  );
  return { group, refresh };
}
