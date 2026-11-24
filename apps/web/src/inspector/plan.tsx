import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { RelativePath } from "@abracode/contracts/identities";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type { WebWorkItem as WorkItem } from "@abracode/contracts/web/wire";
import { ArrowLeft } from "@abracode/presentation/icons";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Button } from "@abracode/presentation/ui/button";
import { Markdown } from "../markdown.tsx";
import { destinationFor } from "../navigation.ts";
import { ReviewsForSource } from "../presentation/interactive-review-loader.tsx";
import { PlanPassage } from "../presentation/plan-passage.tsx";
import { RequestState } from "../request-state.tsx";
import { queries } from "../work-data.ts";

export function PlanPassagePanel({
  issue,
  target,
}: {
  issue: WorkItem["issue_id"];
  target: Extract<ResourceSelection, { action: "open_passage" }>;
}) {
  return (
    <RequestState query={queries.document(target.issue_id, target.file)}>
      {(document) =>
        target.generation === document.generation &&
        target.hash === document.hash &&
        target.file === document.path &&
        target.end <= document.content.split("\n").length ? (
          <>
            <pre>
              {document.content
                .split("\n")
                .slice(target.start - 1, target.end)
                .join("\n")}
            </pre>
            <PlanPassage issue={issue} document={document} initial={target} />
          </>
        ) : (
          <output>This exact plan passage is unavailable.</output>
        )
      }
    </RequestState>
  );
}

export function PlanPanel({ work }: { work: WorkItem }) {
  const search = useSearch({ from: "__root__" });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate({ from: destinationFor(pathname) ?? "/" });
  const file = search.file ?? "";
  const selectFile = (next: string) => {
    void navigate({ search: (previous) => ({ ...previous, file: next || undefined }) });
  };
  if (file) {
    return (
      <>
        <Button variant="outline" onClick={() => selectFile("")}>
          <ArrowLeft aria-hidden="true" /> All artifacts
        </Button>
        <RequestState query={queries.document(work.issue_id, file)}>
          {(document) => (
            <>
              <Markdown
                key={document.content}
                className="prose"
                content={document.content}
                mode="static"
              />
              <PlanPassage issue={work.issue_id} document={document} />
              <ReviewsForSource
                issue={work.issue_id}
                source={{ kind: "plan", path: RelativePath.make(document.path) }}
              />
            </>
          )}
        </RequestState>
      </>
    );
  }
  return (
    <RequestState query={queries.detail(work.issue_id)}>
      {(detail) => {
        const content =
          detail.proposal ??
          (detail.documents?.length
            ? "Select a planning artifact to read its retained content."
            : "Planning documents are unavailable for this task.");
        return (
          <>
            <h3>
              {work.policy === "research-only"
                ? "Research contract"
                : work.policy === "lightweight-fix"
                  ? "Lightweight scope"
                  : "Planning artifacts"}
            </h3>
            {detail.planning?.source === "archive" && (
              <p className="muted">
                Retained archive at <code>{detail.planning.commit?.slice(0, 12)}</code>
              </p>
            )}
            {detail.planning?.limited && (
              <output>Planning document list is limited to 100 entries.</output>
            )}
            {detail.errors.map((error, index) => (
              <Alert key={index}>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ))}
            {detail.progress &&
              work.policy !== "research-only" &&
              work.policy !== "lightweight-fix" && (
                <p>
                  {detail.progress.complete} of {detail.progress.total} implementation tasks
                  complete
                </p>
              )}
            <ReviewsForSource issue={work.issue_id} source={{ kind: "plan" }} />
            {detail.documents?.map((path) => (
              <Button
                variant="ghost"
                className="document-link"
                key={path}
                onClick={() => selectFile(path)}
              >
                {path}
              </Button>
            ))}
            <Markdown key={content} className="prose" content={content} mode="static" />
          </>
        );
      }}
    </RequestState>
  );
}
