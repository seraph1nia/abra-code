import type { SurfaceRecord } from "../../../src/web/contracts.ts";
import type { WebWorkItem as WorkItem } from "../../../src/web/wire.ts";
import { validateSurface } from "../../../src/web/surfaces.ts";

export function WorkViews({
  records,
  work,
  open,
}: {
  records: readonly SurfaceRecord[];
  work: readonly WorkItem[];
  open: (id: string, tab?: string) => void;
}) {
  return (
    <div className="generated-views">
      {records.map((record) => (
        <Surface
          key={record.surface.createSurface.surfaceId}
          record={record}
          work={work}
          open={open}
        />
      ))}
    </div>
  );
}
function Surface({
  record,
  work,
  open,
}: {
  record: SurfaceRecord;
  work: readonly WorkItem[];
  open: (id: string, tab?: string) => void;
}) {
  try {
    validateSurface(record.surface, new Set([...work, ...record.snapshot].map((w) => w.issue_id)));
  } catch {
    return (
      <p className="error">Generated view unavailable: its catalog or structure is invalid.</p>
    );
  }
  const components = new Map(record.surface.createSurface.components.map((c) => [c.id, c]));
  function render(id: string): React.ReactNode {
    const c = components.get(id)!;
    const source = c.mode === "snapshot" ? record.snapshot : work;
    const selected = source
      .filter((w) =>
        c.issueIds ? c.issueIds.includes(w.issue_id) : c.issueId ? w.issue_id === c.issueId : true,
      )
      .slice(0, 100);
    const card = (w: WorkItem) => (
      <button className="work-card" key={w.issue_id} onClick={() => open(w.issue_id)}>
        <span className={`status-dot ${w.issue_status}`} />
        <strong>{w.title}</strong>
        <span className="muted">{w.phase ?? w.issue_status}</span>
      </button>
    );
    let content: React.ReactNode;
    switch (c.component) {
      case "Column":
      case "Row":
        return (
          <div key={id} className={`surface-${c.component.toLowerCase()}`}>
            {c.children?.map(render)}
          </div>
        );
      case "Text":
        return <p key={id}>{c.text}</p>;
      case "StatusSummary":
        content = (
          <div className="metrics">
            {["open", "in_progress", "blocked", "closed"].map((status) => (
              <div key={status}>
                <strong>{selected.filter((w) => w.issue_status === status).length}</strong>
                <span>{status.replaceAll("_", " ")}</span>
              </div>
            ))}
          </div>
        );
        break;
      case "Kanban":
        content = (
          <div className="kanban">
            {["open", "in_progress", "blocked", "closed"].map((status) => (
              <section key={status}>
                <h4>{status.replaceAll("_", " ")}</h4>
                {selected.filter((w) => w.issue_status === status).map(card)}
              </section>
            ))}
          </div>
        );
        break;
      case "Timeline":
        content = (
          <ol className="timeline">
            {selected.map((w) => (
              <li key={w.issue_id}>
                {card(w)}
                <small>{w.progress?.summary ?? "No progress observation retained"}</small>
              </li>
            ))}
          </ol>
        );
        break;
      case "DecisionSummary":
        content = (
          <div>
            {selected.flatMap((w) =>
              (w.decisions ?? []).map((d) => (
                <button
                  className="work-card"
                  key={`${w.issue_id}-${d.key}`}
                  onClick={() => open(w.issue_id, "Decisions")}
                >
                  <strong>{d.question}</strong>
                  <span>
                    {w.title} · {d.status}
                  </span>
                </button>
              )),
            )}
          </div>
        );
        break;
      case "DependencyGraph":
        content = (
          <div className="dependency-graph" role="img" aria-label="Work dependencies">
            {selected.map((w) => (
              <div key={w.issue_id}>
                {card(w)}
                {w.blockers.length > 0 && (
                  <div className="dependency-edge">↳ {w.blockers.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
        );
        break;
      case "ReportLink":
        content = (
          <button onClick={() => c.issueId && open(c.issueId, "Reports")}>
            Open retained report ↗
          </button>
        );
        break;
      default:
        content = <div className="work-table">{selected.map(card)}</div>;
    }
    return (
      <section key={id} className="surface-widget">
        <div className="surface-binding">
          {c.mode === "snapshot"
            ? `Snapshot · ${new Date(record.at).toLocaleString()}`
            : "Live work graph"}
        </div>
        {content}
      </section>
    );
  }
  return (
    <section className="generated-surface">
      <div className="eyebrow">
        Generated work view <span>rev {record.revision}</span>
      </div>
      {render("root")}
    </section>
  );
}
