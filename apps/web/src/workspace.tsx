import { LiveActivities } from "./presentation/activity-reference.tsx";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomSet, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { Button } from "@abracode/presentation/ui/button";
import { Bell, Expand, Minimize2, PanelRight } from "@abracode/presentation/icons";
import { BriefingForms } from "./presentation/tool-context.ts";
import { ToolRenderingProvider } from "./presentation/tools.tsx";
import { RunCommand, composerCommands, type ComposerCommand } from "./workspace-commands.ts";
import { ReaderSplit } from "./reader-split.tsx";
import { useMediaQuery } from "./use-media-query.ts";
import {
  OpenSurface,
  destinations,
  resourceFromSearch,
  workspaceSearch,
  type Destination,
  type WorkspaceSearch,
} from "./navigation.ts";
import { AttentionPanel } from "./attention-panel-loader.tsx";
import { Palette } from "./palette-loader.tsx";
import type { PaletteActions } from "./workspace-palette.tsx";
import { SearchTrigger } from "./search-trigger.tsx";
import { RecentlyInspected, useRecordInspection } from "./recently-inspected.tsx";
import {
  TranscriptWork,
  MessageContent,
  emptyAttachments,
  emptyDiagnostics,
} from "./message-content.tsx";
import { Composer } from "./composer.tsx";
import {
  workspaceDraft,
  PrepareSurfaceMessage,
  AttachSelection,
  type DraftAttachment,
} from "./workspace-state/draft.ts";
import { useWorkspaceNavigation } from "./workspace-state/navigation.ts";
import {
  groupByMessage,
  unattachedSurfaces,
  unmatchedWorkAttention,
  useInspectionMemory,
  usePhoneEscape,
  useTranscriptScroll,
} from "./workspace-state/use-transcript-scroll.ts";
import { WorkspaceProvider } from "./workspace-provider.tsx";
import { bootstrapQuery } from "./data.ts";
import { useWorkspace } from "./use-workspace.ts";
import { requestError } from "./request-error.ts";
import { deferred } from "@abracode/presentation/deferred";

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
const GithubInbox = deferred<React.ComponentProps<typeof import("./github-inbox.tsx").GithubInbox>>(
  () => import("./github-inbox.tsx").then((m) => ({ default: m.GithubInbox })),
  "GitHub inbox",
);
const Thoughts = deferred<React.ComponentProps<typeof import("./thoughts.tsx").Thoughts>>(
  () => import("./thoughts.tsx").then((m) => ({ default: m.Thoughts })),
  "Personal thoughts",
);
const Inspector = deferred<React.ComponentProps<typeof import("./inspector.tsx").Inspector>>(
  () => import("./inspector.tsx").then((module) => ({ default: module.Inspector })),
  "Work inspection",
  "deferred-panel",
);

type LayoutProps = {
  route: WorkspaceSearch;
  active: boolean;
  phone: boolean;
  palette?: PaletteActions;
  command?: { action: ComposerCommand };
  consumed: () => void;
  destination: Destination;
  focusChat: boolean;
  didFocus: () => void;
};

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
        {props.palette && <Palette {...props.palette} />}
        {!props.phone && <SearchTrigger />}
        <div className="brand-mark">a</div>
        <h1>AbraCode</h1>
        <output>
          {AsyncResult.isFailure(initial) ? requestError(initial.cause) : "Connecting to Abra…"}
        </output>
      </main>
    );
  return (
    <WorkspaceProvider>
      <ToolRenderingProvider>
        <Workspace key={snapshot.session_id} initial={snapshot} {...props} />
      </ToolRenderingProvider>
    </WorkspaceProvider>
  );
}

