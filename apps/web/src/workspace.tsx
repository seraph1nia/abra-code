/* oxlint-disable effecttsgo/unstable-api-usage -- Workspace presentation consumes the typed Effect atom layer. */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtomSet, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { Button } from "@abracode/presentation/ui/button";
import { BriefingForms } from "./presentation/tool-context.ts";
import { useNativeToolRendering } from "./presentation/tools.tsx";
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
import { MessageContent, emptyAttachments, emptyDiagnostics } from "./message-content.tsx";
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
      <Workspace key={snapshot.session_id} initial={snapshot} {...props} />
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
  const wide = useMediaQuery("(min-width: 1251px)");
  const [retainedViews, setRetainedViews] = useState(false);
  const [thoughtToken, setThoughtToken] = useState<{ text: string; start: number; end: number }>();

  const runCommand = useContext(RunCommand);
  const navigate = useNavigate();
  const inspecting = Boolean(
    resourceFromSearch(route) || route.surface || route.retained || route.review,
  );
  const phoneCanvas = phone && (inspecting || Boolean(route.view));
  const chatVisible = active && !phoneCanvas && (destination === "/" || inspecting);
  const collectionVisible = !inspecting && destination !== "/";
  const attentionOpen = destination === "/attention" && !inspecting;

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
  function canPrepare() {
    if (!draftLocked.current) return true;
    setError("Wait for the pending submission before editing this draft.");
    focusComposer();
    return false;
  }
  function attach(attachment: DraftAttachment) {
    if (!canPrepare()) return;
    setDraft({ attachment });
    focusComposer();
  }
  function ask(text: string) {
    if (!canPrepare()) return;
    setDraft({ append: text });
    focusComposer();
  }

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
            <h1>{destinations[destination]}</h1>
            <div className="topbar-end">
              {connectionError || workspace.busy ? (
                <output>{connectionError ? "Reconnecting" : "Abra is working"}</output>
              ) : null}
              {!wide && <SearchTrigger />}
            </div>
          </header>
        )}
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
                focusComposer();
              }}
            />
          )}
          {destination === "/more" && (
            <nav aria-label="More destinations">
              <Link to="/github">GitHub</Link>
              <Link to="/settings">Settings</Link>
            </nav>
          )}
          {collectionVisible &&
            destination === "/work" &&
            route.collection?.section === "recent" && (
              <RecentlyInspected
                writable={historyWritable}
                session={workspace.session_id}
                work={workspace.work.work}
                open={open}
              />
            )}
        </section>
        <div className="collection-page" hidden={!attentionOpen}>
          <h1>Attention</h1>
          {!(attention + workAttention.length + managementAttention.length) && (
            <p>No pending attention in the observed workspace.</p>
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
        <ReaderSplit
          split={wide && inspecting && !route.canvas}
          showChat={chatVisible}
          chat={
            <main className="main-pane">
              {selectedMessage && !foundMessage && (
                <output>
                  {selectedMessage.session_id !== workspace.session_id
                    ? "This message belongs to another conversation."
                    : "This message is outside the observed history. Earlier pages may contain it."}
                </output>
              )}
              {attention > 0 && (
                <Button
                  className="attention-shortcut"
                  variant="ghost"
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
                      <span className="brand-mark" aria-hidden="true">
                        a
                      </span>{" "}
                      Abra
                    </section>
                  )}
                  <BriefingForms.Provider value={workspace.forms}>
                    {messages.map((message) => (
                      <MessageContent
                        key={message.id}
                        thoughtReceipt={thoughtReceipts.get(message.id)}
                        message={message}
                        work={workspace.work.work}
                        inspect={inspect}
                        attachments={attachmentIndex.get(message.id) ?? emptyAttachments}
                        diagnostics={diagnosticIndex.get(message.id) ?? emptyDiagnostics}
                      />
                    ))}
                  </BriefingForms.Provider>
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
                        These layouts are outside the loaded message associations. Legacy layouts
                        retain only the latest known revision and may lack producing-message
                        provenance.
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
              {!messages.length && !workspace.projects.length && (
                <Button variant="ghost" onClick={() => runCommand(composerCommands[0])}>
                  Add a project
                </Button>
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
          reader={
            (selected || route.surface || route.retained || route.review) && (
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
                />
              </AttachSelection.Provider>
            )
          }
        />
      </div>
    </OpenSurface.Provider>
  );
  return <PrepareSurfaceMessage.Provider value={ask}>{panels}</PrepareSurfaceMessage.Provider>;
}
