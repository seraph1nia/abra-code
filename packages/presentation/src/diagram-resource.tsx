import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PrepareDiagramSelection } from "@abracode/contracts/web/diagram-actions";

export type PreparedReportDiagram = { id?: string; source: string; svg: string };
export type DiagramRequest =
  | PrepareDiagramSelection
  | { kind: "surface"; surface_id: string; revision: number; surface: unknown };
export type DiagramState = {
  assets: readonly PreparedReportDiagram[];
  message?: string;
  pending?: boolean;
};
export type DiagramResource = {
  read: () => DiagramState;
  subscribe: (changed: () => void) => () => void;
  retry: () => void;
};
export const DiagramResourceContext = createContext<((key: string) => DiagramResource) | undefined>(
  undefined,
);
// A containing evidence reader can refresh only its mounted derived resources.
export const PresentationRefreshContext = createContext<
  ((retry: () => void) => () => void) | undefined
>(undefined);
export const diagramRequestKey = (request: unknown) =>
  JSON.stringify(request, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const unavailable: DiagramState = {
  assets: [],
  message: "Captured Mermaid source. A prepared rendering is available in an explicit HTML export.",
};
const emptyResource: DiagramResource = {
  read: () => unavailable,
  subscribe: () => () => {},
  retry: () => {},
};

/** The host owns reads/cache/cancellation. Frozen rendering needs no live client. */
export function usePreparedDiagrams(
  request: DiagramRequest | undefined,
  supplied?: readonly PreparedReportDiagram[],
): DiagramState & { retry?: () => void } {
  const adapter = useContext(DiagramResourceContext);
  const registerRefresh = useContext(PresentationRefreshContext);
  const key = request ? diagramRequestKey(request) : "";
  const resource = useMemo(
    () => (adapter && key && !supplied ? adapter(key) : emptyResource),
    [adapter, key, supplied],
  );
  const state = useSyncExternalStore(resource.subscribe, resource.read, resource.read);
  useEffect(() => registerRefresh?.(resource.retry), [registerRefresh, resource]);
  return supplied
    ? { assets: supplied }
    : { ...state, retry: resource === emptyResource ? undefined : resource.retry };
}
