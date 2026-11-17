/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useCallback, useRef } from "react";
import { useAtomSet } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Exit } from "effect";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { resolveResource } from "../data.ts";
import { requestError } from "../request-state.tsx";
import { resourceFromSearch, searchForResource, type InspectorTab } from "../navigation.ts";
export function useWorkspaceNavigation(
  beforeNavigate: () => void,
  closeFinder: () => void,
  setError: (text: string) => void,
) {
  const route = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const resolve = useAtomSet(resolveResource, { mode: "promiseExit" });
  const selectionRequest = useRef(0);
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const returnInspectorFocus = () => {
    const origin = inspectorOrigin.current;
    return (
      (origin?.isConnected ? origin : null) ??
      document.querySelector<HTMLElement>('[aria-label="Toggle work finder"]') ??
      false
    );
  };
  const inspect = useCallback(
    (target: ResourceSelection) => {
      const request = ++selectionRequest.current;
      const address = window.location.href;
      const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void resolve({ payload: target }).then((result) => {
        if (request !== selectionRequest.current || window.location.href !== address) return;
        if (Exit.isFailure(result)) setError(requestError(result.cause));
        else {
          inspectorOrigin.current = origin;
          beforeNavigate();
          void navigate({ search: searchForResource(result.value) });
          closeFinder();
        }
      });
    },
    [resolve, navigate, setError, beforeNavigate, closeFinder],
  );
  const selected = resourceFromSearch(route)?.issue_id;
  const tab = route.tab ?? "Overview";
  const setTab = (tab: InspectorTab) => {
    void navigate({ search: { issue: selected, tab } });
  };
  const closeInspector = () => {
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
  return { selected, tab, inspect, setTab, closeInspector, returnInspectorFocus, focusForm };
}
