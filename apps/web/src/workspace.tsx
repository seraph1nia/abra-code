import { Recap } from "./recap-loader.tsx";
import { MessageContent, emptyAttachments, emptyDiagnostics } from "./message-content.tsx";
import { Composer } from "./composer.tsx";
import { workspaceDraft, AttachSelection, type DraftAttachment } from "./workspace-state/draft.ts";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles, Settings, SunMoon } from "@abracode/presentation/icons";
import { useWorkspaceNavigation } from "./workspace-state/navigation.ts";
import { useTranscriptViewport } from "./workspace-state/viewport.ts";

/* oxlint-disable effecttsgo/unstable-api-usage -- Workspace presentation consumes the typed Effect atom layer. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider } from "./workspace-provider.tsx";
import { useAtomSet, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { bootstrapQuery } from "./data.ts";
import { useWorkspace } from "./use-workspace.ts";
import { requestError } from "./request-error.ts";
import { deferred } from "./deferred.tsx";
const RetainedSurfaces = deferred<
  React.ComponentProps<typeof import("./presentation/attachments.tsx").RetainedSurfaces>
>(
  () =>
    import("./presentation/attachments.tsx").then((module) => ({
      default: module.RetainedSurfaces,
    })),
  "Retained presentation",
);
const WorkFinder = deferred<React.ComponentProps<typeof import("./work-finder.tsx").WorkFinder>>(
  () => import("./work-finder.tsx").then((module) => ({ default: module.WorkFinder })),
  "Work finder",
  "deferred-panel",
  ({ shown }) => shown,
);
const AttentionPanel = deferred<
  React.ComponentProps<typeof import("./presentation/attention-panel.tsx").AttentionPanel>
>(
  () =>
    import("./presentation/attention-panel.tsx").then((module) => ({
      default: module.AttentionPanel,
    })),
  "Current attention",
);
const Inspector = deferred<React.ComponentProps<typeof import("./inspector.tsx").Inspector>>(
  () => import("./inspector.tsx").then((module) => ({ default: module.Inspector })),
  "Work inspection",
  "deferred-panel",
);
import {
  OpenSurface,
  workspaceSearch,
  resourceFromSearch,
  type WorkspaceSearch,
} from "./navigation.ts";
import { useNativeToolRendering } from "./presentation/tools.tsx";
import { useTheme } from "./theme.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { Badge } from "@abracode/presentation/ui/badge";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

type LayoutProps = { route: WorkspaceSearch; active: boolean; phone: boolean };

export function Application(props: LayoutProps) {
  const initial = useAtomValue(bootstrapQuery);
  const retry = useAtomRefresh(bootstrapQuery);
  const [connected, setConnected] = useState<WorkspaceSnapshot>();
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Retain the first authoritative bootstrap across subsequent resource refreshes.
    if (!connected && AsyncResult.isSuccess(initial)) setConnected(initial.value);
  }, [initial, connected]);
  const snapshot = connected ?? (AsyncResult.isSuccess(initial) ? initial.value : undefined);
  useEffect(() => {
    if (snapshot || !AsyncResult.isFailure(initial)) return;
    const timer = setTimeout(retry, 2000);
    return () => clearTimeout(timer);
  }, [initial, retry, snapshot]);
  if (!snapshot)
    return (
      <main className="loading">
        <div className="brand-mark">a</div>
        <h1>AbraCode</h1>
        <output>
          {AsyncResult.isFailure(initial) ? requestError(initial.cause) : "Connecting to Abra…"}
        </output>
      </main>
    );
  return (
    <WorkspaceProvider>
      <Workspace key={snapshot.session_id} initial={snapshot} {...props} />
    </WorkspaceProvider>
  );
}
function Workspace({
  initial,
  route,
  active,
  phone,
}: { initial: WorkspaceSnapshot } & LayoutProps) {
  useNativeToolRendering();
  const {
    workspace,
    isReady,
    stateError,
    error,
    setError,
    connectionError,
    refresh,
    messages,
    presentations,
    hasHistory,
    loadingHistory,
    loadHistory,
  } = useWorkspace(initial);
  const [finder, setFinder] = useState({ open: false, opened: false });
  const sidebar = Boolean(route.view === "finder" || (!phone && finder.open));
  const finderOpened = finder.opened;
  const setSidebar = useCallback(
    (open: boolean) => setFinder((previous) => ({ open, opened: previous.opened || open })),
    [],
  );

  const [canvasWidth, setCanvasWidth] = useState(39);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [retainedViews, setRetainedViews] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate({ from: "/" });
  const router = useRouter();
  const inspecting = Boolean(resourceFromSearch(route) || route.surface);
  const phoneCanvas = phone && (inspecting || Boolean(route.view));
  const chatVisible = active && !phoneCanvas;
  const lastInspection = useRef<WorkspaceSearch | undefined>(undefined);
  const memoryKey = "abra-canvas-v1-" + initial.session_id;
  useEffect(() => {
    if (!active) return;
    if (route.view === "canvas") {
      let next: WorkspaceSearch = lastInspection.current ?? { view: "finder" };
      try {
        const saved = workspaceSearch(JSON.parse(sessionStorage.getItem(memoryKey) ?? "{}"));
        if (saved.surface || resourceFromSearch(saved)) next = saved;
      } catch {
        /* Storage can be disabled in private browsing. */
      }
      void navigate({ search: next, replace: true });
    } else if (inspecting) {
      lastInspection.current = route;
      try {
        sessionStorage.setItem(memoryKey, JSON.stringify(route));
      } catch {
        /* Direct links still work when storage is unavailable. */
      }
    }
  }, [active, inspecting, memoryKey, navigate, route]);
  const viewport = useTranscriptViewport(
    messages,
    loadingHistory,
    `${resourceFromSearch(route)?.issue_id ?? ""}/${sidebar}/${chatVisible}`,
  );
  useEffect(
    () => router.subscribe("onBeforeNavigate", viewport.rememberPosition),
    [router, viewport.rememberPosition],
  );
  const closeFinder = useCallback(() => setSidebar(false), [setSidebar]);
  const navigation = useWorkspaceNavigation(route, viewport.rememberPosition, closeFinder);
  const { selected, tab, inspect, setTab, closeInspector, returnInspectorFocus } = navigation;
  const { scroller, transcript, bottom, rememberPosition } = viewport;
  const setDraft = useAtomSet(workspaceDraft(initial.session_id));
  const attachmentIndex = useMemo(
    () => groupByMessage(presentations.entries),
    [presentations.entries],
  );
  const diagnosticIndex = useMemo(
    () => groupByMessage(presentations.diagnostics),
    [presentations.diagnostics],
  );
  const managementAttention = workspace.work.management?.entries ?? [];
  const attention =
    workspace.forms.filter((item) => item.active).length + workspace.permissions.length;
  const workAttention = (workspace.work.fleet?.attention ?? []).filter(
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
  const work = workspace.work.work.find((w) => w.issue_id === selected);
  const attachedViews = new Set(
    presentations.entries.flatMap((entry) =>
      entry.target.kind === "surface"
        ? [`${entry.target.surface_id}/${entry.target.revision}`]
        : [],
    ),
  );
  for (const message of messages)
    for (const tool of message.tools ?? [])
      if (tool.presentation?.kind === "surface")
        attachedViews.add(`${tool.presentation.surface_id}/${tool.presentation.revision}`);
  const otherViews = workspace.surfaces.filter(
    (record) =>
      "unavailable" in record ||
      !attachedViews.has(
        `${"surface" in record ? record.surface.createSurface.surfaceId : record.surface_id}/${record.revision}`,
      ),
  );
  function open(id: string, nextTab = "Overview") {
    const target = resourceFromSearch(workspaceSearch({ issue: id, tab: nextTab }));
    if (target) inspect(target);
  }
  useEffect(() => {
    if (!phoneCanvas) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeInspector();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [phoneCanvas, closeInspector]);

  function focusForm(id: string) {
    if (!workspace.forms.some((item) => item.active && item.form.id === id)) {
      setError(
        "The native answer form is no longer current. Ask Abra to reconcile the existing decision.",
      );
      return;
    }
    setAttentionOpen(true);
    navigation.focusForm(id);
  }

  function focusComposer() {
    const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="Message Abra"]');
    if (
      phoneCanvas ||
      (inspecting && (route.canvas || matchMedia("(max-width: 1250px)").matches))
    ) {
      closeInspector(composer);
    } else {
      composer?.focus();
    }
  }

  function attach(attachment: DraftAttachment) {
    setDraft({ attachment });
    focusComposer();
  }

  function ask(text: string) {
    setDraft({ text });
    focusComposer();
  }
  return (
    <OpenSurface.Provider value={navigation.openSurface}>
      <div
        role="presentation"
        style={{ "--canvas-width": canvasWidth + "%" } as React.CSSProperties}
        className={`workspace ${phoneCanvas ? "phone-canvas" : ""} ${selected || route.surface ? "inspecting" : ""} ${sidebar ? "finding" : ""}`}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "f") viewport.onReadingIntent();
          if (event.key === "Escape" && !phoneCanvas && !event.defaultPrevented) {
            rememberPosition();
            setSidebar(false);
            if (!sidebar || route.view) closeInspector();
          }
        }}
      >
        <header className="topbar" hidden={phoneCanvas}>
          <div className="brand">
            <Button
              variant="ghost"
              hidden={phone}
              aria-label="Toggle work finder"
              aria-expanded={sidebar}
              onClick={() => {
                rememberPosition();
                if (route.view) closeInspector();
                else setSidebar(!sidebar);
              }}
            >
              Work
            </Button>
            <h1>Abra</h1>
          </div>
          <div className="topbar-end">
            <output className="connection">
              <span
                className={`status-dot ${connectionError ? "blocked" : workspace.busy ? "in_progress" : "open"}`}
              />
              <span className="connection-label">
                {connectionError
                  ? "Reconnecting"
                  : workspace.busy
                    ? "Abra is working"
                    : "Abra is ready"}
              </span>
            </output>
            <Button
              variant="outline"
              aria-expanded={attentionOpen}
              onClick={() => setAttentionOpen(!attentionOpen)}
            >
              Attention{" "}
              <Badge variant="secondary">
                {attention + workAttention.length + managementAttention.length}
                {workspace.work.fleet?.attention_truncated || workspace.work.management?.truncated
                  ? "+"
                  : ""}
              </Badge>
            </Button>
            <Link
              hidden={phone}
              to="/settings"
              className="settings-link header-icon"
              aria-label="Settings"
              title="Settings"
            >
              <Settings aria-hidden="true" />
            </Link>
            <div className="header-icon appearance" title="Color theme">
              <SunMoon aria-hidden="true" />
              <NativeSelect
                aria-label="Color theme"
                className="theme-select"
                value={theme}
                onChange={(e) =>
                  setTheme(
                    e.target.value === "light" || e.target.value === "dark"
                      ? e.target.value
                      : "system",
                  )
                }
              >
                <option value="system">System theme</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </NativeSelect>
            </div>
          </div>
        </header>
        {(sidebar || finderOpened) && (
          <WorkFinder
            shown={sidebar}
            close={() => {
              setSidebar(false);
              if (route.view) closeInspector();
            }}
            workspace={workspace}
            open={open}
            ask={ask}
          />
        )}
        {phone && inspecting && (
          <Link className="phone-find-work" to="/" search={{ view: "finder" }}>
            Find other work
          </Link>
        )}
        <main className="main-pane" hidden={phoneCanvas}>
          <Recap
            key={workspace.session_id}
            session={workspace.session_id}
            work={workspace.work.work}
            selected={selected}
            tab={tab}
            view={JSON.stringify(route)}
            open={open}
          />
          {(attention > 0 ||
            workAttention.length > 0 ||
            managementAttention.length > 0 ||
            workspace.forms.length > 0 ||
            (workspace.work.management?.diagnostic_count ?? 0) > 0) && (
            <AttentionPanel
              workspace={workspace}
              workAttention={workAttention}
              attention={attention}
              attentionOpen={attentionOpen}
              reviewNext={() => setAttentionOpen(true)}
              refresh={refresh}
              open={open}
              inspect={inspect}
            />
          )}
          <div
            className="conversation-scroll"
            ref={scroller}
            onScroll={viewport.onScroll}
            onWheel={viewport.onReadingIntent}
            onPointerDownCapture={viewport.onReadingIntent}
            onKeyDownCapture={viewport.onReadingIntent}
          >
            <div
              className="transcript"
              ref={transcript}
              role="log"
              aria-label="Conversation with Abra"
            >
              {hasHistory && (
                <Button
                  variant="ghost"
                  className="load-history"
                  disabled={loadingHistory}
                  onClick={() => void loadHistory(viewport.beforeHistory)}
                >
                  {loadingHistory ? "Loading…" : "Load earlier messages"}
                </Button>
              )}
              {!messages.length && (
                <section className="welcome">
                  <div className="welcome-symbol">
                    <Sparkles aria-hidden="true" />
                  </div>
                  <h2>What would you like to build?</h2>
                  <p>
                    Explore an idea, plan your next change, or check on work in progress. Abra
                    brings it all together.
                  </p>
                  <div className="suggestions">
                    {[
                      "Show me what needs attention",
                      "Help me onboard a project",
                      "Visualize my work in progress",
                    ].map((text) => (
                      <Button variant="ghost" key={text} onClick={() => ask(text)}>
                        {text} <ArrowUpRight aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                </section>
              )}
              {messages.map((message) => (
                <MessageContent
                  key={message.id}
                  message={message}
                  work={workspace.work.work}
                  inspect={inspect}
                  attachments={attachmentIndex.get(message.id) ?? emptyAttachments}
                  diagnostics={diagnosticIndex.get(message.id) ?? emptyDiagnostics}
                />
              ))}
              {presentations.truncated && (
                <output className="muted">
                  Presentation references exceed this conversation page's coverage. Retained task
                  reports remain available through inspection.
                </output>
              )}
              {otherViews.length > 0 && (
                <details
                  className="retained-views"
                  open={retainedViews}
                  onToggle={(event) => setRetainedViews(event.currentTarget.open)}
                >
                  <summary>Other retained views ({otherViews.length})</summary>
                  <p className="muted">
                    These layouts are outside the loaded message associations. Legacy layouts retain
                    only the latest known revision and may lack producing-message provenance.
                  </p>
                  {retainedViews && (
                    <RetainedSurfaces
                      entries={otherViews}
                      work={workspace.work.work}
                      inspect={inspect}
                    />
                  )}
                </details>
              )}
              {workspace.inbox.map((item) => (
                <div className="queued-message" key={item.id}>
                  <span className="pill">Queued · {item.delivery}</span>
                  <p>{item.text}</p>
                </div>
              ))}
              <div ref={bottom} />
            </div>
          </div>
          <Composer
            workspace={workspace}
            isReady={isReady}
            refresh={refresh}
            error={error}
            setError={setError}
            stateError={stateError}
            connectionError={connectionError}
          />
        </main>
        {(selected || route.surface) && (
          <AttachSelection.Provider value={attach}>
            <Inspector
              width={canvasWidth}
              resize={setCanvasWidth}
              issue={selected}
              surface={route.surface}
              work={work}
              tab={tab}
              setTab={setTab}
              close={() => closeInspector()}
              returnFocus={returnInspectorFocus}
              forms={workspace.forms}
              focusForm={focusForm}
              inspect={inspect}
              ask={ask}
            />
          </AttachSelection.Provider>
        )}
      </div>
    </OpenSurface.Provider>
  );
}

function groupByMessage<A extends { message_id: string }>(entries: readonly A[]) {
  const result = new Map<string, A[]>();
  for (const entry of entries) {
    const group = result.get(entry.message_id) ?? [];
    group.push(entry);
    result.set(entry.message_id, group);
  }
  return result;
}
