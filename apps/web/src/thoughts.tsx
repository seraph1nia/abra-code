import { RememberThought } from "./remember-thought.tsx";
import { RunCommand, composerCommands } from "./workspace-commands.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Typed workspace HTTP atoms own mounted query lifetimes. */
import { useContext, useState, type ReactNode } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, type Atom } from "effect/reactivity";
import { ArrowLeft, ArrowUpRight, Plus } from "@abracode/presentation/icons";
import { EvidenceDisclosure, SectionCard, StatusBadge } from "@abracode/presentation/cockpit";
import { Button } from "@abracode/presentation/ui/button";
import { Input } from "@abracode/presentation/ui/input";
import type { ThoughtQuery, ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WorkspaceApi } from "./data.ts";
import { requestError } from "./request-error.ts";

function Read<A, E>({
  atom,
  children,
}: {
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  children: (data: A) => ReactNode;
}) {
  const result = useAtomValue(atom);
  const registry = useContext(RegistryContext);
  if (AsyncResult.isFailure(result))
    return (
      <div role="alert" className="error-banner">
        <span>{requestError(result.cause)}</span>
        <Button variant="outline" size="sm" onClick={() => registry.refresh(atom)}>
          Retry
        </Button>
      </div>
    );
  if (!AsyncResult.isSuccess(result) || result.waiting)
    return <output className="muted">Loading thoughts…</output>;
  return children(result.value);
}

