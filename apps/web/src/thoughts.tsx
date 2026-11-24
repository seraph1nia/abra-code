import { RememberThought } from "./remember-thought.tsx";
import { RunCommand, composerCommands } from "./workspace-commands.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Typed workspace HTTP atoms own mounted query lifetimes. */
import { useContext, useState, type ReactNode } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, type Atom } from "effect/reactivity";
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
      <div role="alert">
        {requestError(result.cause)}{" "}
        <Button variant="outline" onClick={() => registry.refresh(atom)}>
          Retry
        </Button>
      </div>
    );
  if (!AsyncResult.isSuccess(result) || result.waiting) return <output>Loading thoughts…</output>;
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
    <section aria-label="Personal thoughts" className="space-y-3 overflow-y-auto p-2">
      <div className="sidebar-heading">
        <h2>Thoughts</h2>
        <Button variant="outline" onClick={() => runCommand(composerCommands[1])}>
          Save a thought
        </Button>
      </div>
      {selected ? (
        <>
          <Button variant="outline" onClick={() => setSelected(undefined)}>
            Back to results
          </Button>
          <Read
            atom={WorkspaceApi.query("work", "thoughtDetail", {
              query: selected,
              timeToLive: "0 seconds",
            })}
          >
            {(item) => (
              <article className="space-y-3">
                <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
                <p className="whitespace-pre-wrap break-words">{item.content}</p>
                <a href={item.url} target="_blank" rel="noreferrer">
                  Open in Memos
                </a>
                <details key={item.reference.name} onToggle={(e) => setUsed(e.currentTarget.open)}>
                  <summary>Used in work</summary>
                  {used && (
                    <Read
                      atom={WorkspaceApi.query("work", "thoughtWork", {
                        query: { ...item.reference, offset },
                        timeToLive: "0 seconds",
                      })}
                    >
                      {(page) => (
                        <>
                          {!page.entries.length && <p>No accepted work references on this page.</p>}
                          {page.entries.map((row) => (
                            <p key={row.id}>
                              <Button
                                onClick={() =>
                                  void navigate({
                                    to: "/thoughts",
                                    search: { collection, issue: row.id },
                                  })
                                }
                              >
                                {row.title}
                              </Button>{" "}
                              ·{" "}
                              {row.wording_hash === item.reference.wording_hash
                                ? "Current wording"
                                : "Earlier wording"}{" "}
                              · {row.wording_hash.slice(0, 12)}
                            </p>
                          ))}
                          {offset > 0 && (
                            <Button onClick={() => setOffset(Math.max(0, offset - 20))}>
                              Previous work
                            </Button>
                          )}
                          {page.next_offset !== undefined && (
                            <Button onClick={() => setOffset(page.next_offset!)}>More work</Button>
                          )}
                        </>
                      )}
                    </Read>
                  )}
                </details>
                <RememberThought
                  key={`${item.reference.instance}:${item.reference.account}:${item.reference.name}:${item.reference.wording_hash}`}
                  item={item}
                />
                <Button onClick={() => discuss(item.reference)}>Ask Abra about this</Button>
              </article>
            )}
          </Read>
        </>
      ) : (
        <>
          <form
            className="space-y-2"
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
            <label htmlFor="thoughts-from">
              From (UTC)
              <Input
                id="thoughts-from"
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
              />
            </label>
            <label htmlFor="thoughts-until">
              Before (UTC)
              <Input
                id="thoughts-until"
                type="date"
                value={filters.until ?? ""}
                onChange={(e) => setFilters({ ...filters, until: e.target.value || undefined })}
              />
            </label>
            <Button type="submit">Search thoughts</Button>
          </form>
          <Read atom={list}>
            {(page) => (
              <>
                {page.entries.length === 0 && <p>No matching thoughts.</p>}
                <ul className="work-list">
                  {page.entries.map((row) => (
                    <li key={row.reference.name}>
                      <Button
                        variant="ghost"
                        className="h-auto w-full flex-col items-start whitespace-normal text-left"
                        onClick={() => setSelected(row.reference)}
                      >
                        <span>{row.snippet}</span>
                        <small>
                          {new Date(row.created_at).toLocaleString()}{" "}
                          {row.tags.map((t) => "#" + t).join(" ")}
                        </small>
                      </Button>
                    </li>
                  ))}
                </ul>
                {(query.cursor || page.next_cursor) && (
                  <nav aria-label="Thought pages">
                    <Button
                      variant="outline"
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
