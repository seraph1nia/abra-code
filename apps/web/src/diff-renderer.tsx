import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FileDiff } from "@pierre/diffs/react";
import type { WorkDiffSchema } from "../../../src/web/wire.ts";
import { parseDiffPatch } from "./diff-patch.ts";
import type { WorkspaceSearch } from "./navigation.ts";
import { queries } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { Input } from "./components/ui/input.tsx";
import { Alert, AlertDescription } from "./components/ui/alert.tsx";

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
  const [filter, setFilter] = useState(search.file ?? "");
  useEffect(() => setFilter(search.file ?? ""), [search.file]);
  const needle = filter.trim().toLocaleLowerCase();
  const matches = diff.files.filter((file) => file.path.toLocaleLowerCase().includes(needle));
  const exact =
    diff.files.find((file) => file.path === filter)?.path ??
    (needle && matches.length === 1 ? matches[0]?.path : undefined);
  useEffect(() => {
    if (!exact && needle) return;
    if (search.file === exact) return;
    const timer = setTimeout(() => {
      void navigate({
        replace: true,
        search: (previous: WorkspaceSearch) => {
          const resource =
            previous.resource?.action === "open_changes"
              ? { ...previous.resource, file: exact }
              : previous.resource;
          return { ...previous, file: exact, resource };
        },
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [exact, needle, search.file, navigate]);
  return (
    <div className="space-y-3 min-w-0">
      <Input
        type="search"
        aria-label="Search changes"
        placeholder="Search file names or diff text…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
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
        <Alert role="status">
          <AlertDescription>
            {parsed.error ??
              diff.message ??
              "This comparison exceeds the preview limit. Search by file name for an individual preview."}
          </AlertDescription>
        </Alert>
      )}
      <div className="diff-renderer" data-diff-renderer="pierre">
        {files.map((file, index) => (
          <FileDiff key={`${file.name}:${index}`} fileDiff={file} options={options} />
        ))}
      </div>
      {!files.length && !parsed.error && !diff.message && (
        <p role="status">
          {filter ? "No matching changes in this preview." : "No text changes to show."}
        </p>
      )}
    </>
  );
}
