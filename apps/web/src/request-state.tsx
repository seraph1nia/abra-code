/* oxlint-disable effecttsgo/unstable-api-usage -- Shared typed HTTP atom result presentation. */
import type { ReactNode } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Cause, Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { Alert, AlertDescription } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip.tsx";

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
  return (
    <>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {result.waiting && Option.isSome(value) && <span role="status">Updating…</span>}
        {showRefresh && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh retained evidence"
                  onClick={refresh}
                >
                  ↻
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
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {Option.isSome(value)
        ? children(value.value)
        : !AsyncResult.isFailure(result) && (
            <div role="status" aria-label="Loading retained evidence" className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <span className="sr-only">Loading retained evidence…</span>
            </div>
          )}
    </>
  );
}
