/* oxlint-disable effecttsgo/unstable-api-usage -- Typed HTTP query atoms for the mounted inbox. */
import { useContext, useEffect, useState } from "react";
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Effect, Option } from "effect";
import type {
  InboxQuery,
  InboxTarget,
  InboxDetail,
} from "@abracode/contracts/visibility/github-inbox";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "@abracode/presentation/icons";
import { SectionCard, StatusBadge, statusTone } from "@abracode/presentation/cockpit";
import { WorkspaceApi } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { requestError } from "./request-error.ts";
import { Input } from "@abracode/presentation/ui/input";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

const forceRefresh = WorkspaceApi.runtime.fn((query: InboxQuery) =>
  Effect.flatMap(WorkspaceApi, (client) =>
    client.work.githubInbox({ query: { ...query, refresh: true } }),
  ),
);

type Props = {
  query: InboxQuery;
  ask: (text: string) => void;
  open: (id: string, tab?: "Reports") => void;
};

function Item({
  target,
  close,
  ask,
  open,
}: { target: InboxTarget; close: () => Promise<void> } & Pick<Props, "ask" | "open">) {
  const query = WorkspaceApi.query("work", "githubItem", {
    query: target,
    timeToLive: "0 seconds",
  });
  return (
    <div className="inspector-stack">
      <div className="plan-toolbar">
        <Button variant="outline" size="sm" onClick={() => void close()}>
          <ArrowLeft aria-hidden="true" /> Back to GitHub
        </Button>
        <StatusBadge tone="neutral">
          {target.repository_id} {target.kind === "pr" ? "PR" : "issue"} #{target.number}
        </StatusBadge>
      </div>
      <RequestState query={query}>
        {(item: InboxDetail) => (
          <div className="inspector-stack">
            <SectionCard
              title={item.title}
              actions={
                <div className="button-row" style={{ margin: 0 }}>
                  <StatusBadge tone={statusTone(item.state)} dot>
                    {item.state.toLowerCase()}
                  </StatusBadge>
                  <a
                    className="report-download-link"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on GitHub <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              }
            >
              <p className="muted">
                {item.author ?? "Unknown author"} · Observed{" "}
                {new Date(item.observed_at).toLocaleString()}
              </p>
              {item.base && (
                <p className="muted">
                  Current base <code>{item.base.slice(0, 8)}</code> · head{" "}
                  <code>{item.head?.slice(0, 8)}</code>
                </p>
              )}
              {item.body && <p className="prose whitespace-pre-wrap">{item.body}</p>}
              {item.links.length > 0 && (
                <div className="button-row">
                  {item.links.map((link) => (
                    <Button
                      key={link.role + link.issue_id}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        open(
                          link.issue_id,
                          link.role === "review" && link.status === "closed"
                            ? "Reports"
                            : undefined,
                        );
                      }}
                    >
                      {link.role} · {link.status} · {link.issue_id}
                    </Button>
                  ))}
                </div>
              )}
              {item.links
                .filter((l) => l.revision)
                .map((l) => (
                  <p className="muted" key={l.issue_id}>
                    Reviewed revision <code>{l.revision?.slice(0, 8)}</code>
                  </p>
                ))}
              {item.state === "OPEN" && (
                <div className="button-row">
                  <Button
                    size="sm"
                    onClick={async () => {
                      await close();
                      ask(
                        (item.kind === "pr" ? "Privately review " : "Pick up ") +
                          item.url +
                          " in project " +
                          item.repository_id +
                          ".",
                      );
                    }}
                  >
                    {item.kind === "pr" ? "Ask Abra to review" : "Ask Abra to pick up"}
                  </Button>
                </div>
              )}
            </SectionCard>
            {item.comments.length > 0 && (
              <SectionCard title={`Recent discussion (${item.comments.length})`}>
                <div className="inspector-stack">
                  {item.comments.map((c, i) => (
                    <article key={i} className="comment-item">
                      <strong>{c.author}</strong>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </article>
                  ))}
                </div>
                {!item.comments_complete && (
                  <p className="muted">Showing part of the discussion.</p>
                )}
              </SectionCard>
            )}
          </div>
        )}
      </RequestState>
    </div>
  );
}

