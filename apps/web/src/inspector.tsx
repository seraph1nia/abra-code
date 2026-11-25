/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4 HTTP atoms provide scoped inspector reads. */
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Option } from "effect";
import { useSearch } from "@tanstack/react-router";
import type { IssueId } from "@abracode/contracts/identities";
import type { AttentionForm } from "@abracode/contracts/web/contracts";
import type { WebWorkItem as WorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { StatusBadge } from "@abracode/presentation/cockpit";
import {
  X,
  LayoutGrid,
  FileText,
  FileDiff,
  ShieldCheck,
  Activity,
  BarChart3,
  AlertTriangle,
} from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@abracode/presentation/ui/tabs";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@abracode/presentation/ui/sheet";
import { WorkspaceApi } from "./data.ts";
import { SearchTrigger } from "./search-trigger.tsx";
import { RefreshCanvas, CanvasRefreshProvider, useCanvasRead } from "./canvas-refresh.tsx";
import { ExactSurface } from "./presentation/attachments.tsx";
import { SelectedFinding } from "./presentation/finding.tsx";
import { RetainedAsset, VerificationPanel } from "./presentation/verification.tsx";
import { ReviewsForSource } from "./presentation/interactive-review-loader.tsx";
import { DecisionsPanel } from "./presentation/obligations.tsx";
import { NativeForm } from "./native-attention.tsx";
import { queries } from "./work-data.ts";
import { RequestState } from "./request-state.tsx";
import { inspectorTabs, type InspectorTab, type WorkspaceSearch } from "./navigation.ts";
import { useMediaQuery } from "./use-media-query.ts";
import { Overview } from "./inspector/overview.tsx";
import { PlanPanel, PlanPassagePanel } from "./inspector/plan.tsx";
import { DiffPanel } from "./inspector/diff.tsx";
import { ActivityPanel } from "./inspector/activity.tsx";
import { Reports } from "./inspector/reports.tsx";

const tabIcons = {
  Overview: LayoutGrid,
  Plan: FileText,
  Diff: FileDiff,
  Verification: ShieldCheck,
  Activity,
  Reports: BarChart3,
} as const;

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
  refresh?: () => void;
};
type ContentProps = Omit<Props, "work" | "issue"> & { work: WorkItem };

