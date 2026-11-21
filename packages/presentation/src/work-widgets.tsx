import { DiagramView } from "./diagrams.tsx";
import { ArrowUpRight } from "./icons.ts";
import { bindWork, type WorkBinding } from "./work-bindings.ts";
export { bindWork } from "./work-bindings.ts";
import type { ReactNode } from "react";
import type { WorkSummary } from "@abracode/contracts/visibility/work-summary";
import type { WorkComponentName, WorkProps } from "@abracode/contracts/web/catalog";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { workEvents } from "@abracode/contracts/presentation/work-events";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { Button } from "./ui/button.tsx";
import { Badge } from "./ui/badge.tsx";
import { ReportEvidence, type PreparedReportDiagram } from "./report-evidence.tsx";
import type { ReportSnapshot } from "@abracode/contracts/presentation/report-evidence";

type Binding = WorkBinding & {
  evidence?: ReportSnapshot;
  hideLiveWidgets?: boolean;
  diagramMessage?: string;
  preparedDiagrams?: readonly PreparedReportDiagram[];
  inspect?: (target: ResourceSelection) => void;
};
const statuses = ["open", "in_progress", "blocked", "closed", "unavailable"] as const;
const words = (text: string) => text.replaceAll("_", " ");
const observedState = (work: WorkSummary) =>
  work.phase ? phaseLabel(work.phase) : words(work.issue_status);

function UpdateText({ text }: { text: string }) {
  if (text.length <= 150) return <>{text}</>;
  const space = text.lastIndexOf(" ", 140);
  return (
    <details className="work-update">
      <summary>{text.slice(0, space > 80 ? space : 140)}…</summary>
      <p>{text}</p>
    </details>
  );
}

