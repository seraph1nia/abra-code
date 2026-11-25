import { useContext, useMemo, type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, type AtomRegistry, type Atom } from "effect/reactivity";
import {
  DiagramResourceContext,
  type DiagramResource,
  type DiagramState,
} from "@abracode/presentation/diagram-resource";
import { diagramQuery } from "./data.ts";

export function diagramResources(registry: AtomRegistry.AtomRegistry) {
  const resources = new WeakMap<ReturnType<typeof diagramQuery>, DiagramResource>();
  return (key: string): DiagramResource => {
    const query = diagramQuery(key);
    const previous = resources.get(query);
    if (previous) return previous;
    let prior: Atom.Type<typeof query> | undefined;
    let state: DiagramState = { assets: [], pending: true, message: "Preparing diagrams…" };
    let readers = 0;
    const resource: DiagramResource = {
      read: () => {
        // Abandoned/Suspense renders must not start an unmounted HTTP effect.
        if (!readers) return state;
        const result = registry.get(query);
        if (result !== prior) {
          prior = result;
          state = AsyncResult.isSuccess(result)
            ? {
                assets: result.value.assets,
                pending: result.waiting,
                message: result.value.verified
                  ? undefined
                  : result.value.results
                      .filter((entry) => entry.status !== "verified")
                      .map((entry) => `${entry.id}: ${entry.status}: ${entry.message}`)
                      .join("\n"),
              }
            : {
                assets: [],
                pending: result.waiting || AsyncResult.isInitial(result),
                message: AsyncResult.isFailure(result)
                  ? "Diagram rendering is unavailable. Retained source remains readable."
                  : "Preparing diagrams…",
              };
        }
        return state;
      },
      subscribe: (changed) => {
        readers++;
        const unsubscribe = registry.subscribe(query, changed);
        return () => {
          readers--;
          unsubscribe();
        };
      },
      retry: () => registry.refresh(query),
    };
    resources.set(query, resource);
    return resource;
  };
}
export function DiagramResources({ children }: { children: ReactNode }) {
  const registry = useContext(RegistryContext);
  const adapter = useMemo(() => diagramResources(registry), [registry]);
  return (
    <DiagramResourceContext.Provider value={adapter}>{children}</DiagramResourceContext.Provider>
  );
}