function Workspace({
  initial,
  route,
  active,
  phone,
  palette,
  destination,
  command,
  consumed,
  focusChat,
  didFocus,
}: { initial: WorkspaceSnapshot } & LayoutProps) {
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
    activities,
    hasHistory,
    loadingHistory,
    loadHistory,
  } = useWorkspace(initial);
  const wide = useMediaQuery("(min-width: 1251px)");
  const [retainedViews, setRetainedViews] = useState(false);
  const [thoughtToken, setThoughtToken] = useState<{ text: string; start: number; end: number }>();
  const [expanded, setExpanded] = useState(false);

  const runCommand = useContext(RunCommand);
  const navigate = useNavigate();
  const inspecting = Boolean(
    resourceFromSearch(route) || route.surface || route.retained || route.review,
  );
  const collectionVisible = !inspecting && destination !== "/";
  const attentionOpen = destination === "/attention" && !inspecting;
  const desktopCanvasOpen = wide && (inspecting || collectionVisible);
  const desktopExpanded = desktopCanvasOpen && expanded && !route.canvas;
  const phoneCanvas = phone && (inspecting || Boolean(route.view));
  const chatVisible =
    active && !phoneCanvas && (wide ? !desktopExpanded : destination === "/" || inspecting);
  const focusMode = wide && !desktopCanvasOpen;

  const lastInspection = useInspectionMemory(initial.session_id, route, active, inspecting);
  const { viewport, composerRef, focusComposer, selectedMessage, foundMessage } =
    useTranscriptScroll({
      sessionId: workspace.session_id,
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
    });

  const navigation = useWorkspaceNavigation(route, viewport.rememberPosition);
  const { selected, tab, inspect, setTab, closeInspector, returnInspectorFocus } = navigation;
  const { scroller, transcript, bottom } = viewport;
  usePhoneEscape(phoneCanvas, Boolean(palette), closeInspector);

  const setDraft = useAtomSet(workspaceDraft(initial.session_id));
  const attachmentIndex = useMemo(
    () => groupByMessage(presentations.entries),
    [presentations.entries],
  );
  const thoughtReceipts = useMemo(
    () =>
      new Map(workspace.receipts.filter((r) => r.thought).map((r) => [String(r.message_id), r])),
    [workspace.receipts],
  );
  const diagnosticIndex = useMemo(
    () => groupByMessage(presentations.diagnostics),
    [presentations.diagnostics],
  );
  const managementAttention = workspace.work.management?.entries ?? [];
  const attention =
    workspace.forms.filter((item) => item.active).length + workspace.permissions.length;
  const workAttention = unmatchedWorkAttention(workspace);
  const totalAttention = attention + workAttention.length + managementAttention.length;
  const activeWorkCount = workspace.work.work.filter(
    (item) => item.issue_status !== "closed",
  ).length;
  const work = workspace.work.work.find((w) => w.issue_id === selected);
  const historyWritable = useRecordInspection(
    workspace.session_id,
    active ? selected : undefined,
    work?.title,
  );
  const otherViews = unattachedSurfaces(workspace.surfaces, presentations.entries, messages);

  function open(id: string, nextTab = "Overview") {
    const target = resourceFromSearch(workspaceSearch({ issue: id, tab: nextTab }));
    if (target) inspect(target);
  }
  function focusForm(id: string, binding?: string) {
    const form = workspace.forms.find(
      (item) => item.active && item.form.id === id && (!binding || item.binding === binding),
    );
    if (!form) {
      setError(
        "The native answer form is no longer current. Ask Abra to reconcile the existing decision.",
      );
      return;
    }
    navigation.focusForm(id, form.binding);
  }

  const draftLocked = useRef(true);
  const updateDraftLock = useCallback((locked: boolean) => {
    draftLocked.current = locked;
  }, []);
  const canPrepare = useCallback(() => {
    if (!draftLocked.current) return true;
    setError("Wait for the pending submission before editing this draft.");
    if (desktopExpanded) setExpanded(false);
    focusComposer();
    return false;
  }, [desktopExpanded, focusComposer, setError]);
  const attach = useCallback(
    (attachment: DraftAttachment) => {
      if (!canPrepare()) return;
      setDraft({ attachment });
      if (desktopExpanded) setExpanded(false);
      focusComposer();
    },
    [canPrepare, setDraft, desktopExpanded, focusComposer],
  );
  const ask = useCallback(
    (text: string) => {
      if (!canPrepare()) return;
      setDraft({ append: text });
      if (desktopExpanded) setExpanded(false);
      focusComposer();
    },
    [canPrepare, setDraft, desktopExpanded, focusComposer],
  );

  const picker = palette && (
    <Palette
      {...palette}
      workspace={workspace}
      history={{
        messages,
        more: hasHistory,
        loading: loadingHistory,
        load: () => void loadHistory(viewport.beforeHistory),
      }}
      selected={selected}
      artifact={route.resource?.action === "open_artifact" ? route.resource : undefined}
      resume={lastInspection}
      chat={palette.chat}
      inspect={inspect}
      prepare={ask}
      review={attention ? () => void navigate({ to: "/attention", search: {} }) : undefined}
    />
  );
  const sheet = active && inspecting && !phone && (!wide || route.canvas);

  const collectionHubs = (
    <div className="canvas-hub-host" hidden={!collectionVisible}>
      <section
        data-scroll-restoration-id={"collection-" + destination}
        className="collection-page"
        hidden={!collectionVisible || attentionOpen}
      >
        {destination === "/work" && (
          <WorkFinder
            shown={collectionVisible}
            workspace={workspace}
            open={open}
            inspect={inspect}
          />
        )}
        {destination === "/github" && collectionVisible && (
          <GithubInbox projects={workspace.projects} open={open} ask={ask} />
        )}
        {destination === "/thoughts" && collectionVisible && (
          <Thoughts
            discuss={(thought) => {
              if (!canPrepare()) return;
              setDraft({ thought, consume: thoughtToken });
              setThoughtToken(undefined);
              if (desktopExpanded) setExpanded(false);
              focusComposer();
            }}
          />
        )}
        {destination === "/more" && (
          <nav aria-label="More destinations" className="more-nav">
            <Link to="/github">GitHub</Link>
            <Link to="/settings">Settings</Link>
          </nav>
        )}
        {collectionVisible && destination === "/work" && route.collection?.section === "recent" && (
          <RecentlyInspected
            writable={historyWritable}
            session={workspace.session_id}
            work={workspace.work.work}
            open={open}
          />
        )}
      </section>
      <div className="collection-page" hidden={!attentionOpen}>
        {!(attention + workAttention.length + managementAttention.length) && (
          <div className="empty-attention">
            <h2>Attention</h2>
            <p className="muted">No pending attention in the observed workspace.</p>
          </div>
        )}
        {(attentionOpen || workspace.forms.length > 0 || workspace.permissions.length > 0) && (
          <AttentionPanel
            workspace={workspace}
            workAttention={workAttention}
            attention={attention}
            attentionOpen={attentionOpen}
            refresh={refresh}
            open={open}
            inspect={inspect}
          />
        )}
      </div>
    </div>
  );

  const inspectorView = (selected || route.surface || route.retained || route.review) && (
    <AttachSelection.Provider value={attach}>
      <Inspector
        picker={sheet ? picker : undefined}
        issue={selected}
        surface={route.surface}
        retained={route.retained}
        review={route.review}
        work={work}
        tab={tab}
        setTab={setTab}
        close={() => closeInspector()}
        returnFocus={returnInspectorFocus}
        forms={workspace.forms}
        focusForm={focusForm}
        inspect={inspect}
        ask={ask}
        refresh={refresh}
      />
    </AttachSelection.Provider>
  );

  const canvasPane = (
    <div className="unified-canvas" hidden={wide ? !desktopCanvasOpen : !inspecting}>
      {wide && collectionHubs}
      {inspectorView}
    </div>
  );

  const panels = (
    <OpenSurface.Provider value={navigation.openSurface}>
      {!sheet && picker}
      <div
        className="workspace"
        role="presentation"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "f") viewport.onReadingIntent();
          if (event.key === "Escape" && wide && inspecting && !event.defaultPrevented)
            closeInspector();
        }}
      >
        {!phone && (
          <header className="topbar">
            <div className="topbar-left">
              <Link
                to="/"
                search={{}}
                className="brand-home-link"
                onClick={() => setExpanded(false)}
              >
                <span className="brand-mark" aria-hidden="true">
                  a
                </span>
                <span className="brand-name">AbraCode</span>
              </Link>
              <span className="topbar-sep" aria-hidden="true" />
              <h1 className="topbar-heading">{destinations[destination]}</h1>
              {connectionError || workspace.busy ? (
                <output
                  className={
                    connectionError ? "telemetry-pill is-warning" : "telemetry-pill is-running"
                  }
                >
                  <span className="telemetry-dot" aria-hidden="true" />
                  {connectionError ? "Reconnecting" : "Abra is working"}
                </output>
              ) : (
                <span className="telemetry-pill is-ready" aria-hidden="true">
                  <span className="telemetry-dot" />
                  Connected
                </span>
              )}
            </div>
            <div className="topbar-center">
              <SearchTrigger />
            </div>
            <div className="topbar-end">
              {wide && (
                <>
                  <Link
                    to="/work"
                    search={{ collection: { section: "capacity" } }}
                    className="telemetry-pill is-interactive"
                    onClick={() => setExpanded(false)}
                  >
                    <span className="telemetry-dot" aria-hidden="true" />
                    <span>
                      {activeWorkCount} active {activeWorkCount === 1 ? "task" : "tasks"}
                    </span>
                  </Link>
                  {totalAttention > 0 && (
                    <Link
                      to="/attention"
                      search={{}}
                      className="telemetry-pill is-attention is-interactive"
                      onClick={() => setExpanded(false)}
                    >
                      <Bell aria-hidden="true" />
                      <span>{totalAttention} pending</span>
                    </Link>
                  )}
                  <fieldset className="layout-mode-group" aria-label="Workspace layout">
                    <button
                      type="button"
                      className={focusMode ? "layout-mode-btn is-active" : "layout-mode-btn"}
                      onClick={() => {
                        setExpanded(false);
                        void navigate({ to: "/", search: {} });
                      }}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      className={
                        desktopCanvasOpen && !desktopExpanded
                          ? "layout-mode-btn is-active"
                          : "layout-mode-btn"
                      }
                      onClick={() => {
                        setExpanded(false);
                        if (!desktopCanvasOpen) {
                          if (lastInspection) void navigate({ to: "/", search: lastInspection });
                          else void navigate({ to: "/work", search: {} });
                        }
                      }}
                    >
                      <PanelRight aria-hidden="true" />
                      Split
                    </button>
                    {desktopCanvasOpen && !route.canvas && (
                      <button
                        type="button"
                        className={
                          desktopExpanded ? "layout-mode-btn is-active" : "layout-mode-btn"
                        }
                        aria-label={desktopExpanded ? "Show chat beside canvas" : "Expand canvas"}
                        onClick={() => setExpanded((value) => !value)}
                      >
                        {desktopExpanded ? (
                          <Minimize2 aria-hidden="true" />
                        ) : (
                          <Expand aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </fieldset>
                </>
              )}
            </div>
          </header>
        )}
        {!wide && collectionHubs}
        <ReaderSplit
          split={wide && desktopCanvasOpen && !desktopExpanded && !route.canvas}
          showChat={chatVisible}
          focusMode={focusMode}
          chat={
            <main className="main-pane">
              {selectedMessage && !foundMessage && (
                <output className="chat-notice">
                  {selectedMessage.session_id !== workspace.session_id
                    ? "This message belongs to another conversation."
                    : "This message is outside the observed history. Earlier pages may contain it."}
                </output>
              )}
              {phone && (connectionError || workspace.busy) && (
                <output className="connection">
                  {connectionError ? "Reconnecting" : "Abra is working"}
                </output>
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
                      <span className="brand-mark welcome-mark" aria-hidden="true">
                        a
                      </span>
                      <h2>Abra</h2>
                      <p className="muted">
                        Your persistent supervisor. Coordinate tasks, review plans and diffs, or
                        open any hub in the Canvas beside this thread.
                      </p>
                      {!workspace.projects.length && (
                        <div className="welcome-actions">
                          <Button variant="outline" onClick={() => runCommand(composerCommands[0])}>
                            Add a project
                          </Button>
                        </div>
                      )}
                    </section>
                  )}
                  <TranscriptWork.Provider value={workspace.work.work}>
                    <BriefingForms.Provider value={workspace.forms}>
                      {messages.map((message) => (
                        <MessageContent
                          key={message.id}
                          thoughtReceipt={thoughtReceipts.get(message.id)}
                          message={message}
                          inspect={inspect}
                          attachments={attachmentIndex.get(message.id) ?? emptyAttachments}
                          diagnostics={diagnosticIndex.get(message.id) ?? emptyDiagnostics}
                        />
                      ))}
                    </BriefingForms.Provider>
                  </TranscriptWork.Provider>
                  {presentations.truncated && (
                    <output className="muted">
                      Presentation references exceed this conversation page's coverage. Retained
                      task reports remain available through inspection.
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
                        These layouts have no matching message in the loaded conversation.
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
                  <div ref={bottom} />
                </div>
              </div>
              {attention > 0 && (
                <div className="composer-attention-dock">
                  <div className="composer-attention-bar">
                    <span className="composer-attention-text">
                      <Bell aria-hidden="true" />
                      <strong>
                        {attention} pending {attention === 1 ? "decision" : "decisions"}
                      </strong>
                    </span>
                    <Button
                      className="attention-shortcut"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const form = workspace.forms.find((f) => f.active);
                        if (form) focusForm(form.form.id);
                        else
                          void navigate({
                            to: "/attention",
                            hash:
                              "permission-" +
                              workspace.permissions[0]?.request.id +
                              "-" +
                              workspace.permissions[0]?.binding,
                          });
                      }}
                    >
                      Review next
                    </Button>
                  </div>
                </div>
              )}
              {workspace.inbox.length > 0 && (
                <div className="composer-queue-dock">
                  {workspace.inbox.map((item) => (
                    <div className="queued-message" key={item.id}>
                      <span className="pill">Queued · {item.delivery}</span>
                      <p>{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <Composer
                textareaRef={composerRef}
                updateDraftLock={updateDraftLock}
                pickThought={(consume) => {
                  setThoughtToken(consume);
                  void navigate({ to: "/thoughts", search: {} });
                }}
                command={command}
                consumed={consumed}
                workspace={workspace}
                isReady={isReady}
                refresh={refresh}
                error={error}
                setError={setError}
                stateError={stateError}
                connectionError={connectionError}
              />
            </main>
          }
          reader={wide ? canvasPane : inspectorView}
        />
      </div>
    </OpenSurface.Provider>
  );
  return (
    <LiveActivities.Provider value={activities}>
      <PrepareSurfaceMessage.Provider value={ask}>{panels}</PrepareSurfaceMessage.Provider>
    </LiveActivities.Provider>
  );
}
