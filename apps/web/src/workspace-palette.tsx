/* oxlint-disable effecttsgo/unstable-api-usage -- Cancelling the picker releases its typed HTTP atom subscriptions. */
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { SearchDialog } from "@abracode/presentation/ui/search-dialog";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { Exit } from "effect";
import { toast } from "sonner";
import { requestError } from "./request-error.ts";
import { reviewListQuery } from "./review-data.ts";
import { MessageId } from "@abracode/contracts/identities";
import { selectionLabel } from "@abracode/contracts/web/resources";
import { workspaceDraft } from "./workspace-state/draft.ts";
import { EvidenceKind } from "@abracode/contracts/visibility/discovery-contracts";
import {
  WorkspaceApi,
  resolveResource,
  agentsQuery,
  repositoriesQuery,
  bootstrapQuery,
} from "./data.ts";
import { queries } from "./work-data.ts";
import {
  destinations,
  destinationFor,
  searchForResource,
  type WorkspaceSearch,
} from "./navigation.ts";
import { RunCommand, composerCommands, snippetDraft, workControl } from "./workspace-commands.ts";

import { useSource, sources, sourceFeedback, type Source, type Hit } from "./palette-source.ts";
import { useEvidenceSource } from "./palette-evidence.ts";
import { useMemorySource } from "./palette-memory.tsx";

