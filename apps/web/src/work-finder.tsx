import { PaginationBar } from "./pagination-bar.tsx";
import { useDebouncedValue } from "./use-debounced-value.ts";
import { WorkCapacity } from "./work-capacity.tsx";
import { WorkspaceApi } from "./data.ts";
import type { Inspect } from "@abracode/presentation/cards";
import { SectionCard, StatusBadge, statusTone } from "@abracode/presentation/cockpit";
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
  const [draft, setDraft] = useState<{ base: string; value: string }>();
  const search = draft && draft.base === settled ? draft.value : settled;
  const debounced = useDebouncedValue(search, 200);
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
    if (!shown || search !== debounced || search === settled) return;
    void navigate({
      to: "/work",
      replace: true,
      search: { collection: { ...collection, work: { ...collection?.work, search, offset: 0 } } },
    });
  }, [search, settled, debounced, shown, collection, navigate]);

  const content = (
    <>
      <div className="hub-header">
        <div>
          <h2>Work</h2>
        </div>
        <nav aria-label="Work sections" className="work-sections">
          {(["tasks", "sessions", "capacity", "recent"] as const).map((key) => (
            <Link
              key={key}
              to="/work"
              search={{
                collection: {
                  ...collection,
                  section: key,
                  work: { ...collection?.work, offset: 0 },
                },
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
      </div>
      {section !== "recent" && (
        <div className="hub-toolbar">
          <Input
            className="search"
            aria-label="Search work"
            placeholder="Search work…"
            maxLength={256}
            value={search}
            onChange={(event) => setDraft({ base: settled, value: event.target.value })}
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
          {section === "tasks" && (
            <fieldset className="work-filters" aria-label="Task state">
              {(["active", "closed", "all"] as const).map((next) => (
                <Button
                  key={next}
                  variant="ghost"
                  size="sm"
                  aria-pressed={state === next}
                  onClick={() => {
                    update({ state: next });
                  }}
                >
                  {next === "active" ? "Active" : next === "closed" ? "Closed" : "All"}
                </Button>
              ))}
            </fieldset>
          )}
        </div>
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
            <SectionCard
              title="Retained worker sessions"
              actions={
                <Link to="/" search={{}} className="hub-inline-link">
                  Abra · Main conversation
                </Link>
              }
            >
              <p className="muted">
                {page.total} retained worker sessions. Open a worker to check its native history.
              </p>
              <div className="list-group">
                {page.entries.map((row) => (
                  <Button
                    key={row.issue_id + row.session_id}
                    variant="ghost"
                    className="list-row h-auto whitespace-normal"
                    onClick={() =>
                      inspect({
                        action: "open_session",
                        issue_id: row.issue_id,
                        session_id: row.session_id,
                      })
                    }
                  >
                    <div className="list-row-main">
                      <span className="list-row-title">
                        {row.role} · {row.title}
                      </span>
                      <span className="list-row-sub">
                        <code>{row.session_id}</code> · {row.association}
                      </span>
                    </div>
                    <StatusBadge tone={statusTone(row.availability)}>
                      {row.availability}
                    </StatusBadge>
                  </Button>
                ))}
                {!page.entries.length && <p className="empty-note">No matching worker sessions.</p>}
              </div>
              {(offset > 0 || page.next_offset !== undefined) && (
                <div className="finder-pagination">
                  {offset > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => update({ offset: Math.max(0, offset - 30) })}
                    >
                      Previous sessions
                    </Button>
                  )}
                  {page.next_offset !== undefined && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => update({ offset: page.next_offset })}
                    >
                      Next sessions
                    </Button>
                  )}
                </div>
              )}
            </SectionCard>
          )}
        </RequestState>
      )}
      {section === "tasks" && (
        <RequestState query={queries.find(query)}>
          {(page) => (
            <>
              <p className="muted">
                {page.total} matching task{page.total === 1 ? "" : "s"}
                {state === "active" && " · Active work includes queued and waiting tasks."}
              </p>
              <nav className="work-list list-group" aria-label="Work results">
                {page.entries.map((work) => {
                  const statusLabel = work.phase
                    ? phaseLabel(work.phase)
                    : work.issue_status === "closed"
                      ? "Closed"
                      : "Retained work";
                  return (
                    <div key={work.issue_id} className="work-list-item">
                      <Button
                        variant="ghost"
                        className="work-nav list-row h-auto whitespace-normal"
                        onClick={() => open(work.issue_id)}
                      >
                        <div className="work-nav-left">
                          <span className={`status-dot ${work.issue_status}`} />
                          <div className="work-nav-text">
                            <span className="work-title">{work.title}</span>
                            <small>
                              <code>{work.issue_id}</code>
                              {work.repository_id && ` · ${work.repository_id}`}
                              {work.capacity_wait && " · Waiting for capacity"}
                              {work.blockers.length > 0 && ` · ${work.blockers.join("; ")}`}
                              {work.supervision &&
                                ` · Native ${work.supervision.native_activity.replaceAll("_", " ")}`}
                            </small>
                          </div>
                        </div>
                        <div className="work-nav-badges">
                          <StatusBadge tone={statusTone(statusLabel)}>{statusLabel}</StatusBadge>
                          <StatusBadge tone="neutral">P{work.priority}</StatusBadge>
                        </div>
                      </Button>
                      {work.capacity_wait && (
                        <div className="work-row-aux">
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
                        </div>
                      )}
                    </div>
                  );
                })}
                {!page.entries.length && <p className="empty-note">No matching work.</p>}
              </nav>
              <PaginationBar
                label="Work pages"
                previous={offset ? () => update({ offset: Math.max(0, offset - 50) }) : undefined}
                next={
                  page.next_offset === undefined
                    ? undefined
                    : () => update({ offset: page.next_offset })
                }
              >
                <span className="muted tabular">
                  {page.entries.length ? offset + 1 : 0}–{offset + page.entries.length} of{" "}
                  {page.total}
                </span>
              </PaginationBar>
            </>
          )}
        </RequestState>
      )}
    </>
  );
  return (
    <section className="collection-work" aria-label="Work finder" hidden={!shown}>
      {content}
    </section>
  );
}
