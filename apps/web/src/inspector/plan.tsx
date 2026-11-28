import { deferred } from "@abracode/presentation/deferred";
import type { Inspect } from "@abracode/presentation/cards";
import type { ComponentProps } from "react";
const ProposalReviewsPanel = deferred<
  ComponentProps<typeof import("./proposal-reviews.tsx").ProposalReviewsPanel>
>(
  () => import("./proposal-reviews.tsx").then((m) => ({ default: m.ProposalReviewsPanel })),
  "Independent review",
);
import { PlanBriefView } from "./plan-brief.tsx";
import { useState } from "react";
import { useWorkspaceNavigate } from "../use-workspace-navigate.ts";
import { useSearch } from "@tanstack/react-router";
import { RelativePath } from "@abracode/contracts/identities";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type { WebWorkItem as WorkItem } from "@abracode/contracts/web/wire";
import { ArrowLeft, FileText } from "@abracode/presentation/icons";
import { SectionCard, StatusBadge } from "@abracode/presentation/cockpit";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Button } from "@abracode/presentation/ui/button";
import { Markdown } from "../markdown.tsx";
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
          <SectionCard title={`${target.file} · lines ${target.start}–${target.end}`}>
            <pre className="report-code">
              {document.content
                .split("\n")
                .slice(target.start - 1, target.end)
                .join("\n")}
            </pre>
            <PlanPassage issue={issue} document={document} initial={target} />
          </SectionCard>
        ) : (
          <output>This exact plan passage is unavailable.</output>
        )
      }
    </RequestState>
  );
}

export function PlanPanel({ work, inspect }: { work: WorkItem; inspect: Inspect }) {
  const search = useSearch({ from: "__root__" });
  const navigate = useWorkspaceNavigate();
  const file = search.file ?? "";
  const [sourcesOpen, setSourcesOpen] = useState(Boolean(file));
  const selectFile = (next: string, line?: number) => {
    void navigate({ search: (previous) => ({ ...previous, file: next || undefined, line }) });
  };
  if (file) {
    return (
      <div className="inspector-stack">
        <div className="plan-toolbar">
          <Button variant="outline" size="sm" onClick={() => selectFile("")}>
            <ArrowLeft aria-hidden="true" /> All artifacts
          </Button>
          <StatusBadge tone="neutral">{file}</StatusBadge>
        </div>
        <RequestState query={queries.document(work.issue_id, file)}>
          {(document) => (
            <div className="inspector-stack">
              {search.line && (
                <SectionCard title={document.path + " · line " + search.line}>
                  <pre className="report-code">
                    {document.content.split("\n")[search.line - 1] ?? "Source line unavailable"}
                  </pre>
                </SectionCard>
              )}
              <SectionCard title={document.path} icon={<FileText aria-hidden="true" />}>
                <Markdown className="prose" content={document.content} mode="static" />
              </SectionCard>
              <PlanPassage issue={work.issue_id} document={document} />
              <ReviewsForSource
                issue={work.issue_id}
                source={{ kind: "plan", path: RelativePath.make(document.path) }}
              />
            </div>
          )}
        </RequestState>
      </div>
    );
  }
  return (
    <RequestState query={queries.detail(work.issue_id)}>
      {(detail) => {
        const heading =
          work.policy === "research-only"
            ? "Research contract"
            : work.policy === "lightweight-fix"
              ? "Lightweight scope"
              : detail.plan_brief
                ? "Plan"
                : "Planning artifacts";
        const content =
          detail.proposal ??
          (detail.documents?.length
            ? "Select a planning artifact to read its retained content."
            : "Planning documents are unavailable for this task.");
        return (
          <div className="inspector-stack">
            <SectionCard
              title={heading}
              icon={<FileText aria-hidden="true" />}
              actions={
                detail.progress &&
                work.policy !== "research-only" &&
                work.policy !== "lightweight-fix" ? (
                  <StatusBadge
                    tone={
                      detail.progress.complete === detail.progress.total &&
                      detail.progress.total > 0
                        ? "success"
                        : "running"
                    }
                  >
                    {detail.progress.complete} of {detail.progress.total} implementation tasks
                    complete
                  </StatusBadge>
                ) : undefined
              }
            >
              {work.outcome?.approval.kind === "plan" && (
                <p className="plan-approval-state">
                  Plan approval · {work.outcome.approval.state.replaceAll("_", " ")}
                </p>
              )}
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
              {!!detail.proposal_reviews?.length && (
                <ProposalReviewsPanel
                  reviews={detail.proposal_reviews}
                  work={work}
                  inspect={inspect}
                />
              )}
              {detail.plan_brief && <PlanBriefView brief={detail.plan_brief} />}
              {detail.steps && (
                <section aria-label="Implementation steps">
                  <details>
                    <summary>
                      Implementation steps · {detail.steps.complete} of {detail.steps.total}{" "}
                      complete
                    </summary>

                    {detail.steps.total > 0 && (
                      <progress
                        className="plan-progress"
                        aria-label="Implementation progress"
                        max={detail.steps.total}
                        value={detail.steps.complete}
                      />
                    )}
                    <ol className="plan-steps">
                      {detail.steps.rows.map((row) => (
                        <li key={row.id} data-complete={row.done}>
                          <span aria-label={row.done ? "Complete" : "Open"}>
                            {row.done ? "✓" : "○"}
                          </span>{" "}
                          <span>{row.label}</span>
                          {row.source && detail.documents?.includes(row.source.path) && (
                            <Button
                              size="sm"
                              variant="link"
                              onClick={() => selectFile(row.source!.path, row.source!.line)}
                            >
                              {row.source.path} · {row.source.line}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ol>
                    {detail.steps.rows.length < detail.steps.total && (
                      <p>Showing the first {detail.steps.rows.length} steps.</p>
                    )}
                  </details>
                </section>
              )}
              {detail.documents && detail.documents.length > 0 && (
                <details
                  open={sourcesOpen}
                  onToggle={(event) => setSourcesOpen(event.currentTarget.open)}
                >
                  <summary>Planning sources</summary>
                  <div className="document-pills">
                    {detail.documents.map((path) => (
                      <Button
                        variant="outline"
                        size="sm"
                        className="document-link"
                        key={path}
                        onClick={() => selectFile(path)}
                      >
                        <FileText aria-hidden="true" />
                        {path}
                      </Button>
                    ))}
                  </div>
                </details>
              )}
              {(detail.steps || detail.plan_brief) && detail.proposal ? (
                <details className="accepted-proposal">
                  <summary>Proposal and scope choices</summary>
                  <Markdown className="prose" content={content} mode="static" />
                </details>
              ) : (
                <Markdown className="prose" content={content} mode="static" />
              )}
            </SectionCard>
            <ReviewsForSource issue={work.issue_id} source={{ kind: "plan" }} />
          </div>
        );
      }}
    </RequestState>
  );
}
