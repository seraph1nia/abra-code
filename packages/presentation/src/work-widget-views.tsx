import type { ReactNode } from "react";
import type { WorkSummary } from "@abracode/contracts/visibility/work-summary";
import type { WorkProps } from "@abracode/contracts/web/catalog";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { workEvents } from "@abracode/contracts/presentation/work-events";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { ArrowUpRight } from "./icons.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

const statuses = ["open", "in_progress", "blocked", "closed", "unavailable"] as const;
const words = (text: string) => text.replaceAll("_", " ");
const observedState = (work: WorkSummary) =>
  work.phase ? phaseLabel(work.phase) : words(work.issue_status);

export type NavigateFn = (
  target: ResourceSelection,
  text: ReactNode,
  className?: string,
) => ReactNode;

export function createNavigator(inspect?: (target: ResourceSelection) => void): NavigateFn {
  return (target, text, className) =>
    inspect ? (
      <Button variant="ghost" className={className} onClick={() => inspect(target)}>
        {text}
      </Button>
    ) : (
      <span className={className}>{text}</span>
    );
}

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

function TaskCardButton({ work, navigate }: { work: WorkSummary; navigate: NavigateFn }) {
  return navigate(
    { action: "open_task", issue_id: work.issue_id },
    <>
      <strong>{work.title}</strong>
      <span className="muted">{observedState(work)}</span>
    </>,
    "work-card h-auto flex-col items-stretch whitespace-normal text-left",
  );
}

export function StatusSummaryWidget({
  selected,
  incomplete,
}: {
  selected: readonly WorkSummary[];
  incomplete: boolean;
}) {
  return (
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
}

export function WorkTableWidget({
  selected,
  navigate,
}: {
  selected: readonly WorkSummary[];
  navigate: NavigateFn;
}) {
  return (
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
}

export function KanbanWidget({
  selected,
  navigate,
}: {
  selected: readonly WorkSummary[];
  navigate: NavigateFn;
}) {
  return (
    <section className="kanban" aria-label="Work board" tabIndex={0}>
      {statuses.map((status) => (
        <section key={status}>
          <h4>{words(status)}</h4>
          {selected
            .filter((work) => work.issue_status === status)
            .map((work) => (
              <div key={work.issue_id}>
                <TaskCardButton work={work} navigate={navigate} />
              </div>
            ))}
        </section>
      ))}
    </section>
  );
}

export function TimelineWidget({
  selected,
  navigate,
}: {
  selected: readonly WorkSummary[];
  navigate: NavigateFn;
}) {
  const { events, total } = workEvents(selected);
  return (
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
}

export function DependencyGraphWidget({
  selected,
  source,
  navigate,
}: {
  selected: readonly WorkSummary[];
  source: readonly WorkSummary[];
  navigate: NavigateFn;
}) {
  return (
    <>
      <h4>Dependency references</h4>
      <ul className="dependency-graph">
        {selected.map((work) => (
          <li key={work.issue_id}>
            <TaskCardButton work={work} navigate={navigate} />
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
}

export function DecisionSummaryWidget({
  selected,
  navigate,
}: {
  selected: readonly WorkSummary[];
  navigate: NavigateFn;
}) {
  return (
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
}

export function ReportLinkWidget({
  props,
  navigate,
}: {
  props: WorkProps<"ReportLink">;
  navigate: NavigateFn;
}) {
  return navigate(
    { action: "open_task", issue_id: props.issueId, section: "reports" },
    <>
      Open retained reports <ArrowUpRight aria-hidden="true" />
    </>,
  );
}

export function ResourceLinkWidget({
  props,
  navigate,
}: {
  props: WorkProps<"ResourceLink">;
  navigate: NavigateFn;
}) {
  return navigate(props.target, props.label);
}
