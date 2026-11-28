import { usableForm } from "@abracode/contracts/visibility/attention";
import { WorkspaceActions } from "./workspace-actions.ts";
import { LiveActivities } from "./presentation/activity-reference.tsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { Button } from "@abracode/presentation/ui/button";
import { Bell } from "@abracode/presentation/icons";
import { WorkspaceTopbar } from "./workspace-topbar.tsx";
import { WorkspaceHubs } from "./workspace-hubs.tsx";
import { WorkspaceTranscript } from "./workspace-transcript.tsx";
import { ToolRenderingProvider } from "./presentation/tools.tsx";
import { type ComposerCommand } from "./workspace-commands.ts";
import { ReaderSplit } from "./reader-split.tsx";
import { useMediaQuery } from "./use-media-query.ts";
import {
  resourceFromSearch,
  workspaceSearch,
  type Destination,
  type WorkspaceSearch,
} from "./navigation.ts";
import { Palette } from "./palette-loader.tsx";
import type { PaletteActions } from "./workspace-palette.tsx";
import { SearchTrigger } from "./search-trigger.tsx";
import { useRecordInspection } from "./recently-inspected.tsx";
import { Composer } from "./composer.tsx";
import { workspaceDraft, type DraftAttachment } from "./workspace-state/draft.ts";
import { useWorkspaceNavigation } from "./workspace-state/navigation.ts";
import {
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

const retryBootstrap = bootstrapQuery.pipe(Atom.withRefresh("2 seconds"), Atom.setIdleTTL(0));
const connecting = Atom.make((get) => {
  const result = get(bootstrapQuery);
  return AsyncResult.isFailure(result) ? get(retryBootstrap) : result;
});
export function Application(props: LayoutProps) {
  const initial = useAtomValue(connecting);
  const [connected, setConnected] = useState<WorkspaceSnapshot>();
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Retain the first authoritative bootstrap across subsequent resource refreshes.
    if (!connected && AsyncResult.isSuccess(initial)) setConnected(initial.value);
  }, [initial, connected]);
  const snapshot = connected ?? (AsyncResult.isSuccess(initial) ? initial.value : undefined);
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
  const view = useWorkspace(initial);
  const {
    workspace,
    isReady,
    stateError,
    error,
    setError,
    connectionError,
    refresh,
    messages,
    activities,
    hasHistory,
    loadingHistory,
    loadHistory,
  } = view;
  const wide = useMediaQuery("(min-width: 1251px)");
  const [thoughtToken, setThoughtToken] = useState<{ text: string; start: number; end: number }>();
  const layoutKey = destination + "/" + (resourceFromSearch(route)?.issue_id ?? "");
  const taskPage = destination === "/work" && Boolean(resourceFromSearch(route)?.issue_id);
  const [layout, setLayout] = useState<{ key: string; expanded: boolean }>();
  const expanded = layout?.key === layoutKey ? layout.expanded : taskPage;
  const setExpanded = useCallback(
    (expanded: boolean) => setLayout({ key: layoutKey, expanded }),
    [layoutKey],
  );

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
  usePhoneEscape(phoneCanvas, Boolean(palette), closeInspector);

  const setDraft = useAtomSet(workspaceDraft(initial.session_id));

  const nextDecision = workspace.forms.find(
    (item) => item.checkpoint?.issue_id && usableForm(item),
  );
  const nextForm = nextDecision ?? workspace.forms.find(usableForm);
  const focusDecision = navigation.focusDecision;
  const observedDecision = useRef(new Set<string>());
  useEffect(() => {
    const issue = nextDecision?.checkpoint?.issue_id;
    if (!issue || !nextDecision || !active || !isReady) return;
    const { form, binding } = nextDecision;
    const key = "abra-opened-decision/" + form.sessionID + "/" + form.id + "/" + binding;
    if (observedDecision.current.has(key)) return;
    observedDecision.current.add(key);
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* In-memory observation still prevents reopening. */
    }
    const scroll = viewport.scroller.current;
    if (
      !wide ||
      inspecting ||
      destination !== "/" ||
      palette ||
      selectedMessage ||
      document.visibilityState !== "visible" ||
      composerRef.current?.value ||
      document.activeElement?.matches("textarea,input,select,[contenteditable=true]") ||
      (scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80)
    )
      return;
    focusDecision(issue, { id: form.id, binding });
  }, [
    active,
    isReady,
    wide,
    inspecting,
    destination,
    palette,
    selectedMessage,
    nextDecision,
    focusDecision,
    composerRef,
    viewport.scroller,
  ]);

  const attention = workspace.forms.filter(usableForm).length + workspace.permissions.length;
  const workAttention = unmatchedWorkAttention(workspace);

  const activeWorkCount = workspace.work.work.filter(
    (item) => item.issue_status !== "closed",
  ).length;
  const work = workspace.work.work.find((w) => w.issue_id === selected);
  const historyWritable = useRecordInspection(
    workspace.session_id,
    active ? selected : undefined,
    work?.title,
  );

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
    if (form.checkpoint?.issue_id) {
      setExpanded(false);
      focusDecision(form.checkpoint.issue_id, { id: form.form.id, binding: form.binding });
    } else navigation.focusForm(id, form.binding);
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
  }, [desktopExpanded, focusComposer, setError, setExpanded]);
  const attach = useCallback(
    (attachment: DraftAttachment) => {
      if (!canPrepare()) return;
      setDraft({ attachment });
      if (desktopExpanded) setExpanded(false);
      focusComposer();
    },
    [canPrepare, setDraft, desktopExpanded, focusComposer, setExpanded],
  );
  const ask = useCallback(
    (text: string) => {
      if (!canPrepare()) return;
      setDraft({ append: text });
      if (desktopExpanded) setExpanded(false);
      focusComposer();
    },
    [canPrepare, setDraft, desktopExpanded, focusComposer, setExpanded],
  );

  const actions = useMemo(
    () => ({ attach, prepare: ask, openSurface: navigation.openSurface }),
    [attach, ask, navigation.openSurface],
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
    <WorkspaceHubs
      destination={destination}
      collectionVisible={collectionVisible}
      focusForm={focusForm}
      attentionOpen={attentionOpen}
      workspace={workspace}
      route={route}
      historyWritable={historyWritable}
      open={open}
      inspect={inspect}
      ask={ask}
      attention={attention}
      workAttention={workAttention}
      refresh={refresh}
      discuss={(thought) => {
        if (!canPrepare()) return;
        setDraft({ thought, consume: thoughtToken });
        setThoughtToken(undefined);
        if (desktopExpanded) setExpanded(false);
        focusComposer();
      }}
    />
  );
  const inspectorView = (selected || route.surface || route.retained || route.review) && (
    <Inspector
      taskPage={taskPage}
      openChat={() => {
        setExpanded(false);
        focusComposer();
      }}
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
  );

  const canvasPane = (
    <div className="unified-canvas" hidden={wide ? !desktopCanvasOpen : !inspecting}>
      {wide && collectionHubs}
      {inspectorView}
    </div>
  );

  const panels = (
    <>
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
          <WorkspaceTopbar
            destination={destination}
            busy={workspace.busy}
            connectionError={connectionError}
            wide={wide}
            activeWorkCount={activeWorkCount}
            totalAttention={attention}
            desktopCanvasOpen={desktopCanvasOpen}
            desktopExpanded={desktopExpanded}
            showExpand={desktopCanvasOpen && !route.canvas}
            lastInspection={lastInspection}
            setExpanded={setExpanded}
          />
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

              <WorkspaceTranscript view={view} viewport={viewport} inspect={inspect} />
              {attention > 0 &&
                (!nextDecision ||
                  route.decision?.id !== nextDecision.form.id ||
                  route.decision.binding !== nextDecision.binding) && (
                  <div className="composer-attention-dock">
                    <div className="composer-attention-bar">
                      <span className="composer-attention-text">
                        <Bell aria-hidden="true" />
                        <strong>
                          {nextDecision
                            ? nextDecision.form.title
                            : `${attention} pending ${attention === 1 ? "decision" : "decisions"}`}
                        </strong>
                      </span>
                      <Button
                        className="attention-shortcut"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (nextForm) focusForm(nextForm.form.id);
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
                        {nextDecision ? "Review decision" : "Review next"}
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
    </>
  );
  return (
    <LiveActivities.Provider value={activities}>
      <WorkspaceActions.Provider value={actions}>{panels}</WorkspaceActions.Provider>
    </LiveActivities.Provider>
  );
}
