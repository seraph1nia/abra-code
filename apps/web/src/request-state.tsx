/* oxlint-disable effecttsgo/unstable-api-usage -- Shared typed HTTP atom result presentation. */
import type { ReactNode } from "react";
import { RefreshCw } from "@abracode/presentation/icons";
import { PresentationRefreshContext } from "@abracode/presentation/diagram-resource";
import { useMemo } from "react";
import { createRefreshGroup, useCanvasRead } from "./canvas-refresh.tsx";
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
}: {
  query: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  children: (value: A) => ReactNode;
  showRefresh?: boolean;
  live?: boolean;
  unavailable?: ReactNode;
}) {
  const result = useAtomValue(query);
  const { group, refresh } = useCanvasRead(query, live);
  const value = AsyncResult.value(result);
  const derived = useMemo(() => {
    const local = createRefreshGroup();
    return {
      subscribe: (retry: () => void) => {
        const removeLocal = local.register(retry, retry);
        const removeCanvas = live ? group?.register(retry, retry) : undefined;
        return () => {
          removeLocal();
          removeCanvas?.();
        };
      },
      refresh: local.refresh,
    };
  }, [group, live]);
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
