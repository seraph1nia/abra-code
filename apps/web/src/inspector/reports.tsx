import { useWorkspaceNavigate } from "../use-workspace-navigate.ts";
import { useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { IssueId } from "@abracode/contracts/identities";
import { artifactPageSize } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { SectionCard, StatusBadge, statusTone } from "@abracode/presentation/cockpit";
import { ArrowUpRight, BarChart3, FileText } from "@abracode/presentation/icons";
import { ReportDocumentView } from "@abracode/presentation/report-document";
import { Button } from "@abracode/presentation/ui/button";
import { api } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { ExportReport } from "../presentation/export-report.tsx";
import { ReviewsForSource } from "../presentation/interactive-review-loader.tsx";
import { RequestState } from "../request-state.tsx";
import { queries } from "../work-data.ts";

export function Reports({ issue, inspect }: { issue: string; inspect: Inspect }) {
  const route = useSearch({ from: "__root__" });
  const navigate = useWorkspaceNavigate();
  const target = route.resource?.action === "open_artifact" ? route.resource : undefined;
  const targetKey = target ? `${target.issue_id}:${target.request_id}:${target.hash}` : "";
  const [otherReportsFor, setOtherReportsFor] = useState<string>();
  const otherReports = otherReportsFor === targetKey;
  return (
    <div className="inspector-stack">
      {target && (
        <>
          <SelectedReport target={target} inspect={inspect} />
          <div className="button-row" style={{ margin: 0 }}>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={otherReports}
              onClick={() => setOtherReportsFor(otherReports ? undefined : targetKey)}
            >
              Other reports
            </Button>
          </div>
        </>
      )}
      {(!target || otherReports) && (
        <>
          <SectionCard title="Retained reports" icon={<BarChart3 aria-hidden="true" />}>
            {!target && <ReviewsForSource issue={issue} source={{ kind: "report" }} />}
            <RequestState query={queries.artifacts(issue, route.artifact_offset ?? 0)}>
              {(page) => (
                <>
                  <p className="muted">
                    {page.total !== undefined
                      ? `${page.total} retained reports`
                      : `${page.artifacts.length} reports in this observation`}
                  </p>
                  <div className="report-revision-list">
                    {page.artifacts.map((artifact) => (
                      <section key={artifact.request_id} className="report-revision">
                        <div className="report-revision-head">
                          <strong>{artifact.title ?? artifact.request_id}</strong>
                          <StatusBadge tone={statusTone(artifact.status)}>
                            {artifact.status}
                          </StatusBadge>
                        </div>
                        <p className="muted">JSON snapshot</p>
                        {artifact.status === "published" && artifact.hash ? (
                          <div className="button-row">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setOtherReportsFor(undefined);
                                inspect({
                                  action: "open_artifact",
                                  issue_id: IssueId.make(issue),
                                  request_id: artifact.request_id,
                                  hash: artifact.hash!,
                                });
                              }}
                            >
                              Preview
                            </Button>
                            <a
                              className="report-download-link"
                              href={api.documentURL(issue, artifact.request_id, artifact.hash)}
                              download
                            >
                              Download JSON <ArrowUpRight aria-hidden="true" />
                            </a>
                          </div>
                        ) : (
                          <p className="muted">
                            {artifact.error ?? "Report is not published yet."}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                  <nav aria-label="Report pages" className="button-row">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!(page.offset ?? 0)}
                      onClick={() => {
                        void navigate({
                          search: {
                            ...route,
                            artifact_offset: Math.max(
                              0,
                              (page.offset ?? 0) - (page.limit ?? artifactPageSize),
                            ),
                          },
                        });
                      }}
                    >
                      Previous reports
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page.next_offset === undefined}
                      onClick={() => {
                        if (page.next_offset !== undefined)
                          void navigate({
                            search: { ...route, artifact_offset: page.next_offset },
                          });
                      }}
                    >
                      Next reports
                    </Button>
                  </nav>
                </>
              )}
            </RequestState>
          </SectionCard>

          <SectionCard title="Markdown report" icon={<FileText aria-hidden="true" />}>
            <RequestState query={queries.report(issue)}>
              {(report) =>
                "content" in report ? (
                  <Markdown className="prose" content={report.content} mode="static" />
                ) : (
                  <output className="muted block">
                    {report.unavailable === "not_started"
                      ? "No Markdown report is available because this task has not started."
                      : "No Markdown report has been published for this task."}
                  </output>
                )
              }
            </RequestState>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function SelectedReport({
  target,
  inspect,
}: {
  target: Extract<Parameters<Inspect>[0], { action: "open_artifact" }>;
  inspect: Inspect;
}) {
  const route = useSearch({ from: "__root__" });
  const navigate = useWorkspaceNavigate();
  return (
    <RequestState query={queries.artifactSummary(target.issue_id, target.request_id, target.hash)}>
      {(selected) =>
        selected.hash !== target.hash ? (
          <output>This exact artifact revision is unavailable.</output>
        ) : (
          <div className="inspector-stack">
            <SectionCard
              title={selected.title ?? target.request_id}
              actions={
                <div className="button-row" style={{ margin: 0 }}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-report-expand
                    onClick={() => {
                      void navigate({ search: { ...route, canvas: !route.canvas || undefined } });
                    }}
                  >
                    {route.canvas ? "Return to inspector" : "Expand report"}
                  </Button>
                  <a
                    className="report-download-link"
                    href={api.documentURL(target.issue_id, target.request_id, target.hash)}
                    download
                  >
                    Download selected JSON <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              }
            >
              <ExportReport
                key={target.hash}
                issue={target.issue_id}
                request={target.request_id}
                hash={target.hash}
              />
              <ReviewsForSource
                issue={target.issue_id}
                source={{ kind: "report", request_id: target.request_id, hash: target.hash }}
              />

              <RequestState
                live={false}
                query={queries.artifactDocument(target.issue_id, target.request_id, target.hash)}
              >
                {(artifact) =>
                  artifact.hash === target.hash ? (
                    <ReportDocumentView artifact={artifact} inspect={inspect} />
                  ) : (
                    <output>The document does not match the selected artifact hash.</output>
                  )
                }
              </RequestState>
            </SectionCard>
          </div>
        )
      }
    </RequestState>
  );
}
