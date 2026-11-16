import { Markdown } from "./markdown.tsx";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { useWorkspaceNavigation } from "./workspace-state/navigation.ts";
import { useTranscriptViewport } from "./workspace-state/viewport.ts";
import { MessageAttachment, RetainedSurfaces } from "./presentation/attachments.tsx";
/* oxlint-disable effecttsgo/unstable-api-usage -- Workspace presentation consumes the typed Effect atom layer. */
import React, { useEffect, useRef, useState } from "react";
import { WorkspaceProvider } from "./workspace-provider.tsx";
import { Textarea } from "@abracode/presentation/ui/textarea";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Exit } from "effect";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { bootstrapQuery, stopMutation } from "./data.ts";
import { useWorkspace } from "./use-workspace.ts";
import { requestError } from "./request-state.tsx";
import { NativeForm, NativePermission } from "./attention.tsx";
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
import { orderedParts } from "@abracode/contracts/web/transcript";
import { useNativeToolRendering, ToolObservation } from "./presentation/tools.tsx";
import { useTheme } from "./theme.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

export function Application() {
  const initial = useAtomValue(bootstrapQuery);
  const retry = useAtomRefresh(bootstrapQuery);
  const [connected, setConnected] = useState<WorkspaceSnapshot>();
  useEffect(() => {
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
        <p role="status">
          {AsyncResult.isFailure(initial) ? requestError(initial.cause) : "Connecting to Abra…"}
        </p>
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
    draft,
    setDraft,
    pending,
    admitting,
    refresh,
    send,
    messages,
    presentations,
    hasHistory,
    loadingHistory,
    loadHistory,
  } = useWorkspace(initial);
  const [sidebar, setSidebar] = useState(false);
  const [finderOpened, setFinderOpened] = useState(false);
  useEffect(() => {
    if (sidebar) setFinderOpened(true);
  }, [sidebar]);

  const [attentionOpen, setAttentionOpen] = useState(true);
  const [retainedViews, setRetainedViews] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigation = useWorkspaceNavigation(
    () => viewport.rememberPosition(),
    () => setSidebar(false),
    setError,
  );
  const { selected, tab, inspect, setTab, closeInspector, returnInspectorFocus } = navigation;
  const viewport = useTranscriptViewport(messages, loadingHistory, `${selected ?? ""}/${sidebar}`);
  const { scroller, transcript, bottom, rememberPosition } = viewport;
  const [stopResult, stop] = useAtom(stopMutation, { mode: "promiseExit" });
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
      data-copilotkit=""
      className={`workspace ${selected ? "inspecting" : ""} ${sidebar ? "finding" : ""}`}
      onKeyDown={(event) => {
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
        <div className="conversation-scroll" ref={scroller} onScroll={viewport.onScroll}>
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
                <details key={`${entry.lead_id}/${entry.repository_id}`} data-management-attention>
                  <summary>
                    {entry.lead_id} · {entry.repository_id} · {entry.unanswered} unanswered ·{" "}
                    {entry.proposals} unaccepted proposals
                  </summary>
                  <LazyLeadAttention entry={entry} inspect={inspect} />
                </details>
              ))}
              {workspace.work.management?.truncated && (
                <p role="status">Lead attention coverage is limited to 20 repository/lead pairs.</p>
              )}
              {(workspace.work.management?.diagnostic_count ?? 0) > 0 && (
                <p role="status">
                  Some retained lead evidence is unavailable. Inspect scoped lead diagnostics before
                  assuming there is no pending work.
                </p>
              )}
              {workspace.work.fleet?.attention_truncated && (
                <p role="status" className="muted">
                  Attention coverage is limited. Additional retained obligations may be available
                  through Work.
                </p>
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
                <div className="welcome-symbol">✳</div>
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
                      {text} ↗
                    </Button>
                  ))}
                </div>
              </section>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message ${message.role}`}
                data-native-message-id={message.id}
              >
                <div className="message-avatar">
                  {message.role === "user" ? "You" : message.role === "system" ? "·" : "a"}
                </div>
                <div className="message-body">
                  <header>
                    <strong>
                      {message.role === "user"
                        ? "You"
                        : message.role === "system"
                          ? "Session"
                          : "Abra"}
                    </strong>
                    <time dateTime={message.at}>
                      {new Date(message.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </header>
                  {message.role === "assistant"
                    ? orderedParts(message).map((part, index) => {
                        if (part.type === "text")
                          return (
                            <Markdown
                              key={`text-${index}`}
                              className="message-text prose"
                              content={part.text}
                            />
                          );
                        const tool = message.tools?.find((tool) => tool.id === part.tool_id);
                        return tool ? (
                          <ToolObservation
                            key={tool.id}
                            messageID={message.id}
                            tool={tool}
                            inspect={inspect}
                            work={workspace.work.work}
                            attachments={presentations.entries.filter(
                              (attachment) =>
                                attachment.message_id === message.id &&
                                attachment.tool_call_id === tool.id,
                            )}
                          />
                        ) : null;
                      })
                    : message.text && <div className="message-text">{message.text}</div>}
                  {message.files?.map((f) => (
                    <p className="attachment" key={f}>
                      ▧ {f}
                    </p>
                  ))}
                  {presentations.entries
                    .filter(
                      (attachment) =>
                        attachment.message_id === message.id &&
                        (!attachment.tool_call_id ||
                          !message.tools?.some((tool) => tool.id === attachment.tool_call_id)),
                    )
                    .map((attachment) => (
                      <MessageAttachment
                        key={JSON.stringify(attachment)}
                        attachment={attachment}
                        work={workspace.work.work}
                        inspect={inspect}
                      />
                    ))}
                  {presentations.diagnostics
                    .filter((diagnostic) => diagnostic.message_id === message.id)
                    .map((diagnostic) => (
                      <p key={diagnostic.unavailable} role="status" className="error">
                        {diagnostic.unavailable}
                      </p>
                    ))}
                </div>
              </article>
            ))}
            {presentations.truncated && (
              <p className="muted" role="status">
                Presentation references exceed this conversation page's coverage. Retained task
                reports remain available through inspection.
              </p>
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
        <footer className="composer-area">
          {(error || stateError || connectionError || workspace.work_unavailable) && (
            <div role="alert" className="error-banner">
              {error || stateError || connectionError || workspace.work_unavailable}
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  refresh();
                }}
              >
                Refresh
              </Button>
            </div>
          )}
          {pending && (
            <div className="submission-status">
              <span>
                {admitting
                  ? "Submitting with a retained identity…"
                  : "Submission awaiting confirmation"}
              </span>
              {!admitting && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    void send(pending);
                  }}
                >
                  Reconcile submission
                </Button>
              )}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending && !admitting && isReady && draft.trim()) void send();
            }}
          >
            <Textarea
              aria-label="Message Abra"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                workspace.busy
                  ? "Queue a message for Abra…"
                  : "Ask Abra to explore, plan, or build…"
              }
              rows={2}
              maxLength={32768}
              disabled={!isReady || admitting || Boolean(pending)}
            />
            <div className="composer-controls">
              <span className="muted">{workspace.model ?? "Using the current model"}</span>
              <div>
                {workspace.busy && (
                  <Button
                    variant="outline"
                    type="button"
                    disabled={stopResult.waiting}
                    onClick={() => {
                      void stop({ payload: {} }).then((result) => {
                        if (Exit.isSuccess(result)) refresh();
                        else setError(requestError(result.cause));
                      });
                    }}
                  >
                    ■ Stop current Abra turn
                  </Button>
                )}
                <Button
                  type="submit"
                  aria-label="Send message"
                  className="send-button"
                  disabled={!isReady || admitting || !draft.trim() || Boolean(pending)}
                >
                  <span aria-hidden="true">↑</span>
                </Button>
              </div>
            </div>
          </form>
          <p className="composer-caption">
            Connected to the main Abra thread · Work continues when you close this page
          </p>
        </footer>
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
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = container.current?.parentElement;
    if (!details) return;
    const onToggle = () => setOpened(details.hasAttribute("open"));
    onToggle();
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);
  return (
    <div ref={container}>
      {opened && (
        <LeadsPanel
          repository={entry.repository_id}
          initialLead={entry.lead_id}
          inspect={inspect}
        />
      )}
    </div>
  );
}
