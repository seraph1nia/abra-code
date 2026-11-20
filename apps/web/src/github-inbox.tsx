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
import { WorkspaceApi } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { requestError } from "./request-error.ts";
import { Input } from "@abracode/presentation/ui/input";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@abracode/presentation/ui/sheet";

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
}: { target: InboxTarget; close: () => void } & Pick<Props, "ask" | "open">) {
  const query = WorkspaceApi.query("work", "githubItem", {
    query: target,
    timeToLive: "0 seconds",
  });
  return (
    <Sheet
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <SheetContent className="overflow-y-auto" side="right">
        <SheetTitle>
          {target.repository_id} {target.kind === "pr" ? "PR" : "issue"} #{target.number}
        </SheetTitle>
        <SheetDescription>GitHub item and linked Abra work</SheetDescription>
        <RequestState query={query}>
          {(item: InboxDetail) => (
            <section className="space-y-3">
              <h3>{item.title}</h3>
              <p>
                {item.state.toLowerCase()} · {item.author ?? "Unknown author"} ·{" "}
                {new Date(item.observed_at).toLocaleString()}
              </p>
              <a href={item.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
              <p className="whitespace-pre-wrap">{item.body}</p>
              {item.links.map((link) => (
                <Button
                  key={link.role + link.issue_id}
                  variant="outline"
                  onClick={() => {
                    close();
                    open(
                      link.issue_id,
                      link.role === "review" && link.status === "closed" ? "Reports" : undefined,
                    );
                  }}
                >
                  {link.role} · {link.status} · {link.issue_id}
                </Button>
              ))}
              {item.base && (
                <p>
                  Current base {item.base.slice(0, 8)} · head {item.head?.slice(0, 8)}
                </p>
              )}
              {item.links
                .filter((l) => l.revision)
                .map((l) => (
                  <p key={l.issue_id}>Reviewed revision {l.revision?.slice(0, 8)}</p>
                ))}
              {item.comments.length > 0 && <h4>Recent discussion</h4>}
              {item.comments.map((c, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  <strong>{c.author}</strong> {c.body}
                </p>
              ))}
              {!item.comments_complete && <p>Showing part of the discussion.</p>}
              {item.state === "OPEN" && (
                <Button
                  onClick={() => {
                    close();
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
              )}
            </section>
          )}
        </RequestState>
      </SheetContent>
    </Sheet>
  );
}
export function GithubInbox({ query: base, ask, open }: Props) {
  const [kind, setKind] = useState<InboxQuery["kind"]>(),
    [role, setRole] = useState<InboxQuery["role"]>(),
    [label, setLabel] = useState(""),
    [filter, setFilter] = useState(""),
    [state, setState] = useState<InboxQuery["state"]>("OPEN");
  const scope = JSON.stringify([base.repository_id, base.search, kind, role, filter, state]);
  const [pagination, setPagination] = useState({ scope, offset: 0 });
  const offset = scope === pagination.scope ? pagination.offset : 0;
  const [target, setTarget] = useState<InboxTarget>(),
    [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const handle = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(label.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [label]);

  const query = { ...base, kind, role, state, label: filter || undefined, offset };
  return (
    <section className="max-h-[38dvh] shrink-0 space-y-2 overflow-y-auto" aria-label="GitHub inbox">
      <h3>GitHub inbox</h3>
      <details>
        <summary>GitHub filters</summary>
        <NativeSelect
          aria-label="GitHub item type"
          value={kind ?? ""}
          onChange={(e) => {
            setKind((e.target.value as typeof kind) || undefined);
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
            setState(e.target.value as typeof state);
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
            setRole((e.target.value as typeof role) || undefined);
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
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setState("OPEN");
            setLabel("");
            setRole(undefined);
            setKind(undefined);
          }}
        >
          Clear GitHub filters
        </Button>
      </details>
      {visible && (
        <Rows
          query={query}
          select={setTarget}
          page={(offset) => setPagination({ scope, offset })}
        />
      )}
      {visible && target && (
        <Item target={target} close={() => setTarget(undefined)} ask={ask} open={open} />
      )}
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
      <Button
        variant="ghost"
        onClick={async () => {
          await force(query);
          registry.refresh(atom);
        }}
      >
        Refresh GitHub
      </Button>
      {AsyncResult.isFailure(result) && <p role="alert">{requestError(result.cause)}</p>}
      {!data && !AsyncResult.isFailure(result) && <output>Loading GitHub work…</output>}
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
          {data.coverage.length > 0 && (
            <small className="block">
              {data.total}{" "}
              {data.coverage.some((c) => c.status !== "current") ? "observed" : "matching"} GitHub
              items
            </small>
          )}
          <nav className="work-list" aria-label="GitHub results">
            {data.entries.map((row) => (
              <Button
                key={row.repository_id + row.item_node}
                variant="ghost"
                className="work-nav h-auto flex-col items-stretch whitespace-normal"
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
                <span>
                  {row.repository_id} {row.kind === "pr" ? "PR" : "issue"} #{row.number} ·{" "}
                  {row.title}
                </span>
                <small>
                  {row.author ?? "Unknown author"} · {row.draft ? "draft · " : ""}
                  {row.state.toLowerCase()} ·{" "}
                  {row.links
                    .map((l) => l.role + " (" + l.status.replaceAll("_", " ") + ")")
                    .join(", ") || "No assignment"}{" "}
                  {row.labels.join(", ")}
                  {!row.labels_complete ? " …" : ""}
                </small>
              </Button>
            ))}
          </nav>
          {(offset > 0 || offset + 50 < data.total) && (
            <div>
              <Button
                variant="outline"
                disabled={!offset}
                onClick={() => page(Math.max(0, offset - 50))}
              >
                Previous GitHub page
              </Button>
              <Button
                variant="outline"
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
