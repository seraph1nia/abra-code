import type { ReactNode } from "react";
import { RefreshCw } from "@abracode/presentation/icons";
import { PresentationRefreshContext } from "@abracode/presentation/diagram-resource";
import { useState, useMemo } from "react";
import { useCanvasRead } from "./canvas-refresh.tsx";
import { useAtomValue } from "@effect/atom-react";
import { requestError } from "./request-error.ts";
import { Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Button } from "@abracode/presentation/ui/button";
import { Skeleton } from "@abracode/presentation/ui/skeleton";
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@abracode/presentation/ui/tooltip";

export function RequestState<A, E>({
  query,
  children,
  showRefresh = true,
  live = true,
  unavailable,
  keepPrevious = false,
}: {
  query: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  children: (value: A) => ReactNode;
  showRefresh?: boolean;
  live?: boolean;
  unavailable?: ReactNode;
  keepPrevious?: boolean;
}) {
  const result = useAtomValue(query);
  const { group, refresh, subscribe } = useCanvasRead(query, live);
  const observed = AsyncResult.value(result);
  const [prior, setPrior] = useState<Option.Option<A>>(Option.none);
  if (
    keepPrevious &&
    Option.isSome(observed) &&
    (Option.isNone(prior) || prior.value !== observed.value)
  )
    setPrior(observed);
  const value = keepPrevious && Option.isNone(observed) ? prior : observed;
  const derived = useMemo(() => {
    const readers = new Set<() => void>();
    return {
      subscribe: (retry: () => void) => {
        readers.add(retry);
        const remove = subscribe(retry);
        return () => {
          readers.delete(retry);
          remove();
        };
      },
      refresh: () => {
        for (const retry of readers) retry();
      },
    };
  }, [subscribe]);
  const refreshEvidence = () => {
    refresh();
    derived.refresh();
  };
  return (
    <PresentationRefreshContext.Provider value={derived.subscribe}>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {result.waiting && Option.isSome(value) && (
          <output className="inline-status">Updating…</output>
        )}
        {!group && showRefresh && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh retained evidence"
                    onClick={refreshEvidence}
                  >
                    <RefreshCw aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>Refresh this view</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {AsyncResult.isFailure(result) && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {requestError(result.cause)}{" "}
            {Option.isSome(value) && <span>Showing the last successful observation.</span>}{" "}
            <Button variant="outline" onClick={refreshEvidence}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {AsyncResult.isFailure(result) && Option.isNone(value) && unavailable}
      {Option.isSome(value)
        ? children(value.value)
        : !AsyncResult.isFailure(result) && (
            /* oxlint-disable jsx-a11y/prefer-tag-over-role -- This block status contains skeleton divs; output permits phrasing content only. */
            <div role="status" aria-label="Loading retained evidence" className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <span className="sr-only">Loading retained evidence…</span>
            </div>
            /* oxlint-enable jsx-a11y/prefer-tag-over-role */
          )}
    </PresentationRefreshContext.Provider>
  );
}
