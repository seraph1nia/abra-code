import { useInspectResource } from "./use-inspect-resource.ts";
import { useDebouncedValue } from "./use-debounced-value.ts";
import { memo, useContext, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { SearchDialog } from "@abracode/presentation/ui/search-dialog";
import type { WorkspaceSnapshot, TranscriptMessage } from "@abracode/contracts/web/contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { usePublicationSource } from "./palette-sources/publications.ts";
import { useCollectionSources } from "./palette-sources/collections.ts";
import { MessageId } from "@abracode/contracts/identities";
import { selectionLabel } from "@abracode/contracts/web/resources";
import { workspaceDraft } from "./workspace-state/draft.ts";
import { EvidenceKind } from "@abracode/contracts/visibility/discovery-contracts";
import { bootstrapQuery, exportDocument } from "./data.ts";
import { queries } from "./work-data.ts";
import { destinations, destinationFor, type WorkspaceSearch } from "./navigation.ts";
import { RunCommand, composerCommands, snippetDraft, workControl } from "./workspace-commands.ts";

import {
  rankPaletteHits,
  useSource,
  sources,
  sourceFeedback,
  type Source,
  paletteHits,
} from "./palette-source.ts";
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
  artifact?: Extract<ResourceSelection, { action: "open_artifact" }>;
  resume?: WorkspaceSearch;
  review?: () => void;
  inspect?: (target: ResourceSelection) => void;
  prepare?: (text: string) => void;
  history?: {
    messages: readonly TranscriptMessage[];
    more: boolean;
    loading: boolean;
    load: () => void;
  };
};
const emptyDraft = Atom.make(undefined);
const idleResult = Atom.make(AsyncResult.initial<never, never>());
function WorkspacePalette({
  origin,
  initialSource,
  close,
  chat,
  finder,
  workspace,
  selected,
  artifact,
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
  const settled = useDebouncedValue(input, 180);
  const explicit = Boolean(filter);
  const remoteReady = Boolean(input) && input === settled && (explicit || query.length >= 2);
  const active = (source: Source) => remoteReady && (!filter || filter === source);
  const activeExplicit = (source: Source) => remoteReady && filter === source;
  const snapshot = useSource(
    !workspace &&
      (activeExplicit("session") ||
        activeExplicit("attention") ||
        activeExplicit("message") ||
        activeExplicit("surface") ||
        activeExplicit("review")),
    () => bootstrapQuery,
  );
  const current = workspace ?? snapshot.data;
  const memory = useMemorySource(active("memory"), filter === "memory", query);
  const draft = useAtomValue(current ? workspaceDraft(current.session_id) : emptyDraft);
  const artifactSummary = useAtomValue(
    artifact
      ? queries.artifactSummary(artifact.issue_id, artifact.request_id, artifact.hash)
      : idleResult,
  );
  const exportState = useAtomValue(
    artifact
      ? exportDocument(`${artifact.issue_id}/${artifact.request_id}/${artifact.hash}`)
      : idleResult,
  );
  const lower = query.toLowerCase();
  const { hits, add } = paletteHits();
  const fallback = useInspectResource();
  const go = inspect ?? fallback.inspect;
  const reader = (search: WorkspaceSearch) =>
    void navigate({
      to: destinationFor(location.pathname) ?? "/",
      search: (previous) => ({ collection: previous.collection, ...search }),
    });
  const evidence = useEvidenceSource(
    activeExplicit("evidence"),
    input,
    query,
    evidenceKind,
    go,
    reader,
  );
  const publications = usePublicationSource(input, query, filter, activeExplicit, current, reader);
  const collections = useCollectionSources({
    query,
    active,
    activeExplicit,
    current,
    chat,
    finder,
    go,
  });
  hits.push(...evidence.hits, ...publications.hits, ...collections.hits);
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
  const canExportReport =
    Boolean(artifact) &&
    AsyncResult.isSuccess(artifactSummary) &&
    artifactSummary.value.hash === artifact?.hash &&
    artifactSummary.value.format === "a2ui-snapshot" &&
    !exportState.waiting;
  if (canExportReport && artifact)
    add(
      "command",
      "export-report",
      "Open report export controls",
      artifact.issue_id,
      "Open",
      () =>
        requestAnimationFrame(() => {
          document.getElementById("export-report-" + artifact.issue_id)?.focus();
        }),
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
  for (const m of history?.messages ?? [])
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
  more.push(...memory.more, ...publications.more, ...collections.more);
  status.push(...memory.status, ...publications.status, ...collections.status);
  more.push(...evidence.more);
  status.push(...evidence.status);
  report("Workspace", snapshot);
  if (input !== settled && (explicit || query.length >= 2)) status.push("Searching…");
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
  const [expanded, setExpanded] = useState<Partial<Record<Source, number>>>({});
  const { rows, counts } = rankPaletteHits(
    hits,
    filter,
    publications.confirmedPublications,
    input,
    lower,
    expanded,
    current?.session_id,
  );
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
    publications.reset();
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

export default memo(WorkspacePalette);