export function GithubInbox({
  ask,
  open,
  projects,
}: Omit<Props, "query"> & { projects: readonly { id: string; name: string }[] }) {
  const { collection } = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const query = { state: "OPEN", ...collection?.github } satisfies InboxQuery;
  const { kind, role, state } = query;

  const target = collection?.item;
  const update = (change: Partial<InboxQuery>) =>
    void navigate({
      to: "/github",
      search: { collection: { github: { ...query, offset: 0, ...change } } },
    });
  const setTarget = (item?: InboxTarget) =>
    navigate({ to: "/github", search: { collection: { github: query, item } } });
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const handle = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);

  if (visible && target) {
    return (
      <section className="collection-work" aria-label="GitHub inbox">
        <Item target={target} close={() => setTarget(undefined)} ask={ask} open={open} />
      </section>
    );
  }

  return (
    <section className="collection-work" aria-label="GitHub inbox">
      <div className="hub-header">
        <h2>GitHub inbox</h2>
      </div>
      <div className="hub-toolbar">
        <form
          className="hub-search-form"
          key={query.search ?? ""}
          onSubmit={(e) => {
            e.preventDefault();
            const field = new FormData(e.currentTarget).get("text");
            const search = typeof field === "string" ? field.trim() : "";
            update({ search: search || undefined });
          }}
        >
          <Input
            aria-label="Search GitHub"
            name="text"
            defaultValue={query.search}
            placeholder="Search GitHub items"
            maxLength={256}
          />
          <Button type="submit" variant="outline" size="sm">
            Search GitHub items
          </Button>
        </form>
        <NativeSelect
          aria-label="GitHub repository"
          value={query.repository_id ?? ""}
          onChange={(e) =>
            update({ repository_id: (e.target.value || undefined) as InboxQuery["repository_id"] })
          }
        >
          <option value="">All repositories</option>
          {projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <details className="evidence-disclosure">
        <summary>GitHub filters</summary>
        <div className="evidence-disclosure-body filter-grid">
          <NativeSelect
            aria-label="GitHub item type"
            value={kind ?? ""}
            onChange={(e) => {
              update({ kind: (e.target.value as typeof kind) || undefined });
            }}
          >
            <option value="">Issues and pull requests</option>
            <option value="issue">Issues</option>
            <option value="pr">Pull requests</option>
          </NativeSelect>
          <NativeSelect
            aria-label="GitHub state"
            value={state}
            onChange={(e) => {
              update({ state: e.target.value as typeof state });
            }}
          >
            {["OPEN", "CLOSED", "MERGED"].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Abra role"
            value={role ?? ""}
            onChange={(e) => {
              update({ role: (e.target.value as typeof role) || undefined });
            }}
          >
            <option value="">Any Abra role</option>
            {["unassigned", "pickup", "review", "delivery"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </NativeSelect>
          <Input
            aria-label="GitHub label"
            placeholder="Filter by label"
            key={query.label ?? ""}
            defaultValue={query.label ?? ""}
            onBlur={(e) => {
              const label = e.target.value.trim();
              if (label !== (query.label ?? "")) update({ label: label || undefined });
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigate({ to: "/github", search: {} });
            }}
          >
            Clear GitHub filters
          </Button>
        </div>
      </details>
      {visible && <Rows query={query} select={setTarget} page={(offset) => update({ offset })} />}
    </section>
  );
}

function Rows({
  query,
  select,
  page,
}: {
  query: InboxQuery;
  select: (target: InboxTarget) => void;
  page: (offset: number) => void;
}) {
  const atom = WorkspaceApi.query("work", "githubInbox", { query, timeToLive: "0 seconds" });
  const registry = useContext(RegistryContext),
    result = useAtomValue(atom);
  const force = useAtomSet(forceRefresh, { mode: "promiseExit" });
  const data = Option.getOrUndefined(AsyncResult.value(result));
  const pending = data?.coverage.some(
    (c) => c.status === "loading" || (c.status === "stale" && !c.message),
  );
  useEffect(() => {
    if (result.waiting) return;
    const timer = setTimeout(
      () => {
        if (!document.hidden) registry.refresh(atom);
      },
      pending ? 1000 : 300000,
    );
    return () => clearTimeout(timer);
  }, [registry, atom, pending, result]);
  const offset = query.offset ?? 0;
  return (
    <>
      <div className="hub-meta-row">
        {data && data.coverage.length > 0 ? (
          <small className="muted">
            {data.total}{" "}
            {data.coverage.some((c) => c.status !== "current") ? "observed" : "matching"} GitHub
            items
          </small>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await force(query);
            registry.refresh(atom);
          }}
        >
          <RefreshCw aria-hidden="true" />
          Refresh GitHub
        </Button>
      </div>
      {AsyncResult.isFailure(result) && (
        <p role="alert" className="error">
          {requestError(result.cause)}
        </p>
      )}
      {!data && !AsyncResult.isFailure(result) && (
        <output className="muted">Loading GitHub work…</output>
      )}
      {data && (
        <>
          {data.coverage
            .filter((c) => c.status !== "current")
            .map((c) => (
              <p className="muted" key={c.repository_id + c.kind}>
                {c.repository_id} · {c.kind} · {c.status} {c.message}
                {c.observed_at && " · Last checked " + new Date(c.observed_at).toLocaleString()}
              </p>
            ))}
          <nav className="work-list list-group" aria-label="GitHub results">
            {data.entries.map((row) => (
              <Button
                key={row.repository_id + row.item_node}
                variant="ghost"
                className="work-nav list-row h-auto whitespace-normal"
                onClick={() =>
                  select({
                    repository_id: row.repository_id,
                    repo_node: row.repo_node,
                    item_node: row.item_node,
                    number: row.number,
                    kind: row.kind,
                  })
                }
              >
                <div className="work-nav-left">
                  <span
                    className={`status-dot ${row.state === "OPEN" ? "open" : row.state === "MERGED" ? "in_progress" : "closed"}`}
                  />
                  <div className="work-nav-text">
                    <span className="work-title">
                      {row.repository_id} {row.kind === "pr" ? "PR" : "issue"} #{row.number} ·{" "}
                      {row.title}
                    </span>
                    <small>
                      {row.author ?? "Unknown author"} · {row.draft ? "draft · " : ""}
                      {row.links
                        .map((l) => l.role + " (" + l.status.replaceAll("_", " ") + ")")
                        .join(", ") || "No assignment"}
                      {row.labels.length > 0 && ` · ${row.labels.join(", ")}`}
                      {!row.labels_complete ? " …" : ""}
                    </small>
                  </div>
                </div>
                <StatusBadge tone={statusTone(row.state)}>{row.state.toLowerCase()}</StatusBadge>
              </Button>
            ))}
            {!data.entries.length && <p className="empty-note">No matching GitHub items.</p>}
          </nav>
          {(offset > 0 || offset + 50 < data.total) && (
            <div className="finder-pagination">
              <Button
                variant="outline"
                size="sm"
                disabled={!offset}
                onClick={() => page(Math.max(0, offset - 50))}
              >
                Previous GitHub page
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 50 >= data.total}
                onClick={() => page(offset + 50)}
              >
                Next GitHub page
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
