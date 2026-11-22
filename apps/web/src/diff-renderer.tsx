import { destinationFor } from "./navigation.ts";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { SelectedLineRange, FileDiffMetadata } from "@pierre/diffs";
import { IssueId } from "@abracode/contracts/identities";
import { AskAbra } from "./presentation/ask-abra.tsx";
import { FileDiff } from "@pierre/diffs/react";
import type { WorkDiffSchema } from "@abracode/contracts/web/wire";
import { parseDiffPatch } from "./diff-patch.ts";
import type { WorkspaceSearch } from "./navigation.ts";
import { queries } from "./work-data.ts";
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
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate({ from: destinationFor(location.pathname) ?? "/" });
  const routeKey = JSON.stringify([issue, search.file, search.scope]);
  const [edit, setEdit] = useState({ routeKey, text: search.file ?? "" });
  const filter = edit.routeKey === routeKey ? edit.text : (search.file ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), [routeKey]);
  const needle = filter.trim().toLocaleLowerCase();
  const matches = diff.files.filter((file) => file.path.toLocaleLowerCase().includes(needle));
  const exact =
    diff.files.find((file) => file.path === filter)?.path ??
    (filter !== search.file && needle && matches.length === 1 ? matches[0]?.path : undefined);
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
              ? {
                  action: "open_changes" as const,
                  issue_id: previous.resource.issue_id,
                  scope: previous.resource.scope,
                  file: selected,
                }
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
      {search.file && filter === search.file && !exact ? (
        <output>This changed file is unavailable.</output>
      ) : exact ? (
        <RequestState query={queries.diff(issue, exact, search.scope ?? "all")} showRefresh={false}>
          {(selected) =>
            search.resource?.action === "open_changes" &&
            search.resource.head &&
            selected.head !== search.resource.head ? (
              <output>This file is unavailable at the reported revision.</output>
            ) : (
              <DiffFiles
                issue={issue}
                scope={search.scope ?? "all"}
                diff={selected}
                filter=""
                theme={theme}
              />
            )
          }
        </RequestState>
      ) : (
        <DiffFiles
          issue={issue}
          scope={search.scope ?? "all"}
          diff={diff}
          filter={needle}
          theme={theme}
        />
      )}
    </div>
  );
}

function DiffFiles({
  issue,
  scope,
  diff,
  filter,
  theme,
}: {
  diff: Diff;
  issue: string;
  scope: "all" | "uncommitted";
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
        {files.map((file) => {
          const entry = diff.files.find(
            (item) => item.path === file.name || item.path === file.prevName,
          );
          return entry?.patch_id ? (
            <SelectableFile
              key={entry.patch_id}
              file={file}
              entry={entry}
              patchId={entry.patch_id}
              issue={issue}
              scope={scope}
              options={options}
            />
          ) : (
            <FileDiff key={file.name} fileDiff={file} options={options} />
          );
        })}
      </div>
      {!files.length && !parsed.error && !diff.message && (
        <output>
          {filter ? "No matching changes in this preview." : "No text changes to show."}
        </output>
      )}
    </>
  );
}

function SelectableFile({
  file,
  entry,
  patchId,
  issue,
  scope,
  options,
}: {
  file: FileDiffMetadata;
  entry: Diff["files"][number];
  patchId: NonNullable<Diff["files"][number]["patch_id"]>;
  issue: string;
  scope: "all" | "uncommitted";
  options: NonNullable<React.ComponentProps<typeof FileDiff>["options"]>;
}) {
  const [range, setRange] = useState<SelectedLineRange | null>(null);
  const side = range?.side ?? (entry.additions ? "additions" : "deletions");
  const initial =
    (side === "additions" ? file.hunks[0]?.additionStart : file.hunks[0]?.deletionStart) ?? 1;
  const start = Math.min(range?.start ?? initial, range?.end ?? initial);
  const end = Math.max(range?.start ?? initial, range?.end ?? initial);
  const added = side === "additions";
  const hunk = file.hunks.find((h) => {
    const first = added ? h.additionStart : h.deletionStart;
    return start >= first && end < first + (added ? h.additionCount : h.deletionCount);
  });
  const offset =
    hunk &&
    (added
      ? hunk.additionLineIndex - hunk.additionStart
      : hunk.deletionLineIndex - hunk.deletionStart);
  const excerpt =
    offset === undefined
      ? undefined
      : (added ? file.additionLines : file.deletionLines)
          .slice(start + offset, end + offset + 1)
          .join("")
          .replace(/\n$/, "");
  const valid =
    (!range?.endSide || range.endSide === side) && excerpt !== undefined && excerpt.length <= 8192;
  return (
    <section aria-label={file.name}>
      <FileDiff
        fileDiff={file}
        options={{ ...options, enableLineSelection: true, onLineSelected: setRange }}
      />
      <details open={range ? true : undefined}>
        <summary>Select lines in {file.name}</summary>
        <label>
          Side{" "}
          <NativeSelect
            value={side}
            onChange={(e) =>
              setRange({
                start,
                end,
                side: e.target.value === "deletions" ? "deletions" : "additions",
              })
            }
          >
            <option value="additions">New</option>
            <option value="deletions">Old</option>
          </NativeSelect>
        </label>
        <label>
          First line{" "}
          <Input
            type="number"
            min="1"
            value={Number.isNaN(range?.start) ? "" : (range?.start ?? initial)}
            onChange={(e) =>
              setRange({
                side,
                start: e.target.valueAsNumber,
                end: range?.end ?? e.target.valueAsNumber,
              })
            }
          />
        </label>
        <label>
          Last line{" "}
          <Input
            type="number"
            min="1"
            value={Number.isNaN(range?.end) ? "" : (range?.end ?? initial)}
            onChange={(e) =>
              setRange({
                side,
                start: range?.start ?? e.target.valueAsNumber,
                end: e.target.valueAsNumber,
              })
            }
          />
        </label>
        <AskAbra
          selection={{
            kind: "diff",
            issue_id: IssueId.make(issue),
            file: entry.path,
            patch_id: patchId,
            scope,
            start,
            end,
            side,
          }}
          excerpt={excerpt ?? ""}
          disabled={!valid}
        />
      </details>
    </section>
  );
}
