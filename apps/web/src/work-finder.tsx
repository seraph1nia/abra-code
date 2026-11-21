import type { ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { Thoughts } from "./thoughts.tsx";
import { GithubInbox } from "./github-inbox.tsx";
import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type {
  CapacityUsageSchema,
  WorkDiscovery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { RepositoryId } from "@abracode/contracts/identities";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { fleetLabels } from "@abracode/contracts/visibility/fleet";
import { queries } from "./work-data.ts";
import { RequestState } from "./request-state.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { Input } from "@abracode/presentation/ui/input";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

function SlotUsage({ label, usage }: { label: string; usage?: typeof CapacityUsageSchema.Type }) {
  return (
    <div className="finder-slots">
      <strong>{label}</strong>
      {usage ? (
        <dl>
          <div>
            <dt>Workers</dt>
            <dd>
              {usage.workers} / {usage.worker_limit}
            </dd>
          </div>
          <div>
            <dt>Execution slots</dt>
            <dd>
              {usage.retained} / {usage.retained_limit}
            </dd>
          </div>
        </dl>
      ) : (
        <small>Usage unavailable</small>
      )}
    </div>
  );
}

export function WorkFinder({
  shown,
  initialQuery,
  discuss,
  close,
  workspace,
  open,
  ask,
}: {
  shown: boolean;
  initialQuery?: string;
  discuss: (ref: ThoughtReference) => void;
  close: () => void;
  workspace: WorkspaceSnapshot;
  open: (id: string, tab?: "Reports") => void;
  ask: (text: string) => void;
}) {
  const [thoughts, setThoughts] = useState(false);
  const [search, setSearch] = useState(initialQuery ?? "");
  const [settled, setSettled] = useState(initialQuery ?? "");
  const [repository, setRepository] = useState("");
  const [state, setState] = useState<NonNullable<WorkDiscovery["state"]>>(
    initialQuery ? "all" : "active",
  );
  const [offset, setOffset] = useState(0);
  const [fleetOpen, setFleetOpen] = useState(false);
  useEffect(() => {
    if (search === settled) return;
    const timer = setTimeout(() => {
      setSettled(search);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, settled]);
  const query: WorkDiscovery = {
    state,
    search: settled,
    offset,
    limit: 50,
    ...(repository ? { repository_id: RepositoryId.make(repository) } : {}),
  };
  const content = (
    <>
      <div className="sidebar-heading">
        <h2>Work</h2>
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close work finder">
          <X aria-hidden="true" />
        </Button>
      </div>
      <Button variant="outline" onClick={() => setThoughts(true)}>
        Thoughts
      </Button>
      <Input
        className="search"
        aria-label="Search work"
        placeholder="Search work…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <NativeSelect
        aria-label="Project"
        value={repository}
        onChange={(event) => {
          setRepository(event.target.value);
          setOffset(0);
        }}
      >
        <option value="">All projects</option>
        {workspace.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </NativeSelect>
      {shown && (
        <GithubInbox
          query={{ repository_id: query.repository_id, search: settled }}
          ask={ask}
          open={open}
        />
      )}
      <h3>Local work</h3>
      <div className="work-filters">
        {(["active", "closed", "all"] as const).map((next) => (
          <Button
            key={next}
            variant="ghost"
            aria-pressed={state === next}
            onClick={() => {
              setState(next);
              setOffset(0);
            }}
          >
            {next === "active" ? "Active" : next === "closed" ? "Closed" : "All"}
          </Button>
        ))}
      </div>
      {shown && (
        <RequestState query={queries.find(query)}>
          {(page) => (
            <>
              <section className="finder-capacity" aria-label="Capacity">
                <SlotUsage label="Workspace capacity" usage={page.capacity} />
                {repository && <SlotUsage label="Selected project" usage={page.project_capacity} />}
                <small>Idle work waiting for input uses no slots.</small>
              </section>
              <p className="muted">
                {page.total} matching task{page.total === 1 ? "" : "s"}
                {state === "active" && " · Active work includes queued and waiting tasks."}
              </p>
              <nav className="work-list" aria-label="Work results">
                {page.entries.map((work) => (
                  <Button
                    key={work.issue_id}
                    variant="ghost"
                    className="work-nav h-auto flex-col items-stretch whitespace-normal"
                    onClick={() => open(work.issue_id)}
                  >
                    <div>
                      <span className={`status-dot ${work.issue_status}`} />
                      <span className="work-title">{work.title}</span>
                    </div>
                    <small>
                      {work.phase
                        ? phaseLabel(work.phase)
                        : work.issue_status === "closed"
                          ? "Closed"
                          : "Retained work"}
                      {work.capacity_wait && " · Waiting for capacity"}
                      {work.blockers.length > 0 && ` · ${work.blockers.join("; ")}`}
                      {work.supervision &&
                        ` · Native ${work.supervision.native_activity.replaceAll("_", " ")}`}
                    </small>
                  </Button>
                ))}
              </nav>
              {!page.entries.length && <p className="empty-note">No matching work.</p>}
              <div className="finder-pagination">
                <Button
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous
                </Button>
                <span className="muted">
                  {page.entries.length ? offset + 1 : 0}–{offset + page.entries.length} of{" "}
                  {page.total}
                </span>
                <Button
                  variant="outline"
                  disabled={page.next_offset === undefined}
                  onClick={() => setOffset(page.next_offset!)}
                >
                  Next
                </Button>
              </div>
              {page.fleet_observation?.state === "unavailable" && (
                <output className="muted">Fleet totals are temporarily unavailable.</output>
              )}
              {page.fleet && (
                <details
                  className="fleet-summary"
                  open={fleetOpen}
                  onToggle={(event) => setFleetOpen(event.currentTarget.open)}
                >
                  <summary>
                    Fleet across all projects · {page.fleet.total} tasks
                    {page.fleet_observation?.state === "stale" && " · Stale"}
                  </summary>
                  {page.fleet_observation?.state === "stale" && (
                    <output className="muted">
                      Showing stale fleet totals while they refresh.
                    </output>
                  )}
                  {page.fleet_observation?.observed_at && (
                    <p className="muted">
                      Fleet observed at{" "}
                      {new Date(page.fleet_observation.observed_at).toLocaleTimeString()}.
                    </p>
                  )}
                  <dl>
                    {Object.entries(page.fleet.counts)
                      .filter(([, count]) => count > 0)
                      .map(([state, count]) => (
                        <div key={state}>
                          <dt>{fleetLabels[state as keyof typeof fleetLabels]}</dt>
                          <dd>{count}</dd>
                        </div>
                      ))}
                  </dl>
                  <section aria-label="Fleet by project" className="fleet-projects">
                    {page.fleet.repositories.map((group) => (
                      <details key={group.repository_id ?? "unassigned"}>
                        <summary>
                          {workspace.projects.find((project) => project.id === group.repository_id)
                            ?.name ??
                            group.repository_id ??
                            "Unassigned project"}
                        </summary>
                        <dl>
                          {Object.entries(group.counts)
                            .filter(([, count]) => count > 0)
                            .map(([state, count]) => (
                              <div key={state}>
                                <dt>{fleetLabels[state as keyof typeof fleetLabels]}</dt>
                                <dd>{count}</dd>
                              </div>
                            ))}
                        </dl>
                        <p className="muted">
                          {group.attention_total === undefined
                            ? "Attention count unavailable"
                            : `${group.attention_total} attention item${group.attention_total === 1 ? "" : "s"}`}
                        </p>
                      </details>
                    ))}
                  </section>
                  <p className="muted">
                    Native activity observed: {page.fleet.native_observed}/{page.fleet.native_total}
                    . Completed today: {page.fleet.completed_today} ({page.fleet.timezone}).
                  </p>
                </details>
              )}
            </>
          )}
        </RequestState>
      )}
      <div className="sidebar-footer">
        <Button
          variant="ghost"
          onClick={() => {
            close();
            ask("Inspect registered projects and help me onboard a project.");
          }}
        >
          <Plus aria-hidden="true" /> Add a project
        </Button>
        <a
          className="muted"
          href="/THIRD_PARTY_NOTICES.txt"
          target="_blank"
          rel="noopener noreferrer"
        >
          Licenses
        </a>
      </div>
    </>
  );
  return (
    <aside className="sidebar" aria-label="Work finder" hidden={!shown}>
      {shown &&
        (thoughts ? <Thoughts discuss={discuss} back={() => setThoughts(false)} /> : content)}
    </aside>
  );
}
import { X, Plus } from "@abracode/presentation/icons";
