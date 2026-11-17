/* oxlint-disable effecttsgo/unstable-api-usage -- Shared typed HTTP atom result presentation. */
import type { ReactNode } from "react";
import { RefreshCw } from "@abracode/presentation/icons";
import { PresentationRefreshContext } from "@abracode/presentation/diagram-resource";
import { useMemo } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Cause, Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Button } from "@abracode/presentation/ui/button";
import { Skeleton } from "@abracode/presentation/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@abracode/presentation/ui/tooltip";

export function requestError(cause: Cause.Cause<unknown>) {
  const error = Cause.findErrorOption(cause);
  if (
    Option.isSome(error) &&
    error.value &&
    typeof error.value === "object" &&
    "message" in error.value
  ) {
    const code = "code" in error.value ? `${String(error.value.code)}: ` : "";
    return `${code}${String(error.value.message)}`;
  }
  return "Request unavailable. Refresh to try again.";
}

export function RequestState<A, E>({
  query,
  children,
  showRefresh = true,
}: {
  query: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  children: (value: A) => ReactNode;
  showRefresh?: boolean;
}) {
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const value = AsyncResult.value(result);
  const derived = useMemo(() => {
    const readers = new Map<() => void, number>();
    return {
      subscribe: (retry: () => void) => {
        readers.set(retry, (readers.get(retry) ?? 0) + 1);
        return () => {
          const count = readers.get(retry) ?? 0;
          if (count <= 1) readers.delete(retry);
          else readers.set(retry, count - 1);
        };
      },
      refresh: () => {
        for (const retry of readers.keys()) retry();
      },
    };
  }, []);
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
        {showRefresh && (
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