/** Presentation has no router, query client, model tool or controller dependency. */
export function WorkWidget({
  name,
  props,
  binding,
}: {
  name: WorkComponentName;
  props: WorkProps<"WorkTable"> &
    Partial<WorkProps<"ReportLink">> &
    Partial<WorkProps<"ResourceLink">> &
    Partial<WorkProps<"ReportEvidence">> &
    Partial<WorkProps<"Mermaid">>;
  binding: Binding;
}) {
  if (name === "Mermaid")
    return (
      <DiagramView
        title={props.title!}
        source={props.source!}
        description={props.description}
        prepared={binding.preparedDiagrams?.find((d) => d.source === props.source)}
        message={binding.diagramMessage}
      />
    );
  const usesWork = name !== "ReportEvidence" && name !== "ResourceLink" && name !== "ReportLink";
  if (usesWork && props.mode !== "snapshot" && binding.hideLiveWidgets) return null;
  const { selected, total, label, incomplete } = bindWork(props, binding);
  const source = props.mode === "snapshot" ? binding.captured : binding.work;
  const navigate = (target: ResourceSelection, text: ReactNode, className?: string) =>
    binding.inspect ? (
      <Button variant="ghost" className={className} onClick={() => binding.inspect?.(target)}>
        {text}
      </Button>
    ) : (
      <span className={className}>{text}</span>
    );
  const task = (work: WorkSummary) =>
    navigate(
      { action: "open_task", issue_id: work.issue_id },
      <>
        <strong>{work.title}</strong>
        <span className="muted">{observedState(work)}</span>
      </>,
      "work-card h-auto flex-col items-stretch whitespace-normal text-left",
    );
  let content: ReactNode;
  switch (name) {
    case "ReportEvidence":
      return (
        <ReportEvidence
          section={props.section ?? "summary"}
          snapshot={binding.evidence}
          preparedDiagrams={binding.preparedDiagrams}
          diagramMessage={binding.diagramMessage}
        />
      );
    case "ResourceLink":
      content =
        props.target && props.label ? (
          navigate(props.target, props.label)
        ) : (
          <p>Resource target unavailable.</p>
        );
      break;
    case "StatusSummary":
      content = (
        <dl className="metrics">
          {statuses
            .filter(
              (status) =>
                status !== "unavailable" || selected.some((item) => item.issue_status === status),
            )
            .map((status) => (
              <div key={status}>
                <dt>{words(status)}</dt>
                <dd>
                  {selected.filter((work) => work.issue_status === status).length}
                  {incomplete && " (partial)"}
                </dd>
              </div>
            ))}
        </dl>
      );
      break;
    case "WorkTable":
      content = (
        <section className="work-table-scroll" tabIndex={0} aria-label="Work table">
          <table className="work-table">
            <caption>Observed work</caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">State</th>
                <th scope="col">Priority</th>
                <th scope="col">Latest update</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((work) => (
                <tr key={work.issue_id}>
                  <th scope="row">
                    {navigate(
                      { action: "open_task", issue_id: work.issue_id },
                      work.title,
                      "h-auto whitespace-normal text-left justify-start",
                    )}
                  </th>
                  <td>{observedState(work)}</td>
                  <td>
                    <span className="compact-priority">Priority </span>
                    {work.priority}
                  </td>
                  <td>
                    <UpdateText text={work.error ?? work.progress?.summary ?? "—"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
      break;
    case "Kanban":
      content = (
        <section className="kanban" aria-label="Work board" tabIndex={0}>
          {statuses.map((status) => (
            <section key={status}>
              <h4>{words(status)}</h4>
              {selected
                .filter((work) => work.issue_status === status)
                .map((work) => (
                  <div key={work.issue_id}>{task(work)}</div>
                ))}
            </section>
          ))}
        </section>
      );
      break;
    case "Timeline": {
      const { events, total } = workEvents(selected);
      content = (
        <>
          <h4>Captured events</h4>
          <p className="muted">
            Retained observations, including the latest progress per task; this is not a complete
            activity log.
          </p>
          {events.length ? (
            <ol className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {new Date(event.at).toLocaleString()}
                  </time>
                  <strong>{event.label}</strong>
                  <div>
                    {navigate(
                      { action: "open_task", issue_id: event.issue.issue_id },
                      event.issue.title,
                    )}
                  </div>
                  <UpdateText text={event.detail} />
                </li>
              ))}
            </ol>
          ) : (
            <p>No timed observations retained.</p>
          )}
          {total > events.length && (
            <output>
              Showing {events.length} of {total} captured events.
            </output>
          )}
        </>
      );
      break;
    }
    case "DependencyGraph":
      content = (
        <>
          <h4>Dependency references</h4>
          <ul className="dependency-graph">
            {selected.map((work) => (
              <li key={work.issue_id}>
                {task(work)}
                {work.dependencies ? (
                  <>
                    <p>Depends on:</p>
                    {work.dependencies.length ? (
                      <ul>
                        {work.dependencies.map((id) => (
                          <li key={id}>
                            {navigate(
                              { action: "open_task", issue_id: id },
                              source.find((item) => item.issue_id === id)?.title ?? id,
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No declared dependencies.</p>
                    )}
                    {(work.dependency_count ?? 0) > work.dependencies.length && (
                      <output>
                        Showing {work.dependencies.length} of {work.dependency_count} dependencies.
                      </output>
                    )}
                  </>
                ) : (
                  <p>Dependency references unavailable in this observation.</p>
                )}
                {work.blockers.length > 0 && (
                  <>
                    <h5>Observed blockers</h5>
                    <ul>
                      {work.blockers.map((blocker, index) => (
                        <li key={index}>{blocker}</li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      );
      break;
    case "DecisionSummary":
      content = (
        <div>
          {selected.length > 0 && !selected.some((work) => work.decisions?.length) && (
            <p className="muted">No decisions in the observed tasks.</p>
          )}
          {selected.flatMap((work) =>
            (work.decisions ?? []).map((decision) => (
              <div key={`${work.issue_id}:${decision.generation}:${decision.key}`}>
                {navigate(
                  {
                    action: "open_decision",
                    issue_id: work.issue_id,
                    key: decision.key,
                    generation: decision.generation,
                  },
                  <>
                    <strong>{decision.question}</strong>
                    <span>
                      {work.title} · <Badge variant="secondary">{decision.status}</Badge>
                    </span>
                  </>,
                  "work-card h-auto flex-col items-stretch whitespace-normal text-left",
                )}
              </div>
            )),
          )}
        </div>
      );
      break;
    case "ReportLink":
      content = props.issueId ? (
        navigate(
          { action: "open_task", issue_id: props.issueId, section: "reports" },
          <>
            Open retained reports <ArrowUpRight aria-hidden="true" />
          </>,
        )
      ) : (
        <p>Report target unavailable.</p>
      );
      break;
    default: {
      const missing: never = name;
      throw new Error("Missing work renderer", { cause: missing });
    }
  }
  return (
    <section className="surface-widget" data-work-widget={name}>
      {(binding.frozen ||
        props.mode === "snapshot" ||
        incomplete ||
        (usesWork && props.issueIds !== undefined)) && (
        <div className="surface-binding">
          {name === "ResourceLink" || name === "ReportLink" ? "Current app navigation" : label}
          {binding.frozen && binding.inspect && " · Links inspect current app resources"}
        </div>
      )}
      {usesWork && !selected.length && incomplete ? null : content}
      {name !== "ResourceLink" && name !== "ReportLink" && total > selected.length && (
        <output>
          Showing {selected.length} of {total} matching work observations.
        </output>
      )}
      {!binding.inspect && (
        <p className="muted">App navigation is unavailable in this document view.</p>
      )}
    </section>
  );
}
