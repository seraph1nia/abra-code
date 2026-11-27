import { useInspectResource } from "../use-inspect-resource.ts";
import { useWorkspaceNavigate } from "../use-workspace-navigate.ts";
import { useCallback, useLayoutEffect, useRef } from "react";
import { resourceFromSearch, type InspectorTab, type WorkspaceSearch } from "../navigation.ts";
export function useWorkspaceNavigation(route: WorkspaceSearch, beforeNavigate: () => void) {
  const navigate = useWorkspaceNavigate();
  const collectionPosition = useRef<{ element: HTMLElement; top: number } | undefined>(undefined);
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
  const onOpen = useCallback(
    (origin: HTMLElement | null) => {
      const element = origin?.closest<HTMLElement>(".collection-page");
      if (element) {
        collectionPosition.current = { element, top: element.scrollTop };
        inspectorOrigin.current = origin;
      } else if (!collectionPosition.current) inspectorOrigin.current = origin;
      beforeNavigate();
    },
    [beforeNavigate],
  );
  const { inspect, cancel } = useInspectResource(onOpen);
  const openSurface = useCallback(
    (surface: NonNullable<WorkspaceSearch["surface"]>) => {
      cancel();
      inspectorOrigin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      beforeNavigate();
      void navigate({ search: { collection: route.collection, surface } });
    },
    [beforeNavigate, navigate, route.collection, cancel],
  );
  const selected = resourceFromSearch(route)?.issue_id;
  const tab = route.tab ?? "Overview";
  const wasInspecting = useRef(false);
  const inspecting = Boolean(selected || route.surface || route.retained || route.review);
  useLayoutEffect(() => {
    const origin = inspectorOrigin.current;
    if (wasInspecting.current && !inspecting) {
      const previous = collectionPosition.current;
      collectionPosition.current = undefined;
      if (previous)
        requestAnimationFrame(() => {
          previous.element.scrollTop = previous.top;
        });
      if (origin?.checkVisibility()) origin.focus({ preventScroll: true });
    }
    wasInspecting.current = inspecting;
  }, [inspecting]);
  const setTab = (tab: InspectorTab) => {
    void navigate({ search: { collection: route.collection, issue: selected, tab } });
  };
  const closeInspector = (focus?: HTMLElement | null) => {
    if (focus) inspectorOrigin.current = focus;
    cancel();
    beforeNavigate();
    void navigate({ search: { collection: route.collection }, resetScroll: false }).then(() => {
      requestAnimationFrame(() => {
        const origin = returnInspectorFocus();
        if (origin) origin.focus({ preventScroll: true });
      });
    });
  };
  const focusForm = (id: string, binding: string) => {
    cancel();
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
