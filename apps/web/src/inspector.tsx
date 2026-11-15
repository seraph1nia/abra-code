import { useEffect, useState } from "react";
import type {
  WebWorkItem as WorkItem,
  WorkDetailSchema,
  WorkDiffSchema,
} from "../../../src/web/wire.ts";
type WorkDetail = typeof WorkDetailSchema.Type;
type WorkDiff = typeof WorkDiffSchema.Type;
import type { WorkerInspection } from "../../../src/visibility/worker.ts";
import type { ArtifactSummarySchema } from "../../../src/web/wire.ts";
import { api } from "./api.ts";

export const inspectorTabs = [
  "Overview",
  "Plan",
  "Diff",
  "Workers",
  "Decisions",
  "Communication",
  "Feedback",
  "Reports",
];
export function Inspector({
  work,
  tab,
  setTab,
  close,
  ask,
}: {
  work: WorkItem;
  tab: string;
  setTab: (tab: string) => void;
  close: () => void;
  ask: (text: string) => void;
}) {
  const [content, setContent] = useState<unknown>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected("");
  }, [work.issue_id, tab]);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setContent(undefined);
    const name =
      tab === "Overview" || tab === "Plan"
        ? "detail"
        : tab === "Diff"
          ? "diff"
          : tab === "Workers"
            ? "worker"
            : tab === "Decisions"
              ? "decisions"
              : tab === "Communication"
                ? "messages"
                : tab === "Feedback"
                  ? "feedback"
                  : "artifacts";
    const rest: Record<string, string> = {};
    if (name === "worker") {
      const id = selected || work.sessions.at(-1)?.id;
      if (!id) {
        setContent({ note: "No worker sessions retained" });
        return;
      }
      rest.session_id = id;
    }
    if (name === "diff" && selected) rest.file = selected;
    const request =
      tab === "Plan" && selected
        ? api.read("document", work.issue_id, { path: selected })
        : api.read(name, work.issue_id, rest);
    void request
      .then((value) => {
        if (!cancelled) setContent(value);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Read unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [work.issue_id, work.phase, work.generation, tab, selected]);
  const detail = content as WorkDetail | undefined,
    diff = content as WorkDiff | undefined;
  return (
    <aside className="inspector" aria-label="Work inspector">
      <header className="inspector-header">
        <div>
          <div className="eyebrow">
            {work.repository_id ?? "Work"} · {work.issue_id}
          </div>
          <h2>{work.title}</h2>
        </div>
        <button onClick={close} aria-label="Close inspector">
          ×
        </button>
      </header>
      <nav className="tabs" aria-label="Work details">
        {inspectorTabs.map((name) => (
          <button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="inspector-content">
        {error ? (
          <p className="warning" role="status">
            {error}
          </p>
        ) : content === undefined ? (
          <p className="muted" role="status">
            Loading retained evidence…
          </p>
        ) : (
          <>
            {tab === "Overview" && (
              <>
                <div className="detail-status">
                  <span className={`status-dot ${work.issue_status}`} />
                  {work.phase ?? work.issue_status}
                  <span className="pill">P{work.priority}</span>
                </div>
                <p className="prose">{detail?.description}</p>
                {work.progress && (
                  <section>
                    <h3>Latest progress</h3>
                    <p>{work.progress.summary}</p>
                    <small>{new Date(work.progress.at).toLocaleString()}</small>
                  </section>
                )}
                {work.blockers.length > 0 && (
                  <section>
                    <h3>Readiness</h3>
                    <ul>
                      {work.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="button-row">
                  {["pause", "resume", "advance"].map((action) => (
                    <button
                      key={action}
                      onClick={() =>
                        ask(
                          `Request controller action ${action} for ${work.issue_id}. Inspect its current state and use the existing guarded work control.`,
                        )
                      }
                    >
                      {action[0].toUpperCase() + action.slice(1)} work
                    </button>
                  ))}
                </div>
                <p className="muted">
                  Controls send a request to Abra. The controller validates each transition.
                </p>
              </>
            )}
            {tab === "Plan" && (
              <>
                {!selected && (
                  <>
                    <h3>Planning artifacts</h3>
                    {detail?.documents?.map((path) => (
                      <button
                        className="document-link"
                        key={path}
                        onClick={() => setSelected(path)}
                      >
                        {path}
                      </button>
                    ))}
                  </>
                )}
                {selected && <button onClick={() => setSelected("")}>← All artifacts</button>}
                <pre className="prose">
                  {selected
                    ? (content as { content?: string }).content
                    : (detail?.proposal ??
                      "Select a planning artifact to read its retained content.")}
                </pre>
              </>
            )}
            {tab === "Diff" && (
              <>
                {diff?.message && <p>{diff.message}</p>}
                <div className="file-list">
                  {diff?.files?.map((file) => (
                    <button key={file.path} onClick={() => setSelected(file.path)}>
                      {file.path}
                      <span className="diff-count">
                        +{file.additions} −{file.deletions}
                      </span>
                    </button>
                  ))}
                </div>
                {diff?.limited && (
                  <p className="warning">
                    Diff is bounded; inspect the repository for the complete change.
                  </p>
                )}
                <pre className="diff">{diff?.patch}</pre>
              </>
            )}
            {tab === "Workers" && (
              <>
                <label>
                  Read-only worker session
                  <select
                    value={selected || work.sessions.at(-1)?.id || ""}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {work.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.role} · {s.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">Give all instructions to Abra in the main conversation.</p>
                <Worker content={content as WorkerInspection} />
              </>
            )}
            {tab === "Reports" && (
              <Reports
                issue={work.issue_id}
                content={content as { artifacts: readonly (typeof ArtifactSummarySchema.Type)[] }}
              />
            )}
            {["Decisions", "Communication", "Feedback"].includes(tab) && (
              <pre className="structured-evidence">{JSON.stringify(content, null, 2)}</pre>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
function Worker({ content }: { content: WorkerInspection }) {
  return (
    <div>
      <p>{content.note}</p>
      {content.recent_messages?.map((m) => (
        <article className="worker-message" key={m.id}>
          <small>{m.type}</small>
          {m.text && <p className="prose">{m.text}</p>}
          {m.tools?.map((t, i) => (
            <p className="tool-state" key={i}>
              {t.name} · {t.status}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

function Reports({
  issue,
  content,
}: {
  issue: string;
  content: { artifacts: readonly (typeof ArtifactSummarySchema.Type)[] };
}) {
  const [selected, setSelected] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSelected("");
    setMarkdown("");
    setError("");
    void api
      .read("report", issue)
      .then((value) => {
        if (active) setMarkdown((value as { content: string }).content);
      })
      .catch(() => {
        if (active) setError("No retained Markdown report available.");
      });
    return () => {
      active = false;
    };
  }, [issue]);
  return (
    <>
      <div className="eyebrow">Retained reports</div>
      {content.artifacts?.map((a) => (
        <section key={a.request_id} className="report-revision">
          <strong>{a.title ?? a.request_id}</strong>
          <p className="muted">
            {a.status} · generation {a.generation}
            {a.hash ? ` · ${a.hash.slice(0, 12)}` : ""}
          </p>
          {a.status === "published" ? (
            <div className="button-row">
              <button onClick={() => setSelected(a.request_id)}>Preview</button>
              <a href={api.reportURL(issue, a.request_id, true)} download>
                Download HTML ↗
              </a>
            </div>
          ) : (
            <p>{a.error ?? "Report is not published yet."}</p>
          )}
        </section>
      ))}
      {selected && (
        <iframe
          className="report-preview"
          title="Isolated retained visual report"
          sandbox="allow-scripts"
          src={api.reportURL(issue, selected)}
        />
      )}
      <h3>Markdown report</h3>
      <pre className="prose">{markdown || error || "Loading report…"}</pre>
    </>
  );
}
