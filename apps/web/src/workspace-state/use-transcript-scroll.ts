import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { TranscriptMessage, WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import {
  destinationFor,
  resourceFromSearch,
  workspaceSearch,
  type Destination,
  type WorkspaceSearch,
} from "../navigation.ts";
import { useTranscriptViewport } from "./viewport.ts";

export function useInspectionMemory(
  sessionId: string,
  route: WorkspaceSearch,
  active: boolean,
  inspecting: boolean,
) {
  const navigate = useNavigate();
  const router = useRouter();
  const memoryKey = "abra-canvas-v1-" + sessionId;
  const [storedInspection, setStoredInspection] = useState<WorkspaceSearch | undefined>(() => {
    if (active && inspecting) return route;
    try {
      const saved = workspaceSearch(JSON.parse(sessionStorage.getItem(memoryKey) ?? "{}"));
      if (saved.surface || saved.retained || saved.review || resourceFromSearch(saved))
        return saved;
    } catch {
      /* Storage can be disabled in private browsing. */
    }
  });
  useEffect(
    () =>
      router.subscribe("onResolved", ({ fromLocation, toLocation }) => {
        for (const location of [toLocation, fromLocation]) {
          if (!location || !destinationFor(location.pathname)) continue;
          const candidate = workspaceSearch(location.search as Record<string, unknown>);
          if (
            candidate.surface ||
            candidate.retained ||
            candidate.review ||
            resourceFromSearch(candidate)
          ) {
            setStoredInspection((previous) =>
              JSON.stringify(previous) === JSON.stringify(candidate) ? previous : candidate,
            );
            return;
          }
        }
      }),
    [router],
  );
  const lastInspection = active && inspecting ? route : storedInspection;
  useEffect(() => {
    if (!active) return;
    if (route.view) {
      const next = route.view === "canvas" ? lastInspection : undefined;
      void navigate({ to: next ? "/" : "/work", search: next ?? {}, replace: true });
    } else if (inspecting) {
      try {
        sessionStorage.setItem(memoryKey, JSON.stringify(route));
      } catch {
        /* Direct links still work when storage is unavailable. */
      }
    }
  }, [active, inspecting, memoryKey, navigate, lastInspection, route]);
  return lastInspection;
}

export function useTranscriptScroll({
  sessionId,
  messages,
  loadingHistory,
  route,
  destination,
  active,
  chatVisible,
  phoneCanvas,
  inspecting,
  isReady,
  focusChat,
  didFocus,
}: {
  sessionId: string;
  messages: readonly TranscriptMessage[];
  loadingHistory: boolean;
  route: WorkspaceSearch;
  destination: Destination;
  active: boolean;
  chatVisible: boolean;
  phoneCanvas: boolean;
  inspecting: boolean;
  isReady: boolean;
  focusChat: boolean;
  didFocus: () => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const viewport = useTranscriptViewport(
    messages,
    loadingHistory,
    `${resourceFromSearch(route)?.issue_id ?? ""}/${destination}/${chatVisible}`,
  );
  useEffect(
    () => router.subscribe("onBeforeNavigate", viewport.rememberPosition),
    [router, viewport.rememberPosition],
  );

  const selectedMessage = route.message;
  const foundMessage =
    selectedMessage?.session_id === sessionId &&
    messages.some((m) => m.id === selectedMessage.message_id);
  useEffect(() => {
    if (foundMessage && active && selectedMessage) {
      const element = document.getElementById("message-" + selectedMessage.message_id);
      element?.scrollIntoView({ block: "center" });
      element?.focus({ preventScroll: true });
    }
  }, [active, foundMessage, selectedMessage]);

  const focusComposer = useCallback(() => {
    if (
      !chatVisible ||
      phoneCanvas ||
      (inspecting && (route.canvas || matchMedia("(max-width: 1250px)").matches))
    ) {
      void navigate({ to: "/", search: {} }).then(() =>
        requestAnimationFrame(() => composerRef.current?.focus()),
      );
    } else {
      composerRef.current?.focus();
    }
  }, [chatVisible, phoneCanvas, inspecting, route.canvas, navigate]);

  useEffect(() => {
    if (focusChat && chatVisible && !inspecting && !route.view && isReady) {
      composerRef.current?.focus({ preventScroll: true });
      didFocus();
    }
  }, [focusChat, chatVisible, inspecting, route.view, isReady, didFocus]);

  return {
    viewport,
    composerRef,
    focusComposer,
    selectedMessage,
    foundMessage,
  };
}

export function usePhoneEscape(
  phoneCanvas: boolean,
  hasPalette: boolean,
  closeInspector: () => void,
) {
  useEffect(() => {
    if (!phoneCanvas) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !hasPalette) closeInspector();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [phoneCanvas, hasPalette, closeInspector]);
}

export function groupByMessage<A extends { message_id: string }>(entries: readonly A[]) {
  const result = new Map<string, A[]>();
  for (const entry of entries) {
    const group = result.get(entry.message_id) ?? [];
    group.push(entry);
    result.set(entry.message_id, group);
  }
  return result;
}

export function unattachedSurfaces(
  surfaces: WorkspaceSnapshot["surfaces"],
  entries: readonly (typeof PresentationAttachmentSchema.Type)[],
  messages: readonly TranscriptMessage[],
) {
  const attachedViews = new Set(
    entries.flatMap((entry) =>
      entry.target.kind === "surface"
        ? [`${entry.target.surface_id}/${entry.target.revision}`]
        : [],
    ),
  );
  for (const message of messages)
    for (const tool of message.tools ?? [])
      if (tool.presentation?.kind === "surface")
        attachedViews.add(`${tool.presentation.surface_id}/${tool.presentation.revision}`);
  return surfaces.filter(
    (record) =>
      "unavailable" in record ||
      !attachedViews.has(
        `${"surface" in record ? record.surface.createSurface.surfaceId : record.surface_id}/${record.revision}`,
      ),
  );
}

export function unmatchedWorkAttention(workspace: WorkspaceSnapshot) {
  return (workspace.work.fleet?.attention ?? []).filter(
    (entry) =>
      !workspace.forms.some(
        (item) =>
          item.active &&
          (entry.form_id === item.form.id ||
            (item.checkpoint?.issue_id === entry.issue_id &&
              ((entry.key === "plan-approval" && item.checkpoint.kind === "plan") ||
                (entry.key === "merge-approval" && item.checkpoint.kind === "merge")))),
      ),
  );
}
