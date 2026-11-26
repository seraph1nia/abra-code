import { useNavigate } from "@tanstack/react-router";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { Inspect } from "@abracode/presentation/cards";
import { WorkspaceApi, agentsQuery, repositoriesQuery } from "../data.ts";
import { queries } from "../work-data.ts";
import { paletteHits, useSource, sourceFeedback, type Source } from "../palette-source.ts";

export function useCollectionSources({
  query,
  active,
  activeExplicit,
  current,
  chat,
  finder,
  go,
}: {
  query: string;
  active: (s: Source) => boolean;
  activeExplicit: (s: Source) => boolean;
  current?: WorkspaceSnapshot;
  chat: () => void;
  finder: (query: string) => void;
  go: Inspect;
}) {
  const navigate = useNavigate();
  const { hits, add } = paletteHits();
  const { more, status, report } = sourceFeedback();
  const work = useSource(active("work"), () =>
    queries.find({ search: query, state: "all", limit: 8 }),
  );
  const workers = useSource(active("session"), () =>
    WorkspaceApi.query("work", "sessions", {
      query: { search: query, limit: 8 },
      timeToLive: "15 seconds",
    }),
  );
  const notebook = query.startsWith("#") ? { tag: query.slice(1) } : { text: query };
  const notes = useSource(active("thought"), () =>
    WorkspaceApi.query("work", "thoughtList", { query: notebook, timeToLive: "15 seconds" }),
  );
  function github(state: "OPEN" | "CLOSED" | "MERGED") {
    return WorkspaceApi.query("work", "githubInbox", {
      query: { search: query, state },
      timeToLive: "15 seconds",
    });
  }
  const opened = useSource(active("github"), () => github("OPEN"));
  const closed = useSource(activeExplicit("github"), () => github("CLOSED"));
  const merged = useSource(activeExplicit("github"), () => github("MERGED"));
  const agents = useSource(active("agent"), () => agentsQuery);
  const repos = useSource(active("repo"), () => repositoriesQuery);
  for (const row of work.data?.entries ?? [])
    add(
      "work",
      row.issue_id,
      row.title,
      [row.repository_id, row.issue_status].filter(Boolean).join(" · "),
      "Open",
      () => go({ action: "open_task", issue_id: row.issue_id }),
    );
  if (current && active("session"))
    add("session", current.session_id, "Abra", "Main conversation", "Open", chat);
  for (const row of workers.data?.entries ?? [])
    add(
      "session",
      row.session_id,
      row.role + " · " + row.session_id,
      row.title + " · " + row.repository_id + " · " + row.association + " · " + row.availability,
      "Open",
      () => go({ action: "open_session", issue_id: row.issue_id, session_id: row.session_id }),
    );
  for (const row of notes.data?.entries ?? [])
    add(
      "thought",
      row.reference.name,
      row.snippet,
      row.reference.account + " · " + row.tags.map((t) => "#" + t).join(" "),
      "Open",
      () => void navigate({ to: "/thoughts", search: { collection: { memo: row.reference } } }),
    );
  for (const part of [opened, closed, merged])
    for (const row of part.data?.entries ?? []) {
      const { repository_id, repo_node, item_node, number, kind } = row;
      add(
        "github",
        repository_id + "/" + item_node,
        row.title,
        `${repository_id} #${number} · ${row.state}`,
        "Open",
        () =>
          void navigate({
            to: "/github",
            search: {
              collection: {
                item: { repository_id, repo_node, item_node, number, kind },
                github: { state: row.state, search: query },
              },
            },
          }),
      );
    }
  for (const agent of agents.data?.agents ?? [])
    add(
      "agent",
      agent.id,
      agent.id,
      agent.description,
      "Open",
      () => void navigate({ to: "/settings", hash: "agent-" + agent.id }),
    );
  for (const repo of repos.data ?? [])
    add(
      "repo",
      repo.id,
      repo.name,
      repo.id,
      "Open",
      () => void navigate({ to: "/settings/repositories", hash: "repo-" + repo.id }),
    );
  report("Work", work);
  report("Sessions", workers);
  report("Thoughts", notes);
  report("Open GitHub", opened);
  report("Closed GitHub", closed);
  report("Merged GitHub", merged);
  report("Agents", agents);
  report("Repositories", repos);
  if (work.data && !work.data.entries.length) status.push("No matching work.");
  if ([opened, closed, merged].some((s) => s.data?.coverage.some((c) => c.status !== "current")))
    status.push("GitHub coverage is partial.");
  if (active("work"))
    more.push({ id: "all", label: "See all results in Work", run: () => finder(query) });
  if (active("thought") && notes.data?.next_cursor)
    more.push({
      id: "more-thought",
      label: "More in Thoughts",
      run: () => void navigate({ to: "/thoughts", search: { collection: { notebook } } }),
    });
  if (active("session") && workers.data?.next_offset)
    more.push({
      id: "more-session",
      label: "More in Sessions",
      run: () =>
        void navigate({
          to: "/work",
          search: { collection: { section: "sessions", work: { search: query } } },
        }),
    });
  if (active("github"))
    for (const [state, part] of [
      ["OPEN", opened],
      ["CLOSED", closed],
      ["MERGED", merged],
    ] as const)
      if (part.data && part.data.total > 4)
        more.push({
          id: "more-" + state,
          label: "More " + state.toLowerCase() + " items in GitHub",
          run: () =>
            void navigate({
              to: "/github",
              search: { collection: { github: { search: query, state } } },
            }),
        });
  return { hits, more, status };
}
