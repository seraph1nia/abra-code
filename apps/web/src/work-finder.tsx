import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "../../../src/web/contracts.ts";
import type { WorkDiscovery } from "../../../src/visibility/discovery-contracts.ts";
import { RepositoryId } from "../../../src/identities.ts";
import { phaseLabel } from "../../../src/presentation/work-state.ts";
import { fleetLabels } from "../../../src/visibility/fleet.ts";
import { queries } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { useMediaQuery } from "./use-media-query.ts";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { NativeSelect } from "./components/ui/native-select.tsx";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./components/ui/sheet.tsx";

export function WorkFinder({
  shown,
  close,
  workspace,
  open,
  ask,
}: {
  shown: boolean;
  close: () => void;
  workspace: WorkspaceSnapshot;
  open: (id: string) => void;
  ask: (text: string) => void;
}) {
  const mobile = useMediaQuery("(max-width: 760px)");
  const [search, setSearch] = useState("");
  const [settled, setSettled] = useState("");
  const [repository, setRepository] = useState("");
  const [state, setState] = useState<NonNullable<WorkDiscovery["state"]>>("active");
  const [offset, setOffset] = useState(0);
  const [fleetOpen, setFleetOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(search);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
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
          ×
        </Button>
      </div>
      <Input
        className="search"
        aria-label="Search work"
        placeholder="Search all retained work…"
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
              {page.fleet && (
                <details
                  className="fleet-summary"
                  open={fleetOpen}
                  onToggle={(event) => setFleetOpen(event.currentTarget.open)}
                >
                  <summary>Fleet across all projects · {page.fleet.total} tasks</summary>
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
          ＋ Add a project
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
  if (mobile)
    return (
      <Sheet
        open={shown}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent
          side="left"
          showCloseButton={false}
          className="p-0 data-[side=left]:w-[min(340px,100vw)] gap-0"
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>('[aria-label="Toggle work finder"]') ?? false
          }
        >
          <SheetTitle className="sr-only">Work finder</SheetTitle>
          <SheetDescription className="sr-only">
            Search retained work without leaving Abra.
          </SheetDescription>
          <div className="sidebar mobile-sidebar">{content}</div>
        </SheetContent>
      </Sheet>
    );
  return (
    <aside className="sidebar" aria-label="Work finder" hidden={!shown}>
      {shown && content}
    </aside>
  );
}
