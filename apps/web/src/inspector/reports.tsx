import { useState } from "react";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { IssueId } from "@abracode/contracts/identities";
import { artifactPageSize } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { ArrowUpRight } from "@abracode/presentation/icons";
import { ReportDocumentView } from "@abracode/presentation/report-document";
import { Button } from "@abracode/presentation/ui/button";
import { api } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { destinationFor } from "../navigation.ts";
import { ExportReport } from "../presentation/export-report.tsx";
import { ReviewsForSource } from "../presentation/interactive-review-loader.tsx";
import { RequestState } from "../request-state.tsx";
import { queries } from "../work-data.ts";

export function Reports({ issue, inspect }: { issue: string; inspect: Inspect }) {
  const route = useSearch({ from: "__root__" });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate({ from: destinationFor(pathname) ?? "/" });
  const target = route.resource?.action === "open_artifact" ? route.resource : undefined;
  const targetKey = target ? `${target.issue_id}:${target.request_id}:${target.hash}` : "";
  const [otherReportsFor, setOtherReportsFor] = useState<string>();
  const otherReports = otherReportsFor === targetKey;
  return (
    <>
      {target && (
        <>
          <SelectedReport target={target} inspect={inspect} />
          <Button
            variant="outline"
            aria-expanded={otherReports}
            onClick={() => setOtherReportsFor(otherReports ? undefined : targetKey)}
          >
            Other reports
          </Button>
        </>
      )}
      {(!target || otherReports) && (
        <>
          <div className="eyebrow">Retained reports</div>
          {!target && <ReviewsForSource issue={issue} source={{ kind: "report" }} />}
          <RequestState query={queries.artifacts(issue, route.artifact_offset ?? 0)}>
            {(page) => (
              <>
                <p>
                  {page.total !== undefined
                    ? `${page.total} retained reports`
                    : `${page.artifacts.length} reports in this observation`}
                </p>
                {page.artifacts.map((artifact) => (
                  <section key={artifact.request_id} className="report-revision">
                    <strong>{artifact.title ?? artifact.request_id}</strong>
                    <p className="muted">
                      {artifact.format === "a2ui-snapshot" ? "JSON snapshot" : "Retained HTML"} ·{" "}
                      {artifact.status}
                    </p>
                    {artifact.status === "published" && artifact.hash ? (
                      <div className="button-row">
                        <Button
                          variant="outline"
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
                          href={
                            artifact.format === "a2ui-snapshot"
                              ? api.documentURL(issue, artifact.request_id, artifact.hash)
                              : api.reportURL(issue, artifact.request_id, true)
                          }
                          download
                        >
                          {artifact.format === "a2ui-snapshot" ? "Download JSON" : "Download HTML"}{" "}
                          <ArrowUpRight aria-hidden="true" />
                        </a>
                      </div>
                    ) : (
                      <p>{artifact.error ?? "Report is not published yet."}</p>
                    )}
                  </section>
                ))}
                <nav aria-label="Report pages" className="button-row">
                  <Button
                    variant="outline"
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
                    disabled={page.next_offset === undefined}
                    onClick={() => {
                      if (page.next_offset !== undefined)
                        void navigate({ search: { ...route, artifact_offset: page.next_offset } });
                    }}
                  >
                    Next reports
                  </Button>
                </nav>
              </>
            )}
          </RequestState>

          <h3>Markdown report</h3>
          <RequestState query={queries.report(issue)}>
            {(report) =>
              "content" in report ? (
                <Markdown
                  key={report.content}
                  className="prose"
                  content={report.content}
                  mode="static"
                />
              ) : (
                <output className="block">
                  {report.unavailable === "not_started"
                    ? "No Markdown report is available because this task has not started."
                    : "No Markdown report has been published for this task."}
                </output>
              )
            }
          </RequestState>
        </>
      )}
    </>
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate({ from: destinationFor(pathname) ?? "/" });
  return (
    <RequestState query={queries.artifactSummary(target.issue_id, target.request_id, target.hash)}>
      {(selected) =>
        selected.hash !== target.hash ? (
          <output>This exact artifact revision is unavailable.</output>
        ) : (
          <>
            <Button
              variant="outline"
              data-report-expand
              onClick={() => {
                void navigate({ search: { ...route, canvas: !route.canvas || undefined } });
              }}
            >
              {route.canvas ? "Return to inspector" : "Expand report"}
            </Button>
            <a
              href={
                selected.format === "a2ui-snapshot"
                  ? api.documentURL(target.issue_id, target.request_id, target.hash)
                  : api.reportURL(target.issue_id, target.request_id, true)
              }
              download
            >
              {selected.format === "a2ui-snapshot"
                ? "Download selected JSON"
                : "Download selected HTML"}{" "}
              <ArrowUpRight aria-hidden="true" />
            </a>
            {selected.format === "a2ui-snapshot" && (
              <ExportReport
                key={target.hash}
                issue={target.issue_id}
                request={target.request_id}
                hash={target.hash}
              />
            )}
            <ReviewsForSource
              issue={target.issue_id}
              source={{ kind: "report", request_id: target.request_id, hash: target.hash }}
            />
            {selected.format === "a2ui-snapshot" ? (
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
            ) : (
              <iframe
                className="report-preview"
                title="Isolated retained visual report"
                sandbox="allow-scripts"
                src={api.reportURL(target.issue_id, target.request_id)}
              />
            )}
          </>
        )
      }
    </RequestState>
  );
}
