import type { ReactNode } from "react";
import type { WorkProps } from "@abracode/contracts/web/catalog";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type { ReportSnapshot } from "@abracode/contracts/presentation/report-evidence";
import { DiagramView } from "./diagrams.tsx";
import { ReportEvidence, type PreparedReportDiagram } from "./report-evidence.tsx";
import { bindWork, type WorkBinding } from "./work-bindings.ts";
export { bindWork } from "./work-bindings.ts";
import {
  createNavigator,
  DecisionSummaryWidget,
  DependencyGraphWidget,
  KanbanWidget,
  ReportLinkWidget,
  ResourceLinkWidget,
  StatusSummaryWidget,
  TimelineWidget,
  WorkTableWidget,
} from "./work-widget-views.tsx";

export type WorkWidgetBinding = WorkBinding & {
  evidence?: ReportSnapshot;
  hideLiveWidgets?: boolean;
  diagramMessage?: string;
  preparedDiagrams?: readonly PreparedReportDiagram[];
  inspect?: (target: ResourceSelection) => void;
};

export type WorkListWidgetName =
  | "WorkTable"
  | "StatusSummary"
  | "Kanban"
  | "DependencyGraph"
  | "Timeline"
  | "DecisionSummary";

export type WorkWidgetInput =
  | { name: "Mermaid"; props: WorkProps<"Mermaid"> }
  | { name: "ReportEvidence"; props: WorkProps<"ReportEvidence"> }
  | { name: "ReportLink"; props: WorkProps<"ReportLink"> }
  | { name: "ResourceLink"; props: WorkProps<"ResourceLink"> }
  | { name: WorkListWidgetName; props: WorkProps<"WorkTable"> };

function WidgetFrame({
  name,
  binding,
  showBinding,
  bindingLabel,
  footer,
  children,
}: {
  name: WorkWidgetInput["name"];
  binding: WorkWidgetBinding;
  showBinding: boolean;
  bindingLabel: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="surface-widget" data-work-widget={name}>
      {showBinding && (
        <div className="surface-binding">
          {bindingLabel}
          {binding.frozen && binding.inspect && " · Links inspect current app resources"}
        </div>
      )}
      {children}
      {footer}
      {!binding.inspect && (
        <p className="muted">App navigation is unavailable in this document view.</p>
      )}
    </section>
  );
}

/** Presentation has no router, query client, model tool or controller dependency. */
export function WorkWidget({
  binding,
  ...input
}: WorkWidgetInput & { binding: WorkWidgetBinding }) {
  if (input.name === "Mermaid") {
    return (
      <DiagramView
        title={input.props.title}
        source={input.props.source}
        description={input.props.description}
        prepared={binding.preparedDiagrams?.find((d) => d.source === input.props.source)}
        message={binding.diagramMessage}
      />
    );
  }
  if (input.name === "ReportEvidence") {
    return (
      <ReportEvidence
        section={input.props.section}
        snapshot={binding.evidence}
        preparedDiagrams={binding.preparedDiagrams}
        diagramMessage={binding.diagramMessage}
      />
    );
  }
  const navigate = createNavigator(binding.inspect);
  if (input.name === "ResourceLink") {
    const { incomplete } = bindWork({}, binding);
    return (
      <WidgetFrame
        name="ResourceLink"
        binding={binding}
        showBinding={!!(binding.frozen || incomplete)}
        bindingLabel="Current app navigation"
      >
        <ResourceLinkWidget props={input.props} navigate={navigate} />
      </WidgetFrame>
    );
  }
  if (input.name === "ReportLink") {
    const { incomplete } = bindWork({}, binding);
    return (
      <WidgetFrame
        name="ReportLink"
        binding={binding}
        showBinding={!!(binding.frozen || incomplete)}
        bindingLabel="Current app navigation"
      >
        <ReportLinkWidget props={input.props} navigate={navigate} />
      </WidgetFrame>
    );
  }

  if (input.props.mode !== "snapshot" && binding.hideLiveWidgets) return null;
  const { selected, total, label, incomplete } = bindWork(input.props, binding);
  const source = input.props.mode === "snapshot" ? binding.captured : binding.work;

  let content: ReactNode;
  switch (input.name) {
    case "StatusSummary":
      content = <StatusSummaryWidget selected={selected} incomplete={incomplete} />;
      break;
    case "WorkTable":
      content = <WorkTableWidget selected={selected} navigate={navigate} />;
      break;
    case "Kanban":
      content = <KanbanWidget selected={selected} navigate={navigate} />;
      break;
    case "Timeline":
      content = <TimelineWidget selected={selected} navigate={navigate} />;
      break;
    case "DependencyGraph":
      content = <DependencyGraphWidget selected={selected} source={source} navigate={navigate} />;
      break;
    case "DecisionSummary":
      content = <DecisionSummaryWidget selected={selected} navigate={navigate} />;
      break;
  }

  return (
    <WidgetFrame
      name={input.name}
      binding={binding}
      showBinding={
        !!(
          binding.frozen ||
          input.props.mode === "snapshot" ||
          incomplete ||
          input.props.issueIds !== undefined
        )
      }
      bindingLabel={label}
      footer={
        total > selected.length ? (
          <output>
            Showing {selected.length} of {total} matching work observations.
          </output>
        ) : undefined
      }
    >
      {!selected.length && incomplete ? null : content}
    </WidgetFrame>
  );
}
