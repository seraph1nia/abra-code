import { HttpAgent } from "@ag-ui/client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CopilotKitProvider, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { WorkspaceSnapshot, TranscriptMessage } from "../../../src/web/contracts.ts";
import { api } from "./api.ts";
import { NativeForm, NativePermission } from "./attention.tsx";
import { WorkViews } from "./surfaces.tsx";
import { Inspector } from "./inspector.tsx";
import "./style.css";

type Pending = { request_id: string; text: string; delivery: "queue" | "steer" };
const updates = [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnMessagesChanged];
export function Application() {
  const [initial, setInitial] = useState<WorkspaceSnapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const load = () => {
      void api
        .bootstrap()
        .then((value) => {
          if (mounted) {
            setInitial(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (mounted) setError(cause instanceof Error ? cause.message : "Connection unavailable");
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  if (!initial)
    return (
      <main className="loading">
        <div className="brand-mark">a</div>
        <h1>AbraCode</h1>
        <p role="status">{error || "Connecting to Abra…"}</p>
      </main>
    );
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="abra" useSingleEndpoint={false}>
      <Workspace initial={initial} connectionError={error} />
    </CopilotKitProvider>
  );
}
function Workspace({
  initial,
  connectionError,
}: {
  initial: WorkspaceSnapshot;
  connectionError: string;
}) {
  const { agent, isReady } = useAgent({
    agentId: "abra-workspace",
    runtimeAgentId: "abra",
    threadId: initial.session_id,
    updates,
  });
  const workspace = (agent.state as { workspace?: WorkspaceSnapshot }).workspace ?? initial;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | undefined>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(`abra-pending-${initial.session_id}`) ?? "null") ??
        undefined
      );
    } catch {
      return undefined;
    }
  });
  const [admitting, setAdmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("active");
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("Overview");
  const [sidebar, setSidebar] = useState(false);
  const [view, setView] = useState<"conversation" | "views">("conversation");
  const [theme, setTheme] = useState(() => localStorage.getItem("abra-theme") ?? "system");
  const [older, setOlder] = useState<readonly TranscriptMessage[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const stream = useRef({ mounted: false });
  const senders = useRef(new Map<string, { agent: HttpAgent; admitted: boolean }>());
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("abra-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!isReady) return;
    stream.current.mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (!stream.current.mounted) return;
      void agent
        .connectAgent()
        .catch(() => {
          if (stream.current.mounted) setError("Live connection interrupted. Reconnecting…");
        })
        .finally(() => {
          if (stream.current.mounted) timer = setTimeout(connect, 2000);
        });
    };
    connect();
    return () => {
      stream.current.mounted = false;
      clearTimeout(timer);
      void agent.detachActiveRun();
      for (const sender of senders.current.values()) void sender.agent.detachActiveRun();
      senders.current.clear();
    };
  }, [agent, isReady]);
  useEffect(() => {
    if (!pending) return;
    const receipt = workspace.receipts.find((r) => r.request_id === pending.request_id);
    if (receipt?.status === "admitted") {
      const sender = senders.current.get(pending.request_id);
      if (sender) {
        sender.admitted = true;
        void sender.agent.detachActiveRun();
      }
      setPending(undefined);
      setAdmitting(false);
      localStorage.removeItem(`abra-pending-${workspace.session_id}`);
    }
    if (receipt?.status === "uncertain") {
      setAdmitting(false);
      setError(
        "Submission is uncertain. Use Reconcile submission to check the same input identity.",
      );
    }
  }, [workspace.receipts, workspace.session_id, pending]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [workspace.messages.at(-1)?.id, workspace.messages.at(-1)?.text.length]);
  const refresh = useCallback(() => {
    void api
      .bootstrap()
      .then((value) => agent.setState({ workspace: value }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed"));
  }, [agent]);
  async function send(input?: Pending) {
    const submission = input ?? {
      request_id: crypto.randomUUID(),
      text: draft.trim(),
      delivery: "queue" as const,
    };
    if (!submission.text || !isReady || admitting) return;
    setError("");
    setAdmitting(true);
    setPending(submission);
    setDraft("");
    localStorage.setItem(`abra-pending-${workspace.session_id}`, JSON.stringify(submission));
    // The observer and each admission use independent transports to the same
    // fixed native thread. Snapshot updates cannot replace a pending input.
    const sender = {
      agent: new HttpAgent({
        url: "/api/copilotkit/agent/abra/run",
        agentId: "abra",
        threadId: workspace.session_id,
        initialMessages: [{ id: submission.request_id, role: "user", content: submission.text }],
      }),
      admitted: false,
    };
    senders.current.set(submission.request_id, sender);
    try {
      await sender.agent.runAgent({
        tools: [],
        context: [],
        forwardedProps: { request_id: submission.request_id, delivery: submission.delivery },
      });
    } catch (cause) {
      if (!sender.admitted && stream.current.mounted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Submission could not be confirmed. Reconcile the same submission before sending again.",
        );
    } finally {
      senders.current.delete(submission.request_id);
      if (stream.current.mounted && !sender.admitted) {
        setAdmitting(false);
        refresh();
      }
    }
  }

  const attention = workspace.forms.length + workspace.permissions.length;
  const filtered = workspace.work.work.filter(
    (w) =>
      (!project || w.repository_id === project) &&
      (status === "all" ||
        (status === "active" && w.issue_status !== "closed") ||
        (status === "attention" &&
          (w.decisions?.length || w.attention?.length || w.issue_status === "blocked")) ||
        status === w.issue_status) &&
      `${w.title} ${w.issue_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const work = workspace.work.work.find((w) => w.issue_id === selected);
  const allMessages = [
    ...new Map([...older, ...workspace.messages].map((m) => [m.id, m])).values(),
  ];
  function open(id: string, nextTab = "Overview") {
    setSelected(id);
    setTab(nextTab);
    setSidebar(false);
  }
  function ask(text: string) {
    setDraft(text);
    setView("conversation");
    composer.current?.focus();
  }
  return (
    <div
      className={`workspace ${work ? "inspecting" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSidebar(false);
          setSelected("");
        }
      }}
    >
      <header className="topbar">
        <div className="brand">
          <button
            className="mobile-only"
            aria-label="Toggle work navigation"
            onClick={() => setSidebar(!sidebar)}
          >
            ☰
          </button>
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
            {connectionError
              ? "Reconnecting"
              : workspace.busy
                ? "Abra is working"
                : "Abra is ready"}
          </span>
          <select
            aria-label="Color theme"
            className="theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>
      <aside className={`sidebar ${sidebar ? "is-open" : ""}`} aria-label="Projects and work">
        <div className="sidebar-heading">
          <button
            className="mobile-only"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            ×
          </button>
          <span className="eyebrow">Your work</span>
          <span className="count">
            {workspace.work.work.filter((w) => w.issue_status !== "closed").length}
          </span>
        </div>
        <input
          className="search"
          aria-label="Search work"
          placeholder="Search work…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="sr-only" htmlFor="project">
          Project
        </label>
        <select id="project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {workspace.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="work-filters">
          {[
            ["active", "Active"],
            ["attention", "Needs attention"],
            ["all", "All"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>
              {label}
            </button>
          ))}
        </div>
        <nav className="work-list">
          {filtered.map((w) => (
            <button
              key={w.issue_id}
              className={`work-nav ${selected === w.issue_id ? "selected" : ""}`}
              onClick={() => open(w.issue_id)}
            >
              <div>
                <span className={`status-dot ${w.issue_status}`} />
                <span className="work-title">{w.title}</span>
              </div>
              <small>
                {w.repository_id ?? "Unassigned"} <span>· {w.phase ?? w.issue_status}</span>
              </small>
            </button>
          ))}
          {!filtered.length && (
            <p className="empty-note">No work in this view. Tell Abra what you want to build.</p>
          )}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => ask("Inspect registered projects and help me onboard a project.")}>
            ＋ Add a project
          </button>
          <span className="muted">
            One conversation. All your work.{" "}
            <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">
              Licenses
            </a>
          </span>
        </div>
      </aside>
      {sidebar && (
        <button
          className="drawer-backdrop"
          aria-label="Dismiss work navigation"
          onClick={() => setSidebar(false)}
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
          <div className="view-switch">
            <button aria-pressed={view === "conversation"} onClick={() => setView("conversation")}>
              Conversation
            </button>
            <button aria-pressed={view === "views"} onClick={() => setView("views")}>
              Work views <span>{workspace.surfaces.length}</span>
            </button>
          </div>
        </header>
        <div className="conversation-scroll">
          {attention > 0 && (
            <section className="attention" aria-label="Needs your attention">
              <div className="section-heading">
                <span className="attention-symbol">!</span>
                <h2>Needs your attention</h2>
                <span className="count">{attention}</span>
              </div>
              {workspace.forms.map((item) => (
                <NativeForm key={`${item.form.id}-${item.binding}`} item={item} refresh={refresh} />
              ))}
              {workspace.permissions.map((item) => (
                <NativePermission key={item.request.id} item={item} refresh={refresh} />
              ))}
            </section>
          )}
          {view === "views" ? (
            workspace.surfaces.length ? (
              <WorkViews records={workspace.surfaces} work={workspace.work.work} open={open} />
            ) : (
              <section className="welcome">
                <div className="eyebrow">A workspace that takes shape with you</div>
                <h2>See the work your way.</h2>
                <p>Ask Abra for a board, a timeline, or a view of what needs your attention.</p>
                <button
                  onClick={() =>
                    ask(
                      "Show my current work as a live Kanban view using render_ui and the A2UI v1 work catalog.",
                    )
                  }
                >
                  Create a work board ↗
                </button>
              </section>
            )
          ) : (
            <div className="transcript" role="log" aria-label="Conversation with Abra">
              {(cursor ?? workspace.older) && (
                <button
                  className="load-history"
                  disabled={loadingHistory}
                  onClick={() => {
                    setLoadingHistory(true);
                    void api
                      .history(cursor ?? workspace.older!)
                      .then((page) => {
                        setOlder((v) => [...page.messages, ...v]);
                        setCursor(page.older ?? "");
                      })
                      .catch((cause) => setError(String(cause)))
                      .finally(() => setLoadingHistory(false));
                  }}
                >
                  {loadingHistory ? "Loading…" : "Load earlier messages"}
                </button>
              )}
              {!allMessages.length && (
                <section className="welcome">
                  <div className="welcome-symbol">✳</div>
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
                      <button key={text} onClick={() => ask(text)}>
                        {text} ↗
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {allMessages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
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
                    {message.text && <div className="message-text">{message.text}</div>}
                    {message.files?.map((f) => (
                      <p className="attachment" key={f}>
                        ▧ {f}
                      </p>
                    ))}
                    {message.tools?.map((tool) => (
                      <details className="tool" key={tool.id}>
                        <summary>
                          <span className={`tool-indicator ${tool.status}`} />
                          {tool.name.replace(/^abra_/, "").replaceAll("_", " ")}
                          <span>{tool.status}</span>
                        </summary>
                        {tool.input && <pre>{tool.input}</pre>}
                        {tool.result && <pre>{tool.result}</pre>}
                      </details>
                    ))}
                  </div>
                </article>
              ))}
              {workspace.inbox.map((item) => (
                <div className="queued-message" key={item.id}>
                  <span className="pill">Queued · {item.delivery}</span>
                  <p>{item.text}</p>
                </div>
              ))}
              <div ref={bottom} />
            </div>
          )}
        </div>
        <footer className="composer-area">
          {(error || connectionError) && (
            <div role="alert" className="error-banner">
              {error || connectionError}
              <button
                onClick={() => {
                  setError("");
                  refresh();
                }}
              >
                Refresh
              </button>
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
                <button
                  onClick={() => {
                    void send(pending);
                  }}
                >
                  Reconcile submission
                </button>
              )}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) void send();
            }}
          >
            <textarea
              ref={composer}
              aria-label="Message Abra"
              placeholder={
                workspace.busy
                  ? "Queue a message for Abra…"
                  : "Ask Abra to explore, plan, or build…"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!pending) void send();
                }
              }}
              rows={2}
            />
            <div className="composer-controls">
              <span className="muted">{workspace.model ?? "Using the current model"}</span>
              <div>
                {workspace.busy && (
                  <button
                    type="button"
                    onClick={() => {
                      void api
                        .stop()
                        .then(refresh)
                        .catch((cause) => setError(String(cause)));
                    }}
                  >
                    ■ Stop current Abra turn
                  </button>
                )}
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={!isReady || admitting || !draft.trim() || Boolean(pending)}
                >
                  ↑
                </button>
              </div>
            </div>
          </form>
          <p className="composer-caption">
            Connected to the main Abra thread · Work continues when you close this page
          </p>
        </footer>
      </main>
      {work && (
        <Inspector work={work} tab={tab} setTab={setTab} close={() => setSelected("")} ask={ask} />
      )}
    </div>
  );
}
