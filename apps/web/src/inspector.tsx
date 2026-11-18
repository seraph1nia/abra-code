import { RelativePath } from "@abracode/contracts/identities";
import { ReviewsForSource } from "./presentation/interactive-review-loader.tsx";
import { ExportReport } from "./presentation/export-report.tsx";
import { X, ArrowLeft, ArrowUpRight } from "@abracode/presentation/icons";
import { ActivityPanel } from "./presentation/activity.tsx";
import { ReportDocumentView } from "@abracode/presentation/report-document";
import { DecisionsPanel } from "./presentation/obligations.tsx";
import type { AttentionForm } from "@abracode/contracts/web/contracts";
import type { Inspect } from "@abracode/presentation/cards";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4 HTTP atoms provide scoped inspector reads. */
import { lazy, Suspense } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Option } from "effect";
import { IssueId } from "@abracode/contracts/identities";
import { artifactPageSize } from "@abracode/contracts/web/wire";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { WebWorkItem as WorkItem, WorkDetailSchema } from "@abracode/contracts/web/wire";
import { Markdown as DeferredMarkdown } from "./markdown.tsx";
import { api } from "./api.ts";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { OutcomeSummary, Evidence } from "@abracode/presentation/cards";
import { ExecutionContractSummary } from "./presentation/execution-contract.tsx";
import { queries } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { inspectorTabs, type InspectorTab } from "./navigation.ts";
import { useMediaQuery } from "./use-media-query.ts";
import { useTheme } from "./theme.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { Badge } from "@abracode/presentation/ui/badge";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Skeleton } from "@abracode/presentation/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@abracode/presentation/ui/tabs";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@abracode/presentation/ui/sheet";