export function Inspector(
  props: Omit<Props, "issue"> & {
    picker?: React.ReactNode;
    issue?: IssueId;
    surface?: WorkspaceSearch["surface"];
    retained?: WorkspaceSearch["retained"];
    review?: WorkspaceSearch["review"];
  },
) {
  const route = useSearch({ from: "__root__" });
  const canvas = route.canvas === true;
  const overlay = useMediaQuery("(max-width: 1250px)") || canvas;
  const phone = useMediaQuery("(max-width: 760px)");
  const retained = props.retained;
  const content =
    retained || props.review ? (
      <aside className="inspector" aria-label="Work inspector">
        <header className="inspector-header">
          <div className="canvas-heading">
            <h2>{retained ? "Selected " + retained.kind : "Interactive review"}</h2>
          </div>
          <div className="inspector-controls">
            <CanvasControls {...props} />
          </div>
        </header>
        <div className="inspector-content">
          {retained ? (
            <RequestState
              query={WorkspaceApi.query("work", "evidenceSearch", {
                query: retained,
                timeToLive: "0 seconds",
              })}
            >
              {(page) => {
                const hit = page.entries.find(
                  (row) =>
                    row.identity === retained.identity &&
                    row.kind === retained.kind &&
                    row.issue_id === retained.issue_id &&
                    row.repository_id === retained.repository_id,
                );
                if (!hit)
                  return (
                    <output>This evidence is no longer available at the selected identity.</output>
                  );
                return (
                  <article className="section-card">
                    <div className="section-card-head">
                      <h3 className="section-card-title">{hit.label}</h3>
                      <StatusBadge tone="neutral">{hit.kind}</StatusBadge>
                    </div>
                    <div className="section-card-body">
                      <p>{hit.context}</p>
                      {hit.asset && <RetainedAsset receipt={hit.asset} />}
                      <small className="muted">
                        {hit.repository_id} · <code>{hit.identity}</code>
                      </small>
                      {hit.issue_id && (
                        <div className="button-row">
                          <Button
                            size="sm"
                            onClick={() =>
                              props.inspect(
                                hit.resource ?? {
                                  action: "open_task",
                                  issue_id: hit.issue_id!,
                                  section:
                                    hit.kind === "communication" || hit.kind === "lead"
                                      ? "activity"
                                      : hit.kind === "wait"
                                        ? "summary"
                                        : "verification",
                                  ...(hit.kind === "communication"
                                    ? { activity: "communication" as const }
                                    : hit.kind === "lead"
                                      ? { activity: "leads" as const }
                                      : {}),
                                },
                              )
                            }
                          >
                            Open in task
                          </Button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }}
            </RequestState>
          ) : (
            props.review && <ReviewsForSource target={props.review} />
          )}
        </div>
      </aside>
    ) : props.surface ? (
      <aside className="inspector" aria-label="Work inspector">
        <header className="inspector-header">
          <div className="canvas-heading">
            <h2>{props.surface.surface_id}</h2>
            <small>Conversation view · revision {props.surface.revision}</small>
          </div>
          <div className="inspector-controls">
            <CanvasControls {...props} />
          </div>
        </header>
        <div className="inspector-content">
          <ExactSurface target={props.surface} inspect={props.inspect} />
        </div>
      </aside>
    ) : !props.issue ? null : props.work ? (
      <InspectorContent {...props} work={props.work} />
    ) : (
      <UnloadedInspector {...props} issue={props.issue} />
    );
  if (phone || !overlay) return <CanvasRefreshProvider>{content}</CanvasRefreshProvider>;
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
            : "inspector-sheet data-[side=right]:w-[min(600px,100vw)] data-[side=right]:sm:max-w-none gap-0"
        }
      >
        <SheetTitle className="sr-only">
          {canvas ? "Report canvas" : "Work inspector"}:{" "}
          {props.surface?.surface_id ?? props.work?.title ?? "Selected task"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read-only work details. Instructions go to Abra.
        </SheetDescription>
        <div className="sheet-toolbar">
          <SearchTrigger />
        </div>
        <span className="sheet-picker">{props.picker}</span>
        <CanvasRefreshProvider>{content}</CanvasRefreshProvider>
      </SheetContent>
    </Sheet>
  );
}

function CanvasControls({ close }: Pick<Props, "close">) {
  return (
    <>
      <RefreshCanvas />
      <Button variant="ghost" size="icon" onClick={close} aria-label="Close inspector">
        <X aria-hidden="true" />
      </Button>
    </>
  );
}

function UnloadedInspector(props: Props) {
  const query = queries.overview(props.issue);
  useCanvasRead(query);
  const result = useAtomValue(query);
  const detail = AsyncResult.value(result);
  if (Option.isSome(detail)) return <InspectorContent {...props} work={detail.value.work} />;
  return (
    <aside className="inspector" aria-label="Work inspector">
      <header className="inspector-header">
        <div className="canvas-heading">
          <h2>Selected task</h2>
          <small>{props.issue}</small>
        </div>
        <div className="inspector-controls">
          <RefreshCanvas />
          <Button variant="ghost" size="icon" onClick={props.close} aria-label="Close inspector">
            <X aria-hidden="true" />
          </Button>
        </div>
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
  refresh,
}: ContentProps) {
  const route = useSearch({ from: "__root__" });
  const target = route.resource;
  const [approvalOpen, setApprovalOpen] = useState(false);
  const title =
    target?.action === "open_finding"
      ? `Finding · ${target.finding_id}`
      : target?.action === "open_passage"
        ? `${target.file} · lines ${target.start}–${target.end}`
        : target?.action === "open_artifact"
          ? target.request_id
          : target?.action === "open_decision"
            ? target.key
            : target?.action === "open_session"
              ? target.session_id
              : (route.file ?? (tab === "Overview" ? work.title : tab));

  const boundApproval = forms.find(
    (item) =>
      item.active &&
      item.checkpoint?.active &&
      item.checkpoint.issue_id === work.issue_id &&
      (item.checkpoint.kind === "plan" || item.checkpoint.kind === "merge"),
  );
  const showApprovalBar =
    Boolean(boundApproval) && (tab === "Overview" || tab === "Plan" || tab === "Diff");

  return (
    <aside className="inspector" aria-label="Work inspector">
      <header className="inspector-header">
        <div className="canvas-heading">
          <h2>{title}</h2>
          <small title={work.issue_id}>
            {title === work.title ? (work.repository_id ?? "Work") : work.title} · {work.issue_id}
          </small>
        </div>
        <div className="inspector-controls">
          <CanvasControls close={close} />
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = inspectorTabs.find((name) => name === value);
          if (next) setTab(next);
        }}
        className="inspector-tab-bar"
      >
        <TabsList
          variant="line"
          className="tabs w-full overflow-x-auto justify-start"
          aria-label="Work details"
        >
          {inspectorTabs.map((name) => {
            const Icon = tabIcons[name];
            return (
              <TabsTrigger key={name} value={name}>
                <Icon aria-hidden="true" />
                <span>{name}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {showApprovalBar && boundApproval && (
        <div className="contextual-approval-bar">
          <div className="contextual-approval-row">
            <span className="contextual-approval-label">
              <AlertTriangle aria-hidden="true" />
              <span>
                <strong>Bound {boundApproval.checkpoint!.kind} approval</strong> pending for this
                task
              </span>
            </span>
            <div className="contextual-approval-actions">
              <Button
                size="sm"
                variant={approvalOpen ? "outline" : "default"}
                onClick={() => setApprovalOpen((open) => !open)}
              >
                {approvalOpen
                  ? "Hide approval form"
                  : `Review ${boundApproval.checkpoint!.kind} approval`}
              </Button>
            </div>
          </div>
          {approvalOpen && refresh && (
            <div className="contextual-approval-drawer">
              <NativeForm
                key={`${boundApproval.form.id}-${boundApproval.binding}`}
                item={boundApproval}
                refresh={refresh}
              />
            </div>
          )}
        </div>
      )}
      <div className="inspector-content" key={`${work.issue_id}:${tab}`}>
        <InspectorPanel
          work={work}
          tab={tab}
          ask={ask}
          forms={forms}
          focusForm={focusForm}
          inspect={inspect}
        />
      </div>
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
  const search = useSearch({ from: "__root__" });
  const target = search.resource;
  if (target?.action === "open_finding")
    return <SelectedFinding target={target} inspect={inspect} />;
  if (target?.action === "open_decision")
    return <DecisionsPanel issue={work.issue_id} forms={forms} focusForm={focusForm} />;
  if (target?.action === "open_passage")
    return <PlanPassagePanel issue={work.issue_id} target={target} />;
  switch (tab) {
    case "Verification":
      return (
        <VerificationPanel
          work={work}
          inspect={inspect}
          decision={
            forms.find(
              (item) =>
                item.active &&
                item.checkpoint?.active &&
                item.checkpoint.issue_id === work.issue_id,
            )?.form.id
          }
          focusForm={focusForm}
        />
      );
    case "Overview":
      return (
        <RequestState query={queries.overview(work.issue_id)}>
          {(detail) => (
            <>
              <Overview detail={detail} ask={ask} forms={forms} focusForm={focusForm} />
              <DecisionsPanel issue={work.issue_id} forms={forms} focusForm={focusForm} />
            </>
          )}
        </RequestState>
      );
    case "Plan":
      return <PlanPanel work={work} />;
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