export function Thoughts({ discuss }: { discuss: (ref: ThoughtReference) => void }) {
  const { collection } = useSearch({ from: "__root__" });
  const runCommand = useContext(RunCommand);
  const navigate = useNavigate();
  const [used, setUsed] = useState(false);
  const [offset, setOffset] = useState(0);
  const query = collection?.notebook ?? {};
  const selected = collection?.memo;
  const [filters, setFilters] = useState<ThoughtQuery>(query);
  const cursors = collection?.previousCursors ?? [];
  const setQuery = (notebook: ThoughtQuery, previousCursors: readonly string[] = []) =>
    void navigate({ to: "/thoughts", search: { collection: { notebook, previousCursors } } });
  const setSelected = (memo?: ThoughtReference) =>
    void navigate({
      to: "/thoughts",
      search: { collection: { ...collection, notebook: query, memo } },
    });
  const list = WorkspaceApi.query("work", "thoughtList", {
    query,
    timeToLive: "0 seconds",
  });

  return (
    <section aria-label="Personal thoughts" className="collection-work">
      <div className="hub-header">
        <h2>Thoughts</h2>
        <Button variant="outline" size="sm" onClick={() => runCommand(composerCommands[1])}>
          <Plus aria-hidden="true" />
          Save a thought
        </Button>
      </div>
      {selected ? (
        <div className="inspector-stack">
          <div className="plan-toolbar">
            <Button variant="outline" size="sm" onClick={() => setSelected(undefined)}>
              <ArrowLeft aria-hidden="true" /> Back to results
            </Button>
          </div>
          <Read
            atom={WorkspaceApi.query("work", "thoughtDetail", {
              query: selected,
              timeToLive: "0 seconds",
            })}
          >
            {(item) => (
              <SectionCard
                title={
                  <time dateTime={item.created_at}>
                    {new Date(item.created_at).toLocaleString()}
                  </time>
                }
                actions={
                  <a
                    className="report-download-link"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Memos <ArrowUpRight aria-hidden="true" />
                  </a>
                }
              >
                <p className="prose whitespace-pre-wrap break-words">{item.content}</p>
                <div className="button-row">
                  <Button size="sm" onClick={() => discuss(item.reference)}>
                    Ask Abra about this
                  </Button>
                  <RememberThought key={JSON.stringify(item.reference)} item={item} />
                </div>
                <EvidenceDisclosure
                  key={item.reference.name}
                  summary="Used in work"
                  open={used}
                  onToggle={setUsed}
                >
                  {used && (
                    <Read
                      atom={WorkspaceApi.query("work", "thoughtWork", {
                        query: { ...item.reference, offset },
                        timeToLive: "0 seconds",
                      })}
                    >
                      {(page) => (
                        <>
                          {!page.entries.length && (
                            <p className="muted">No accepted work references on this page.</p>
                          )}
                          {page.entries.map((row) => (
                            <div key={row.id} className="thought-work-row">
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() =>
                                  void navigate({
                                    to: "/thoughts",
                                    search: { collection, issue: row.id },
                                  })
                                }
                              >
                                {row.title}
                              </Button>
                              <StatusBadge
                                tone={
                                  row.wording_hash === item.reference.wording_hash
                                    ? "success"
                                    : "attention"
                                }
                              >
                                {row.wording_hash === item.reference.wording_hash
                                  ? "Current wording"
                                  : "Earlier wording"}
                              </StatusBadge>
                              <code>{row.wording_hash.slice(0, 12)}</code>
                            </div>
                          ))}
                          {(offset > 0 || page.next_offset !== undefined) && (
                            <div className="button-row">
                              {offset > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setOffset(Math.max(0, offset - 20))}
                                >
                                  Previous work
                                </Button>
                              )}
                              {page.next_offset !== undefined && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setOffset(page.next_offset!)}
                                >
                                  More work
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </Read>
                  )}
                </EvidenceDisclosure>
              </SectionCard>
            )}
          </Read>
        </div>
      ) : (
        <>
          <SectionCard>
            <form
              className="filter-grid"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery({ ...filters, cursor: undefined });
              }}
            >
              <Input
                aria-label="Thought text"
                placeholder="Search your thoughts…"
                maxLength={512}
                value={filters.text ?? ""}
                onChange={(e) => setFilters({ ...filters, text: e.target.value })}
              />
              <Input
                aria-label="Thought tag"
                placeholder="Tag"
                maxLength={256}
                value={filters.tag ?? ""}
                onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
              />
              <label htmlFor="thoughts-from" className="date-field">
                <span className="muted">From (UTC)</span>
                <Input
                  id="thoughts-from"
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
                />
              </label>
              <label htmlFor="thoughts-until" className="date-field">
                <span className="muted">Before (UTC)</span>
                <Input
                  id="thoughts-until"
                  type="date"
                  value={filters.until ?? ""}
                  onChange={(e) => setFilters({ ...filters, until: e.target.value || undefined })}
                />
              </label>
              <div className="filter-submit">
                <Button type="submit" variant="outline" size="sm">
                  Search thoughts
                </Button>
              </div>
            </form>
          </SectionCard>
          <Read atom={list}>
            {(page) => (
              <>
                {page.entries.length === 0 && <p className="empty-note">No matching thoughts.</p>}
                {page.entries.length > 0 && (
                  <ul className="work-list list-group thought-list">
                    {page.entries.map((row) => (
                      <li key={row.reference.name}>
                        <Button
                          variant="ghost"
                          className="list-row h-auto w-full whitespace-normal text-left"
                          onClick={() => setSelected(row.reference)}
                        >
                          <div className="list-row-main">
                            <span className="list-row-title">{row.snippet}</span>
                            <small className="list-row-sub">
                              {new Date(row.created_at).toLocaleString()}
                              {row.tags.length > 0 &&
                                ` · ${row.tags.map((t) => "#" + t).join(" ")}`}
                            </small>
                          </div>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {(query.cursor || page.next_cursor) && (
                  <nav aria-label="Thought pages" className="finder-pagination">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!query.cursor}
                      onClick={() =>
                        setQuery(
                          { ...query, cursor: cursors.at(-1) || undefined },
                          cursors.slice(0, -1),
                        )
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!page.next_cursor}
                      onClick={() =>
                        page.next_cursor &&
                        setQuery(
                          { ...query, cursor: page.next_cursor },
                          [...cursors, query.cursor ?? ""].slice(-32),
                        )
                      }
                    >
                      Next
                    </Button>
                  </nav>
                )}
              </>
            )}
          </Read>
        </>
      )}
    </section>
  );
}
