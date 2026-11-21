/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useCallback, useRef } from "react";
import { useAtomSet } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Exit } from "effect";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { resolveResource } from "../data.ts";
import { requestError } from "../request-error.ts";
import {
  resourceFromSearch,
  searchForResource,
  type InspectorTab,
  type WorkspaceSearch,
} from "../navigation.ts";
export function useWorkspaceNavigation(
  route: WorkspaceSearch,
  beforeNavigate: () => void,
  closeFinder: () => void,
) {
  const navigate = useNavigate({ from: "/" });
  const resolve = useAtomSet(resolveResource, { mode: "promiseExit" });
  const selectionRequest = useRef(0);
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const returnInspectorFocus = () => {
    const origin = inspectorOrigin.current;
    return (
      (origin?.checkVisibility() ? origin : null) ??
      document.querySelector<HTMLElement>(".phone-navigation a") ??
      document.querySelector<HTMLElement>('[aria-label="Toggle work finder"]') ??
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
        void navigate({ search: searchForResource(result.value) });
        closeFinder();
      }
      void openTarget();
    },
    [resolve, navigate, beforeNavigate, closeFinder],
  );
  const openSurface = useCallback(
    (surface: NonNullable<WorkspaceSearch["surface"]>) => {
      selectionRequest.current++;
      inspectorOrigin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      beforeNavigate();
      void navigate({ search: { surface } });
      closeFinder();
    },
    [beforeNavigate, navigate, closeFinder],
  );
  const selected = resourceFromSearch(route)?.issue_id;
  const tab = route.tab ?? "Overview";
  const setTab = (tab: InspectorTab) => {
    void navigate({ search: { issue: selected, tab } });
  };
  const closeInspector = (focus?: HTMLElement | null) => {
    if (focus) inspectorOrigin.current = focus;
    selectionRequest.current++;
    beforeNavigate();
    void navigate({ search: {} }).then(() => {
      requestAnimationFrame(() => {
        const origin = returnInspectorFocus();
        if (origin) origin.focus({ preventScroll: true });
      });
    });
  };
  const focusForm = (id: string) => {
    selectionRequest.current++;
    void navigate({ search: {} }).then(() =>
      requestAnimationFrame(() => {
        const form = document.querySelector<HTMLElement>(
          `[data-native-form-id="${CSS.escape(id)}"]`,
        );
        form?.scrollIntoView({ block: "center" });
        form?.focus({ preventScroll: true });
      }),
    );
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