export type PaletteActions = {
  origin: HTMLElement;
  initialSource?: "memory";
  close: () => void;
  chat: () => void;
  finder: (query?: string) => void;
};
type Props = PaletteActions & {
  workspace?: WorkspaceSnapshot;
  selected?: string;
  resume?: WorkspaceSearch;
  review?: () => void;
  inspect?: (target: ResourceSelection) => void;
  prepare?: (text: string) => void;
  history?: {
    messages: WorkspaceSnapshot["messages"];
    more: boolean;
    loading: boolean;
    load: () => void;
  };
};
const emptyDraft = Atom.make(undefined);
export default function WorkspacePalette({
  origin,
  initialSource,
  close,
  chat,
  finder,
  workspace,
  selected,
  resume,
  review,
  inspect,
  prepare,
  history,
}: Props) {
  const navigate = useNavigate();
  const run = useContext(RunCommand);
  const [value, setValue] = useState(initialSource ? initialSource + ": " : "");
  const input = value.trim();
  const prefix = sources.find((s) => input.toLowerCase().startsWith(s + ":"));
  const evidenceKind = EvidenceKind.literals.find((k) => input.toLowerCase().startsWith(k + ":"));
  const filter = evidenceKind && !prefix ? "evidence" : input.startsWith(">") ? "command" : prefix;
  const query = (
    evidenceKind
      ? input.slice(evidenceKind.length + 1)
      : prefix
        ? input.slice(prefix.length + 1)
        : filter === "command"
          ? input.slice(1)
          : input
  ).trim();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(input), 180);
    return () => clearTimeout(timer);
  }, [input]);
  const active = (source: Source) => !!input && input === settled && (!filter || filter === source);
  const snapshot = useSource(
    !workspace &&
      (active("session") ||
        active("attention") ||
        active("message") ||
        active("surface") ||
        active("review")),
    () => bootstrapQuery,
  );
  const current = workspace ?? snapshot.data;
  const [publicationPage, setPublicationPage] = useState<{
    forInput: string;
    session: string;
    cursor: string;
  }>();
  const pubs = useSource(!!current && (active("surface") || active("review")), () =>
    WorkspaceApi.query("workspace", "publications", {
      query: {
        search: query,
        kind: filter === "surface" || filter === "review" ? filter : undefined,
        cursor:
          publicationPage?.session === current?.session_id && publicationPage?.forInput === input
            ? publicationPage.cursor
            : undefined,
      },
      reactivityKeys: ["publications/" + current?.session_id],
      timeToLive: "0 seconds",
    }),
  );
  const reviews = useSource(active("review"), () => reviewListQuery());
  const work = useSource(active("work"), () =>
    queries.find({ search: query, state: "all", limit: 8 }),
  );
  const workers = useSource(active("session"), () =>
    WorkspaceApi.query("work", "sessions", {
      query: { search: query, limit: 8 },
      timeToLive: "0 seconds",
    }),
  );
  const notebook = query.startsWith("#") ? { tag: query.slice(1) } : { text: query };
  const notes = useSource(active("thought"), () =>
    WorkspaceApi.query("work", "thoughtList", { query: notebook, timeToLive: "0 seconds" }),
  );
  function github(state: "OPEN" | "CLOSED" | "MERGED") {
    return WorkspaceApi.query("work", "githubInbox", {
      query: { search: query, state },
      timeToLive: "0 seconds",
    });
  }
  const opened = useSource(active("github"), () => github("OPEN"));
  const closed = useSource(active("github"), () => github("CLOSED"));
  const merged = useSource(active("github"), () => github("MERGED"));
  const agents = useSource(active("agent"), () => agentsQuery);
  const memory = useMemorySource(active("memory"), filter === "memory", query);
  const repos = useSource(active("repo"), () => repositoriesQuery);
  const draft = useAtomValue(current ? workspaceDraft(current.session_id) : emptyDraft);
  const lower = query.toLowerCase();
  const hits: Hit[] = [];
  const add = (
    source: Source,
    identity: string,
    label: string,
    detail: string,
    effect: Hit["effect"],
    select: () => void,
    aliases?: readonly string[],
  ) => {
    hits.push({
      id: source + "/" + identity,
      source,
      identity,
      label,
      detail,
      effect,
      run: select,
      aliases,
    });
  };
  const resolve = useAtomSet(resolveResource, { mode: "promiseExit" });
  const go = (target: ResourceSelection) => {
    if (inspect) inspect(target);
    else {
      const address = location.href;
      void resolve({ payload: target }).then((result) => {
        if (location.href !== address) return;
        if (Exit.isFailure(result)) {
          toast.error("Couldn’t open this work item", { description: requestError(result.cause) });
          return;
        }
        void navigate({ to: "/", search: searchForResource(result.value) });
      });
    }
  };
  const reader = (search: WorkspaceSearch) =>
    void navigate({
      to: destinationFor(location.pathname) ?? "/",
      search: (previous) => ({ collection: previous.collection, ...search }),
    });
  const evidence = useEvidenceSource(active("evidence"), input, query, evidenceKind, go, reader);
  hits.push(...evidence.hits);
  for (const row of reviews.data?.reviews ?? [])
    add(
      "review",
      row.review_id + "/" + row.revision,
      row.title,
      "Interactive review · " + row.hash,
      "Open",
      () => reader({ review: { review_id: row.review_id, revision: row.revision } }),
    );
  for (const row of current?.surfaces ?? [])
    if (!("unavailable" in row) && current) {
      const id = "surface" in row ? row.surface.createSurface.surfaceId : row.surface_id;
      add(
        "surface",
        id + "/" + row.revision,
        id,
        "Generated view · revision " + row.revision,
        "Open",
        () =>
          reader({
            surface: { session_id: current.session_id, surface_id: id, revision: row.revision },
          }),
      );
    }
  const confirmedPublications = new Set<string>();
  for (const entry of pubs.data?.entries ?? []) {
    if (entry.session_id !== current?.session_id) continue;
    if (entry.target.kind === "surface")
      confirmedPublications.add("surface/" + entry.target.surface_id + "/" + entry.target.revision);
    if (entry.target.kind === "review")
      confirmedPublications.add("review/" + entry.target.review_id + "/" + entry.target.revision);
    const t = entry.target;
    if (t.kind === "surface")
      add(
        "surface",
        t.surface_id + "/" + t.revision,
        t.surface_id,
        "Published revision " + t.revision + " · " + entry.message_id,
        "Open",
        () =>
          reader({
            surface: {
              session_id: entry.session_id,
              surface_id: t.surface_id,
              revision: t.revision,
            },
          }),
      );
    if (t.kind === "review")
      add(
        "review",
        t.review_id + "/" + t.revision,
        t.review_id,
        "Published revision " + t.revision + " · " + entry.message_id,
        "Open",
        () => reader({ review: { review_id: t.review_id, revision: t.revision } }),
      );
  }
  for (const [path, label] of Object.entries(destinations))
    add(
      "page",
      path,
      label,
      "Workspace",
      "Open",
      () => void navigate({ to: destinationFor(path) ?? "/", search: {} }),
    );
  add(
    "page",
    "settings",
    "Settings",
    "Workspace",
    "Open",
    () => void navigate({ to: "/settings" }),
  );
  for (const [section, label] of [
    ["sessions", "Sessions"],
    ["capacity", "Capacity"],
    ["recent", "Recently inspected"],
  ] as const)
    add(
      "page",
      "work/" + section,
      label,
      "Work",
      "Open",
      () => void navigate({ to: "/work", search: { collection: { section } } }),
    );
  for (const [path, label] of [
    ["/settings", "Agents"],
    ["/settings/repositories", "Repositories"],
    ["/settings/appearance", "Appearance"],
    ["/settings/about", "About and licenses"],
  ] as const)
    add("page", path, label, "Settings", "Open", () => void navigate({ to: path }));
  for (const action of composerCommands) {
    if (action.id === "memory") {
      if (memory.available)
        hits.push({
          id: "command/memory",
          identity: action.id,
          source: "command",
          label: action.label,
          detail: "Basic Memory",
          aliases: [...action.aliases, "/memory"],
          effect: action.effect,
          keepOpen: true,
          run: () => changeSearch("memory: "),
        });
      continue;
    }
    add("command", action.id, action.label, "Chat", action.effect, () => run(action), [
      ...action.aliases,
      "/" + action.id,
    ]);
  }
  hits.push(...memory.hits);
  add("command", "chat", "Return to chat", "Abra", "Open", chat);
  add("command", "finder", "Open Work finder", "Work", "Open", () => finder());
  if (resume)
    add(
      "command",
      "resume",
      "Resume last inspection",
      resume.issue ?? "Conversation view",
      "Open",
      () => void navigate({ to: "/", search: resume }),
    );
  const exportButton = selected && document.getElementById("export-report-" + selected);
  if (exportButton && exportButton instanceof HTMLButtonElement && !exportButton.disabled)
    add(
      "command",
      "export-report",
      "Open report export controls",
      selected!,
      "Open",
      () => requestAnimationFrame(() => exportButton.focus()),
      ["download report"],
    );
  if (review)
    add("command", "review", "Review pending decisions", "Attention", "Open form", review);
  const attachment = draft?.attachment;
  if (prepare && attachment && attachment.selection.kind !== "region") {
    const source = attachment.selection.issue_id + " · " + selectionLabel(attachment.selection);
    add(
      "command",
      "insert-snippet",
      "Insert selected code in chat",
      source,
      "Prepare draft",
      () => prepare(snippetDraft(attachment.excerpt, source)),
      ["paste snippet"],
    );
  }
  if (selected) {
    for (const tab of ["Plan", "Diff", "Verification", "Reports"] as const)
      add(
        "command",
        tab,
        "Open " + tab,
        selected,
        "Open",
        () =>
          void navigate({
            to: destinationFor(location.pathname) ?? "/",
            search: (previous) => ({ collection: previous.collection, issue: selected, tab }),
          }),
      );
    for (const action of ["pause", "resume", "advance"] as const) {
      const item = workControl(action, selected);
      if (prepare)
        add("command", action + "-" + selected, item.label, selected, "Prepare draft", () =>
          prepare(item.text),
        );
    }
  }
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
  for (const form of current?.forms ?? [])
    if (form.active)
      add(
        "attention",
        form.form.id,
        form.form.title,
        "Native form",
        "Open form",
        () =>
          void navigate({ to: "/attention", hash: "form-" + form.form.id + "-" + form.binding }),
      );
  for (const p of current?.permissions ?? [])
    add(
      "attention",
      p.request.id,
      p.request.action,
      "Permission",
      "Open form",
      () =>
        void navigate({ to: "/attention", hash: "permission-" + p.request.id + "-" + p.binding }),
    );
  for (const m of history?.messages ?? current?.messages ?? [])
    if (m.text)
      add(
        "message",
        m.id,
        m.text.slice(0, 100),
        m.role + " · observed conversation",
        "Open",
        () => {
          if (current)
            void navigate({
              to: "/",
              search: {
                message: { session_id: current.session_id, message_id: MessageId.make(m.id) },
              },
              hash: "message-" + m.id,
            });
        },
        [m.text],
      );
  const { more, status, report } = sourceFeedback();
  more.push(...memory.more);
  status.push(...memory.status);
  report("Publications", pubs);
  if (pubs.data?.incomplete) status.push("Some retained publication associations are unavailable.");
  const publicationNext = pubs.data?.next;
  if (publicationNext)
    more.push({
      id: "more-publications",
      label: "Search next publication page",
      keepOpen: true,
      run: () =>
        setPublicationPage({
          forInput: input,
          session: current!.session_id,
          cursor: publicationNext,
        }),
    });
  more.push(...evidence.more);
  status.push(...evidence.status);
  report("Interactive reviews", reviews);
  if (reviews.data) status.push(...reviews.data.diagnostics);
  report("Work", work);
  report("Sessions", workers);
  report("Thoughts", notes);
  report("Open GitHub", opened);
  report("Closed GitHub", closed);
  report("Merged GitHub", merged);
  report("Agents", agents);
  report("Repositories", repos);
  report("Workspace", snapshot);
  if (work.data && !work.data.entries.length) status.push("No matching work.");
  if (input !== settled) status.push("Searching…");
  if (active("message")) {
    status.push("Messages cover the observed conversation window.");
    if (history?.loading) status.push("Loading earlier messages…");
    else if (history?.more)
      more.push({
        id: "earlier-messages",
        label: "Search earlier messages",
        keepOpen: true,
        run: history.load,
      });
    else if (!history && current?.older)
      more.push({ id: "earlier-chat", label: "Open Chat for earlier messages", run: chat });
  }
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
  const rank = (h: Hit) =>
    h.identity.toLowerCase() === lower ? 0 : h.label.toLowerCase() === lower ? 1 : 2;
  const [expanded, setExpanded] = useState<Partial<Record<Source, number>>>({});
  const counts = new Map<Source, number>();
  const unique = hits.filter(
    (hit, index) => hits.findIndex((other) => other.id === hit.id) === index,
  );
  const rows = unique
    .filter((h) => {
      if (filter && h.source !== filter) return false;
      if (confirmedPublications.has(h.id)) return true;
      if (!input) return h.source === "page" || h.source === "command";
      if (
        ["work", "thought", "github", "evidence", "memory"].includes(h.source) ||
        (h.source === "session" && h.identity !== current?.session_id)
      )
        return true;
      return [h.identity, h.label, h.detail, ...(h.aliases ?? [])].some((s) =>
        s?.toLowerCase().includes(lower),
      );
    })
    .sort((a, b) => rank(a) - rank(b))
    .filter((h) => {
      const count = counts.get(h.source) ?? 0;
      counts.set(h.source, count + 1);
      return count < (expanded[h.source] ?? (h.source === "evidence" ? 12 : 8));
    })
    .map((h) => ({
      ...h,
      detail: [h.source, h.detail, h.identity, h.effect].filter(Boolean).join(" · "),
    }));
  for (const [source, count] of counts) {
    const limit = expanded[source] ?? (source === "evidence" ? 12 : 8);
    if (count > limit)
      more.unshift({
        id: "more-rows-" + source,
        label: "Show more " + source + " matches",
        keepOpen: true,
        run: () => setExpanded((previous) => ({ ...previous, [source]: limit + 8 })),
      });
  }
  if (input && !rows.length && !status.length) status.push("No matches in the searched sources.");
  function changeSearch(text: string) {
    setValue(text);
    memory.reset();
    evidence.reset();
    setExpanded({});
    setPublicationPage(undefined);
  }
  return (
    <SearchDialog
      origin={origin}
      close={close}
      value={value}
      onValueChange={changeSearch}
      filters={memory.available ? sources : sources.filter((s) => s !== "memory")}
      controls={memory.controls}
      reader={memory.reader}
      filter={filter}
      onFilter={(s) => changeSearch(s ? s + ": " + query : query)}
      commands={memory.reader ? [] : [...rows, ...more]}
      status={memory.reader ? undefined : status.join(" ")}
    />
  );
}
