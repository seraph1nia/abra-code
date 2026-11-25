import { deferred } from "@abracode/presentation/deferred";
import { useSearch } from "@tanstack/react-router";
import { Skeleton } from "@abracode/presentation/ui/skeleton";
import { RequestState } from "../request-state.tsx";
import { useTheme } from "../theme.tsx";
import { queries } from "../work-data.ts";

const DiffRenderer = deferred(
  () => import("../diff-renderer.tsx"),
  "Diff renderer",
  undefined,
  undefined,
  () => <Skeleton className="h-40 w-full" aria-label="Loading diff renderer" />,
);

export function DiffPanel({ issue }: { issue: string }) {
  const search = useSearch({ from: "__root__" });
  const { resolved } = useTheme();
  return (
    <RequestState query={queries.diff(issue, "", search.scope ?? "all")} showRefresh={false}>
      {(diff) =>
        search.resource?.action === "open_changes" &&
        search.resource.head &&
        (diff.head !== search.resource.head ||
          !diff.files.some((file) => file.path === search.file)) ? (
          <output>This file is unavailable at the reported revision.</output>
        ) : (
          <DiffRenderer issue={issue} diff={diff} theme={resolved} />
        )
      }
    </RequestState>
  );
}
