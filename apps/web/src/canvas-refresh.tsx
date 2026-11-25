import { createContext, useCallback, useContext, useEffect, useId, type ReactNode } from "react";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Reactivity, type Atom } from "effect/reactivity";
import { Button } from "@abracode/presentation/ui/button";
import { RefreshCw } from "@abracode/presentation/icons";
import { WorkspaceApi } from "./data.ts";

const CanvasKey = createContext<string | undefined>(undefined);
const reactivity = WorkspaceApi.runtime.atom(Reactivity.Reactivity);
const invalidate = WorkspaceApi.runtime.fn((key: string) => Reactivity.invalidate([key]));

export function CanvasRefreshProvider({ children }: { children: ReactNode }) {
  const key = useId();
  return <CanvasKey.Provider value={key}>{children}</CanvasKey.Provider>;
}
export function RefreshCanvas() {
  const key = useContext(CanvasKey);
  const refresh = useAtomSet(invalidate);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh canvas"
      title="Refresh canvas"
      onClick={() => {
        if (key) refresh(key);
      }}
    >
      <RefreshCw aria-hidden="true" />
    </Button>
  );
}
export function useCanvasRead<A>(query: Atom.Atom<A>, live = true) {
  const key = useContext(CanvasKey);
  const refresh = useAtomRefresh(query);
  const service = useAtomValue(reactivity);
  const subscribe = useCallback(
    (callback: () => void) => {
      return live && key && AsyncResult.isSuccess(service)
        ? service.value.registerUnsafe([key], callback)
        : () => {};
    },
    [key, service, live],
  );
  useEffect(() => subscribe(refresh), [subscribe, refresh]);
  return { group: key, refresh, subscribe };
}
