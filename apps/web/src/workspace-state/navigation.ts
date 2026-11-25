import { useWorkspaceNavigate } from "../use-workspace-navigate.ts";
import { useWorkspaceCall } from "../data.ts";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "../notifications.tsx";
import { Exit } from "effect";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { resolveResource } from "../data.ts";
import { requestError } from "../request-error.ts";
import {
  destinationFor,
  resourceFromSearch,
  searchForResource,
  type InspectorTab,
  type WorkspaceSearch,
} from "../navigation.ts";
export function useWorkspaceNavigation(route: WorkspaceSearch, beforeNavigate: () => void) {
  const router = useRouter();
  const navigate = useWorkspaceNavigate();
  const resolve = useWorkspaceCall(resolveResource);
  const selectionRequest = useRef(0);
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const returnInspectorFocus = () => {
    const origin = inspectorOrigin.current;
    return (
      (origin?.checkVisibility() ? origin : null) ??
      document.querySelector<HTMLElement>(".phone-navigation a") ??
      document.querySelector<HTMLElement>(
        '.destination-rail a[aria-current="page"], .destination-menu summary',
      ) ??
      false
    );
  };
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
        inspectorOrigin.current = origin;
        beforeNavigate();
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
  const openSurface = useCallback(
    (surface: NonNullable<WorkspaceSearch["surface"]>) => {
      selectionRequest.current++;
      inspectorOrigin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      beforeNavigate();
      void navigate({ search: { collection: route.collection, surface } });
    },
    [beforeNavigate, navigate, route.collection],
  );
  const selected = resourceFromSearch(route)?.issue_id;
  const tab = route.tab ?? "Overview";
  const wasInspecting = useRef(false);
  const inspecting = Boolean(selected || route.surface || route.retained || route.review);
  useLayoutEffect(() => {
    const origin = inspectorOrigin.current;
    if (wasInspecting.current && !inspecting && origin?.checkVisibility())
      origin.focus({ preventScroll: true });
    wasInspecting.current = inspecting;
  }, [inspecting]);
  const setTab = (tab: InspectorTab) => {
    void navigate({ search: { collection: route.collection, issue: selected, tab } });
  };
  const closeInspector = (focus?: HTMLElement | null) => {
    if (focus) inspectorOrigin.current = focus;
    selectionRequest.current++;
    beforeNavigate();
    void navigate({ search: { collection: route.collection }, resetScroll: false }).then(() => {
      requestAnimationFrame(() => {
        const origin = returnInspectorFocus();
        if (origin) origin.focus({ preventScroll: true });
      });
    });
  };
  const focusForm = (id: string, binding: string) => {
    selectionRequest.current++;
    void navigate({ to: "/attention", search: {}, hash: "form-" + id + "-" + binding });
  };
  return {
    selected,
    tab,
    openSurface,
    inspect,
    setTab,
    closeInspector,
    returnInspectorFocus,
    focusForm,
  };
}
