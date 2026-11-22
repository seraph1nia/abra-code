import { WorkCapacity } from "./work-capacity.tsx";
import { WorkspaceApi } from "./data.ts";
import type { Inspect } from "@abracode/presentation/cards";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
import { RepositoryId } from "@abracode/contracts/identities";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";

import { queries } from "./work-data.ts";
import { RequestState } from "./request-state.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { Input } from "@abracode/presentation/ui/input";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

export function WorkFinder({
  shown,

  workspace,
  open,
  inspect,
}: {
  shown: boolean;

  workspace: WorkspaceSnapshot;
  inspect: Inspect;
  open: (id: string, tab?: "Reports") => void;
}) {
  const { collection } = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const query = { state: "active", ...collection?.work, limit: 50 } satisfies WorkDiscovery;
  const repository = query.repository_id;
  const state = query.state;
  const offset = collection?.work?.offset ?? 0;
  const settled = collection?.work?.search ?? "";
  const [search, setSearch] = useState(settled);
  const [previous, setPrevious] = useState(settled);
  if (previous !== settled) {
    setPrevious(settled);
    setSearch(settled);
  }
  const section = collection?.section ?? "tasks";
  function update(change: Partial<WorkDiscovery>) {
    void navigate({
      to: "/work",
      search: {
        collection: { ...collection, work: { ...collection?.work, offset: 0, ...change } },
      },
    });
  }
  useEffect(() => {
    if (!shown || search === settled) return;
    const timer = setTimeout(() => {
      void navigate({
        to: "/work",
        replace: true,
        search: { collection: { ...collection, work: { ...collection?.work, search, offset: 0 } } },
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [search, settled, shown, collection, navigate]);
  const content = (
    <>
      <div className="sidebar-heading">
        <h2>Work</h2>
      </div>
      <nav aria-label="Work sections" className="work-sections">
        {(["tasks", "sessions", "capacity", "recent"] as const).map((key) => (
          <Link
            key={key}
            to="/work"
            search={{
              collection: { ...collection, section: key, work: { ...collection?.work, offset: 0 } },
            }}
            aria-current={section === key ? "page" : undefined}
          >
            {
              {
                tasks: "Tasks",
                sessions: "Sessions",
                capacity: "Capacity",
                recent: "Recently inspected",
              }[key]
            }
          </Link>
        ))}
      </nav>
      {section !== "recent" && (
        <>
          <Input
            className="search"
            aria-label="Search work"
            placeholder="Search work…"
            maxLength={256}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <NativeSelect
            aria-label="Project"
            value={repository ?? ""}
            onChange={(event) => {
              update({
                repository_id: event.target.value
                  ? RepositoryId.make(event.target.value)
                  : undefined,
              });
            }}
          >
            <option value="">All projects</option>
            {workspace.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </NativeSelect>
        </>
      )}
      {section === "capacity" && (
        <RequestState query={queries.find({ ...query, limit: 1 })}>
          {(page) => <WorkCapacity page={page} workspace={workspace} repository={repository} />}
        </RequestState>
      )}
      {section === "sessions" && (
        <RequestState
          query={WorkspaceApi.query("work", "sessions", {
            query: { repository_id: repository, search: settled, offset, limit: 30 },
            timeToLive: "0 seconds",
          })}
        >
          {(page) => (
            <>
              <Link to="/" search={{}}>
                Abra · Main conversation
              </Link>
              <p>
                {page.total} retained worker sessions. Open a worker to check its native history.
              </p>
              {page.entries.map((row) => (
                <Button
                  key={row.issue_id + row.session_id}
                  onClick={() =>
                    inspect({
                      action: "open_session",
                      issue_id: row.issue_id,
                      session_id: row.session_id,
                    })
                  }
                >
                  {row.role} · {row.session_id} · {row.title} · {row.association} ·{" "}
                  {row.availability}
                </Button>
              ))}
              {offset > 0 && (
                <Button onClick={() => update({ offset: Math.max(0, offset - 30) })}>
                  Previous sessions
                </Button>
              )}
              {page.next_offset !== undefined && (
                <Button onClick={() => update({ offset: page.next_offset })}>Next sessions</Button>
              )}
            </>
          )}
        </RequestState>
      )}
      {section === "tasks" && (
        <>
          <h3>Local work</h3>
          <div className="work-filters">
            {(["active", "closed", "all"] as const).map((next) => (
              <Button
                key={next}
                variant="ghost"
                aria-pressed={state === next}
                onClick={() => {
                  update({ state: next });
                }}
              >
                {next === "active" ? "Active" : next === "closed" ? "Closed" : "All"}
              </Button>
            ))}
          </div>
          {
            <RequestState query={queries.find(query)}>
              {(page) => (
                <>
                  <p className="muted">
                    {page.total} matching task{page.total === 1 ? "" : "s"}
                    {state === "active" && " · Active work includes queued and waiting tasks."}
                  </p>
                  <nav className="work-list" aria-label="Work results">
                    {page.entries.map((work) => (
                      <div key={work.issue_id}>
                        <Button
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
                        {work.capacity_wait && (
                          <Link
                            to="/work"
                            search={{
                              collection: {
                                section: "capacity",
                                work: { repository_id: work.repository_id },
                              },
                            }}
                          >
                            Inspect capacity
                          </Link>
                        )}
                      </div>
                    ))}
                  </nav>
                  {!page.entries.length && <p className="empty-note">No matching work.</p>}
                  <div className="finder-pagination">
                    <Button
                      variant="outline"
                      disabled={offset === 0}
                      onClick={() => update({ offset: Math.max(0, offset - 50) })}
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
                      onClick={() => update({ offset: page.next_offset })}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}
            </RequestState>
          }
        </>
      )}
    </>
  );
  return (
    <section className="collection-work" aria-label="Work finder" hidden={!shown}>
      {content}
    </section>
  );
}