const DiffRenderer = lazy(() => import("./diff-renderer.tsx"));
function Markdown({ content, className }: { content: string; className?: string }) {
  return <DeferredMarkdown key={content} content={content} className={className} mode="static" />;
}
type Props = {
  work?: WorkItem;
  issue: IssueId;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  close: () => void;
  returnFocus: () => HTMLElement | false;
  forms: readonly AttentionForm[];
  focusForm: (id: string) => void;
  inspect: Inspect;
  ask: (text: string) => void;
};
type ContentProps = Omit<Props, "work" | "issue"> & { work: WorkItem };
export function Inspector(props: Props) {
  const route = useSearch({ from: "/" });
  const canvas = route.canvas === true;
  const overlay = useMediaQuery("(max-width: 1250px)") || canvas;
  const content = props.work ? (
    <InspectorContent {...props} work={props.work} />
  ) : (
    <UnloadedInspector {...props} />
  );
  if (!overlay) return content;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
    >
      <SheetContent
        showCloseButton={false}
        finalFocus={props.returnFocus}
        className={
          canvas
            ? "inspector-sheet report-canvas data-[side=right]:w-screen data-[side=right]:sm:max-w-none gap-0"
            : "inspector-sheet data-[side=right]:w-[min(560px,100vw)] data-[side=right]:sm:max-w-none gap-0"
        }
      >
        <SheetTitle className="sr-only">
          {canvas ? "Report canvas" : "Work inspector"}: {props.work?.title ?? "Selected task"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read-only work details. Instructions go to Abra.
        </SheetDescription>
        {content}
      </SheetContent>
    </Sheet>
  );
}
function UnloadedInspector(props: Props) {
  const query = queries.detail(props.issue);
  const result = useAtomValue(query);
  const detail = AsyncResult.value(result);
  if (Option.isSome(detail)) return <InspectorContent {...props} work={detail.value.work} />;
  return (
    <aside className="inspector" aria-label="Work inspector">
      <header className="inspector-header">
        <h2>Selected task</h2>
        <Button variant="ghost" size="icon" onClick={props.close} aria-label="Close inspector">
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="inspector-content">
        <RequestState query={query}>{() => null}</RequestState>
      </div>
    </aside>
  );
}
function InspectorContent({
  work,
  tab,
  setTab,
  close,
  ask,
  forms,
  focusForm,
  inspect,
}: ContentProps) {
  return (
    <aside className="inspector" aria-label="Work inspector">
      <header className="inspector-header">
        <div>
          <div className="eyebrow">
            {work.repository_id ?? "Work"} · {work.issue_id}
          </div>
          <h2>{work.title}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close inspector">
          <X aria-hidden="true" />
        </Button>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = inspectorTabs.find((tab) => tab === value);
          if (next) setTab(next);
        }}
        className="inspector-tabs"
      >
        <TabsList variant="line" className="tabs" aria-label="Work details">
          {inspectorTabs.map((name) => (
            <TabsTrigger key={name} value={name}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="inspector-content" key={`${work.issue_id}:${tab}`}>
          <InspectorPanel
            work={work}
            tab={tab}
            ask={ask}
            forms={forms}
            focusForm={focusForm}
            inspect={inspect}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
function InspectorPanel({
  work,
  tab,
  ask,
  forms,
  focusForm,
  inspect,
}: Pick<ContentProps, "work" | "tab" | "ask" | "forms" | "focusForm" | "inspect">) {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const file = search.file ?? "";
  const selectFile = (file: string) => {
    void navigate({ search: (previous) => ({ ...previous, file: file || undefined }) });
  };
  switch (tab) {
    case "Overview":
      return (
        <RequestState query={queries.detail(work.issue_id)}>
          {(detail) => (
            <>
              <Overview detail={detail} ask={ask} forms={forms} focusForm={focusForm} />
              <DecisionsPanel issue={work.issue_id} forms={forms} focusForm={focusForm} />
            </>
          )}
        </RequestState>
      );
    case "Plan":
      return file ? (
        <>
          <Button variant="outline" onClick={() => selectFile("")}>
            <ArrowLeft aria-hidden="true" /> All artifacts
          </Button>
          <RequestState query={queries.document(work.issue_id, file)}>
            {(document) => (
              <>
                <Markdown className="prose" content={document.content} />
                <ReviewsForSource
                  issue={work.issue_id}
                  source={{ kind: "plan", path: RelativePath.make(document.path) }}
                />
              </>
            )}
          </RequestState>
        </>
      ) : (
        <RequestState query={queries.detail(work.issue_id)}>
          {(detail) => (
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
              <Markdown
                className="prose"
                content={
                  detail.proposal ??
                  (detail.documents?.length
                    ? "Select a planning artifact to read its retained content."
                    : "Planning documents are unavailable for this task.")
                }
              />
            </>
          )}
        </RequestState>
      );
    case "Diff":
      return <DiffPanel issue={work.issue_id} />;
    case "Activity":
      return <ActivityPanel key={work.issue_id} work={work} inspect={inspect} />;
    case "Reports":
      return <Reports key={work.issue_id} issue={work.issue_id} inspect={inspect} />;
    default:
      tab satisfies never;
  }
}
function Overview({
  detail,
  ask,
  forms,
  focusForm,
}: {
  detail: typeof WorkDetailSchema.Type;
  ask: (text: string) => void;
  forms: readonly AttentionForm[];
  focusForm: (id: string) => void;
}) {
  const work = detail.work;
  return (
    <>
      <div className="detail-status">
        <span className={`status-dot ${work.issue_status}`} />
        {work.phase ? phaseLabel(work.phase) : work.issue_status}
        <Badge variant="secondary">P{work.priority}</Badge>
      </div>
      <p>
        {work.policy === "research-only"
          ? "Research task"
          : work.policy === "lightweight-fix"
            ? "Lightweight fix"
            : work.policy === "full-openspec"
              ? "Full OpenSpec task"
              : "Workflow policy unavailable"}
      </p>
      {forms
        .filter(
          (item) =>
            item.active &&
            item.checkpoint?.active &&
            item.checkpoint.issue_id === work.issue_id &&
            (item.checkpoint.kind === "plan" || item.checkpoint.kind === "merge"),
        )
        .map((item) => (
          <Button key={item.form.id} variant="outline" onClick={() => focusForm(item.form.id)}>
            Review current {item.checkpoint!.kind} approval
          </Button>
        ))}
      <Markdown className="prose" content={detail.description} />
      {work.execution_contract && <ExecutionContractSummary contract={work.execution_contract} />}
      {work.outcome && (
        <section aria-label="Independent work outcomes">
          <h3>Outcomes</h3>
          <OutcomeSummary outcome={work.outcome} />
          <p>{work.outcome.next_action}</p>
          <Evidence>
            {work.outcome.delivered_commit && (
              <p>
                Delivered commit: <code>{work.outcome.delivered_commit}</code>
              </p>
            )}
            {work.outcome.approval.evidence_at && (
              <p>Approval recorded {work.outcome.approval.evidence_at}</p>
            )}
            {work.outcome.delivery.evidence_at && (
              <p>Delivery recorded {work.outcome.delivery.evidence_at}</p>
            )}
            {work.outcome.cleanup.blocker && (
              <>
                <p>Cleanup is blocked by retained local resources.</p>
                <ul>
                  {work.outcome.cleanup.blocker.paths.map((path) => (
                    <li key={path.path}>
                      {path.path} · {path.category}
                    </li>
                  ))}
                </ul>
                {work.outcome.cleanup.blocker.truncated && (
                  <p>More resources exist outside this preview.</p>
                )}
              </>
            )}
          </Evidence>
        </section>
      )}
      {detail.errors.length > 0 && (
        <details>
          <summary>Unavailable planning evidence</summary>
          {detail.errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </details>
      )}
      {work.progress && (
        <section>
          <h3>Latest progress</h3>
          <p>{work.progress.summary}</p>
          <small>{new Date(work.progress.at).toLocaleString()}</small>
        </section>
      )}
      {work.blockers.length > 0 && (
        <section>
          <h3>Readiness</h3>
          <ul>
            {work.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}
      {work.eligibility_observed === false && (
        <p className="muted">
          Readiness to start has not been checked. Ask Abra to assess ready work.
        </p>
      )}
      <div className="button-row">
        {["pause", "resume", "advance"].map((action) => (
          <Button
            variant="outline"
            key={action}
            onClick={() =>
              ask(
                `Request controller action ${action} for ${work.issue_id}. Inspect its current state and use the existing guarded work control.`,
              )
            }
          >
            Ask Abra to {action} work
          </Button>
        ))}
      </div>
      <p className="muted">
        Controls send a request to Abra. The controller validates each transition.
      </p>
    </>
  );
}
function DiffPanel({ issue }: { issue: string }) {
  const search = useSearch({ from: "/" });
  const { resolved } = useTheme();
  return (
    <RequestState query={queries.diff(issue, "", search.scope ?? "all")} showRefresh={false}>
      {(diff) => (
        <Suspense
          fallback={<Skeleton className="h-40 w-full" aria-label="Loading diff renderer" />}
        >
          <DiffRenderer issue={issue} diff={diff} theme={resolved} />
        </Suspense>
      )}
    </RequestState>
  );
}
function Reports({ issue, inspect }: { issue: string; inspect: Inspect }) {
  const route = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const target = route.resource?.action === "open_artifact" ? route.resource : undefined;
  return (
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
                      onClick={() =>
                        inspect({
                          action: "open_artifact",
                          issue_id: IssueId.make(issue),
                          request_id: artifact.request_id,
                          hash: artifact.hash!,
                        })
                      }
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
      {target && <SelectedReport target={target} inspect={inspect} />}
      <h3>Markdown report</h3>
      <RequestState query={queries.report(issue)}>
        {(report) =>
          "content" in report ? (
            <Markdown className="prose" content={report.content} />
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
  );
}
function SelectedReport({
  target,
  inspect,
}: {
  target: Extract<Parameters<Inspect>[0], { action: "open_artifact" }>;
  inspect: Inspect;
}) {
  const route = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
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
