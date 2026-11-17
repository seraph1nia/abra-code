import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FileDiff } from "@pierre/diffs/react";
import type { WorkDiffSchema } from "@abracode/contracts/web/wire";
import { parseDiffPatch } from "./diff-patch.ts";
import type { WorkspaceSearch } from "./navigation.ts";
import { queries } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { Input } from "@abracode/presentation/ui/input";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";

type Diff = typeof WorkDiffSchema.Type;

export default function DiffRenderer({
  issue,
  diff,
  theme,
}: {
  issue: string;
  diff: Diff;
  theme: "light" | "dark";
}) {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const routeKey = JSON.stringify([issue, search.file, search.scope]);
  const [edit, setEdit] = useState({ routeKey, text: search.file ?? "" });
  const filter = edit.routeKey === routeKey ? edit.text : (search.file ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), [routeKey]);
  const needle = filter.trim().toLocaleLowerCase();
  const matches = diff.files.filter((file) => file.path.toLocaleLowerCase().includes(needle));
  const exact =
    diff.files.find((file) => file.path === filter)?.path ??
    (needle && matches.length === 1 ? matches[0]?.path : undefined);
  function changeFilter(text: string) {
    setEdit({ routeKey, text });
    clearTimeout(timer.current);
    const query = text.trim().toLocaleLowerCase();
    const matched = diff.files.filter((file) => file.path.toLocaleLowerCase().includes(query));
    const selected =
      diff.files.find((file) => file.path === text)?.path ??
      (query && matched.length === 1 ? matched[0]?.path : undefined);
    if ((!selected && query) || selected === search.file) return;
    const address = window.location.href;
    timer.current = setTimeout(() => {
      if (window.location.href !== address) return;
      setEdit({ routeKey: JSON.stringify([issue, selected, search.scope]), text });
      void navigate({
        replace: true,
        search: (previous: WorkspaceSearch) => {
          const resource =
            previous.resource?.action === "open_changes"
              ? { ...previous.resource, file: selected }
              : previous.resource;
          return { ...previous, file: selected, resource };
        },
      });
    }, 200);
  }
  return (
    <div className="space-y-3 min-w-0">
      <Input
        type="search"
        aria-label="Search changes"
        placeholder="Search file names or diff text…"
        value={filter}
        onChange={(event) => changeFilter(event.target.value)}
      />
      {exact ? (
        <RequestState query={queries.diff(issue, exact, search.scope ?? "all")} showRefresh={false}>
          {(selected) => <DiffFiles diff={selected} filter="" theme={theme} />}
        </RequestState>
      ) : (
        <DiffFiles diff={diff} filter={needle} theme={theme} />
      )}
    </div>
  );
}

function DiffFiles({
  diff,
  filter,
  theme,
}: {
  diff: Diff;
  filter: string;
  theme: "light" | "dark";
}) {
  const parsed = useMemo(() => {
    if (!diff.patch) return { files: [] };
    try {
      return { files: parseDiffPatch(diff.patch) };
    } catch {
      return { files: [], error: "This patch could not be rendered." };
    }
  }, [diff.patch]);
  const options = useMemo(
    () => ({
      diffStyle: "split" as const,
      theme: { light: "github-light", dark: "github-dark" },
      themeType: theme,
      overflow: "scroll" as const,
    }),
    [theme],
  );
  const files = parsed.files.filter(
    (file) =>
      !filter ||
      [file.name, file.prevName, ...file.additionLines, ...file.deletionLines].some((text) =>
        text?.toLocaleLowerCase().includes(filter),
      ),
  );
  return (
    <>
      {(parsed.error || diff.message || diff.limited) && (
        /* oxlint-disable jsx-a11y/prefer-tag-over-role -- Shared Alert retains its block content and polite status semantics. */
        <Alert role="status">
          <AlertDescription>
            {parsed.error ??
              diff.message ??
              "This comparison exceeds the preview limit. Search by file name for an individual preview."}
          </AlertDescription>
        </Alert>
        /* oxlint-enable jsx-a11y/prefer-tag-over-role */
      )}
      <div className="diff-renderer" data-diff-renderer="pierre">
        {files.map((file, index) => (
          <FileDiff key={`${file.name}:${index}`} fileDiff={file} options={options} />
        ))}
      </div>
      {!files.length && !parsed.error && !diff.message && (
        <output>
          {filter ? "No matching changes in this preview." : "No text changes to show."}
        </output>
      )}
    </>
  );
}
