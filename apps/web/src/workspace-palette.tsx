/* oxlint-disable effecttsgo/unstable-api-usage -- Read the same typed discovery and overview atoms as the finder and inspector. */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { SearchDialog, type SearchCommand } from "@abracode/presentation/ui/search-dialog";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { queries } from "./work-data.ts";
import { type WorkspaceSearch } from "./navigation.ts";

export type PaletteActions = {
  origin: HTMLElement;
  close: () => void;
  chat: () => void;
  finder: (query?: string) => void;
};
type Props = PaletteActions & {
  workspace?: WorkspaceSnapshot;
  selected?: string;
  resume?: WorkspaceSearch;
  review?: () => void;
  inspect?: (id: string) => void;
};
const idle = Atom.make(AsyncResult.initial<never, never>());

export default function WorkspacePalette({
  origin,
  close,
  chat,
  finder,
  workspace,
  selected,
  resume,
  review,
  inspect,
}: Props) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const query = value.trim();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const searching = Boolean(query && query === settled);
  const result = useAtomValue(
    searching ? queries.find({ state: "all", search: query, limit: 8 }) : idle,
  );
  const selectedWork = workspace?.work.work.find((task) => task.issue_id === selected);
  const overview = useAtomValue(selected && !selectedWork ? queries.overview(selected) : idle);
  const title =
    selectedWork?.title ??
    (AsyncResult.isSuccess(overview) ? overview.value.work.title : undefined);
  const go = (search: WorkspaceSearch) => void navigate({ to: "/", search });
  const commands: SearchCommand[] = [];
  if (review) commands.push({ id: "review", label: "Review pending decisions", run: review });
  if (resume)
    commands.push({
      id: "resume",
      label: "Resume last inspection",
      detail: resume.file ?? resume.surface?.surface_id ?? resume.issue,
      run: () => go(resume),
    });
  if (selected && title) {
    for (const tab of ["Plan", "Diff", "Verification", "Reports"] as const) {
      commands.push({
        id: tab,
        label: "Open " + tab,
        detail: title,
        run: () => go({ issue: selected, tab }),
      });
    }
  }
  commands.push(
    { id: "chat", label: "Return to chat", run: chat },
    { id: "finder", label: "Open Work finder", run: () => finder() },
    { id: "settings", label: "Open Settings", run: () => void navigate({ to: "/settings" }) },
  );
  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );
  const tasks: SearchCommand[] = [];
  const rows: SearchCommand[] = [];
  let status: string | undefined;
  if (query) {
    if (searching && AsyncResult.isSuccess(result)) {
      for (const task of result.value.entries) {
        const project = workspace?.projects.find(
          (project) => project.id === task.repository_id,
        )?.name;
        const command = {
          id: "task/" + task.issue_id,
          label: task.title,
          detail: [
            project ?? task.repository_id ?? "Unassigned",
            task.issue_status.replaceAll("_", " "),
            task.issue_id,
          ].join(" · "),
          run: () =>
            inspect ? inspect(task.issue_id) : go({ issue: task.issue_id, tab: "Overview" }),
        };
        if (!rows.length && task.issue_id.toLowerCase() === query.toLowerCase()) rows.push(command);
        else tasks.push(command);
      }
      if (!result.value.entries.length) status = "No matching work.";
    } else {
      status =
        searching && AsyncResult.isFailure(result)
          ? "Work search is unavailable."
          : "Searching work…";
    }
  }
  rows.push(...matches, ...tasks);
  if (query) rows.push({ id: "all", label: "See all results in Work", run: () => finder(query) });
  return (
    <SearchDialog
      origin={origin}
      close={close}
      value={value}
      onValueChange={setValue}
      commands={rows}
      status={status}
    />
  );
}
