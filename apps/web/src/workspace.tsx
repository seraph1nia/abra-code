import { MessageContent, emptyAttachments, emptyDiagnostics } from "./message-content.tsx";
import { Composer } from "./composer.tsx";
import { workspaceDraft } from "./workspace-state/draft.ts";
import { useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles } from "@abracode/presentation/icons";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { useWorkspaceNavigation } from "./workspace-state/navigation.ts";
import { useTranscriptViewport } from "./workspace-state/viewport.ts";
import { RetainedSurfaces } from "./presentation/attachments.tsx";
/* oxlint-disable effecttsgo/unstable-api-usage -- Workspace presentation consumes the typed Effect atom layer. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceProvider } from "./workspace-provider.tsx";
import { useAtomSet, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { bootstrapQuery } from "./data.ts";
import { useWorkspace } from "./use-workspace.ts";
import { requestError } from "./request-state.tsx";
import { NativeForm, NativePermission } from "./native-attention.tsx";
import { deferred } from "./deferred.tsx";
const WorkFinder = deferred<React.ComponentProps<typeof import("./work-finder.tsx").WorkFinder>>(
  () => import("./work-finder.tsx").then((module) => ({ default: module.WorkFinder })),
  "Work finder",
  "deferred-panel",
  ({ shown }) => shown,
);
const LeadsPanel = deferred<
  React.ComponentProps<typeof import("./presentation/leads.tsx").LeadsPanel>
>(
  () => import("./presentation/leads.tsx").then((module) => ({ default: module.LeadsPanel })),
  "Lead history",
  "deferred-panel",
);

const Inspector = deferred<React.ComponentProps<typeof import("./inspector.tsx").Inspector>>(
  () => import("./inspector.tsx").then((module) => ({ default: module.Inspector })),
  "Work inspection",
  "deferred-panel",
);
import { workspaceSearch, resourceFromSearch } from "./navigation.ts";
import { useNativeToolRendering } from "./presentation/tools.tsx";
import { useTheme } from "./theme.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

export function Application() {
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
      <Workspace key={snapshot.session_id} initial={snapshot} />
    </WorkspaceProvider>
  );
}
function Workspace({ initial }: { initial: WorkspaceSnapshot }) {
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
  const sidebar = finder.open;
  const finderOpened = finder.opened;
  const setSidebar = useCallback(
    (open: boolean) => setFinder((previous) => ({ open, opened: previous.opened || open })),
    [],
  );

  const [attentionOpen, setAttentionOpen] = useState(true);
  const [retainedViews, setRetainedViews] = useState(false);
  const { theme, setTheme } = useTheme();
  const route = useSearch({ from: "/" });
  const viewport = useTranscriptViewport(
    messages,
    loadingHistory,
    `${resourceFromSearch(route)?.issue_id ?? ""}/${sidebar}`,
  );
  const closeFinder = useCallback(() => setSidebar(false), [setSidebar]);
  const navigation = useWorkspaceNavigation(viewport.rememberPosition, closeFinder, setError);
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

  function ask(text: string) {
    setDraft(text);
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('[aria-label="Message Abra"]')?.focus(),
    );
  }
  return (
    <div
      role="presentation"
      className={`workspace ${selected ? "inspecting" : ""} ${sidebar ? "finding" : ""}`}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "f") viewport.onReadingIntent();
        if (event.key === "Escape" && !event.defaultPrevented) {
          rememberPosition();
          setSidebar(false);
          if (!sidebar) closeInspector();
        }
      }}
    >
      <header className="topbar">
        <div className="brand">
          <Button
            variant="ghost"
            aria-label="Toggle work finder"
            aria-expanded={sidebar}
            onClick={() => {
              rememberPosition();
              setSidebar(!sidebar);
            }}
          >
            Work
          </Button>
          <div className="brand-mark">a</div>
          <strong>AbraCode</strong>
          <span className="topbar-divider" />
          <span className="muted">Workspace</span>
        </div>
        <div className="topbar-end">
          <span className="connection">
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
          </span>
          <NativeSelect
            aria-label="Color theme"
            className="theme-select"
            value={theme}
            onChange={(e) =>
              setTheme(
                e.target.value === "light" || e.target.value === "dark" ? e.target.value : "system",
              )
            }
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </NativeSelect>
        </div>
      </header>
      {(sidebar || finderOpened) && (
        <WorkFinder
          shown={sidebar}
          close={() => setSidebar(false)}
          workspace={workspace}
          open={open}
          ask={ask}
        />
      )}
      <main className="main-pane">
        <header className="conversation-header">
          <div>
            <div className="eyebrow">Your main agent</div>
            <h1>
              Abra <span className="session-label">One shared session</span>
            </h1>
          </div>
          <Button
            variant="outline"
            aria-expanded={attentionOpen}
            onClick={() => setAttentionOpen(!attentionOpen)}
          >
            Attention{" "}
            <span className="count">
              {attention + workAttention.length + managementAttention.length}
              {workspace.work.fleet?.attention_truncated || workspace.work.management?.truncated
                ? "+"
                : ""}
            </span>
          </Button>
        </header>
        <div
          className="conversation-scroll"
          ref={scroller}
          onScroll={viewport.onScroll}
          onWheel={viewport.onReadingIntent}
          onPointerDownCapture={viewport.onReadingIntent}
          onKeyDownCapture={viewport.onReadingIntent}
        >
          {(attention > 0 ||
            workAttention.length > 0 ||
            managementAttention.length > 0 ||
            workspace.forms.length > 0 ||
            (workspace.work.management?.diagnostic_count ?? 0) > 0) && (
            <section
              className="attention"
              hidden={!attentionOpen}
              aria-label="Needs your attention"
            >
              <div className="section-heading">
                <span className="attention-symbol">!</span>
                <h2>Needs your attention</h2>
                <span className="count">
                  {attention + workAttention.length + managementAttention.length}
                </span>
              </div>
              {workspace.forms.map((item) => (
                <NativeForm key={`${item.form.id}-${item.binding}`} item={item} refresh={refresh} />
              ))}
              {workspace.permissions.map((item) => (
                <NativePermission key={item.request.id} item={item} refresh={refresh} />
              ))}
              {workAttention.map((entry) => (
                <div className="work-attention" key={`${entry.issue_id}:${entry.key}`}>
                  <Button variant="ghost" onClick={() => open(entry.issue_id)}>
                    {entry.title} · {entry.reason}
                  </Button>
                  <p className="muted">
                    {entry.owner === "user" ? "You" : entry.owner} · {entry.next_action}
                  </p>
                </div>
              ))}
              {managementAttention.map((entry) => (
                <LazyLeadAttention
                  key={`${entry.lead_id}/${entry.repository_id}`}
                  entry={entry}
                  inspect={inspect}
                />
              ))}
              {workspace.work.management?.truncated && (
                <output>Lead attention coverage is limited to 20 repository/lead pairs.</output>
              )}
              {(workspace.work.management?.diagnostic_count ?? 0) > 0 && (
                <output>
                  Some retained lead evidence is unavailable. Inspect scoped lead diagnostics before
                  assuming there is no pending work.
                </output>
              )}
              {workspace.work.fleet?.attention_truncated && (
                <output className="muted">
                  Attention coverage is limited. Additional retained obligations may be available
                  through Work.
                </output>
              )}
            </section>
          )}
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
                onClick={() => {
                  viewport.beforeHistory();
                  void loadHistory();
                }}
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
                  Explore an idea, plan your next change, or check on work in progress. Abra brings
                  it all together.
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
      {selected && (
        <Inspector
          issue={selected}
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
      )}
    </div>
  );
}

function LazyLeadAttention({
  entry,
  inspect,
}: {
  entry: NonNullable<WorkspaceSnapshot["work"]["management"]>["entries"][number];
  inspect: (target: ResourceSelection) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details data-management-attention onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>
        {entry.lead_id} · {entry.repository_id} · {entry.unanswered} unanswered · {entry.proposals}{" "}
        unaccepted proposals
      </summary>
      {opened && (
        <LeadsPanel
          repository={entry.repository_id}
          initialLead={entry.lead_id}
          inspect={inspect}
        />
      )}
    </details>
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
