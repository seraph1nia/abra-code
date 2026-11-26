import { useCallback, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { Exit } from "effect";
import { resolveResource, useWorkspaceCall } from "./data.ts";
import { useWorkspaceNavigate } from "./use-workspace-navigate.ts";
import { destinationFor, searchForResource, type WorkspaceSearch } from "./navigation.ts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { toast } from "./notifications.tsx";
import { requestError } from "./request-error.ts";

export function useInspectResource(beforeNavigate?: (origin: HTMLElement | null) => void) {
  const router = useRouter();
  const navigate = useWorkspaceNavigate();
  const resolve = useWorkspaceCall(resolveResource);
  const selectionRequest = useRef(0);
  const inspect = useCallback(
    (target: ResourceSelection) => {
      const address = window.location.href;
      const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      async function openTarget() {
        const request = ++selectionRequest.current;
        const isCurrent = () =>
          request === selectionRequest.current && window.location.href === address;
        const result = await resolve({ payload: target });
        if (!isCurrent()) return;
        if (Exit.isFailure(result)) {
          toast.error("Couldn’t open this work item", {
            id: "open-work-item",
            description: requestError(result.cause),
            duration: 10000,
            action: {
              label: "Retry",
              onClick: (event) => {
                if (!isCurrent()) return;
                event.preventDefault();
                void openTarget();
              },
            },
          });
          return;
        }
        toast.dismiss("open-work-item");
        beforeNavigate?.(origin);
        void navigate({
          to: destinationFor(router.state.location.pathname) ?? "/",
          search: (previous: WorkspaceSearch) => ({
            collection: previous.collection,
            ...searchForResource(result.value),
          }),
          resetScroll: false,
        });
      }
      void openTarget();
    },
    [resolve, navigate, router, beforeNavigate],
  );
  const cancel = useCallback(() => {
    selectionRequest.current++;
  }, []);
  return { inspect, cancel };
}
