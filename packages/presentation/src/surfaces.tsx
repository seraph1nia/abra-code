import { catalogComponent } from "./catalog-component.tsx";
import { A2uiMarkdown } from "./a2ui-markdown.tsx";
export { A2uiMarkdown };
import { deferred } from "./deferred.tsx";
import { CatalogMedia } from "./catalog-media.tsx";
import { contentImplementation } from "./catalog-content.tsx";
import { CatalogIcon } from "./catalog-icon.tsx";
import { useSurfaceOwner } from "./surface-owner.ts";
import { usePreparedDiagrams, type DiagramRequest } from "./diagrams.tsx";
import { Button } from "./ui/button.tsx";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import type { BindingCoverage } from "@abracode/contracts/web/bindings";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WorkWidget, type WorkWidgetInput } from "./work-widgets.tsx";
import type { Inspect } from "./cards.tsx";
import type { ReportSnapshot } from "@abracode/contracts/presentation/report-evidence";
import type { PreparedReportDiagram } from "./report-evidence.tsx";
import { Schema } from "effect";
import {
  A2uiSurface,
  MarkdownComponentContext,
  useSignalValue,
  type ReactCatalogComponent,
} from "@a2ui/react";
import { DataModel, basicCatalog, MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v1_0";
import type { SurfaceEntry, SurfaceRecord } from "@abracode/contracts/web/contracts";
import type { WebWorkItem as WorkItem } from "@abracode/contracts/web/wire";
import { surfaceValidation, validateSurface } from "@abracode/contracts/web/surfaces";
import {
  basicComponentNames,
  contentNames,
  catalog,
  catalogId,
  implementedCatalog,
  isChartComponent,
  chartComponents,
  workComponents,
  workComponentNames,
  type WorkComponentName,
} from "@abracode/contracts/web/catalog";

type WorkViewContext = {
  record: Pick<SurfaceRecord, "surface" | "snapshot" | "revision" | "at" | "coverage"> &
    Partial<Pick<SurfaceRecord, "session_id" | "surface_hash">>;
  work: readonly WorkItem[];
  liveCoverage?: BindingCoverage;
  hideLiveWidgets?: boolean;
  inspect?: Inspect;
  frozen?: boolean;
  prepareMessage?: (text: string) => void;
  evidence?: ReportSnapshot;
  preparedDiagrams?: readonly PreparedReportDiagram[];
  diagramMessage?: string;
  diagramRequest?: DiagramRequest;
};
type WidgetContext = Omit<WorkViewContext, "work" | "liveCoverage"> & { live: DataModel };
const ViewContext = createContext<WidgetContext | undefined>(undefined);

const CatalogChart = deferred(() => import("./charts.tsx"), "Chart");

function bindWidget(name: WorkComponentName) {
  const api = catalog.components.get(name);
  if (!api) throw new Error(`Missing catalog component ${name}`);
  if (isChartComponent(name)) {
    const decode = chartComponents[name].decode;
    return catalogComponent(api, ({ props }) => {
      const chart = useMemo(() => decode(props), [props]);
      return <CatalogChart {...chart} />;
    });
  }
  switch (name) {
    case "Mermaid": {
      const decode = Schema.decodeUnknownSync(workComponents.Mermaid.props);
      return catalogComponent(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="Mermaid" props={decoded} />;
      });
    }
    case "ReportEvidence": {
      const decode = Schema.decodeUnknownSync(workComponents.ReportEvidence.props);
      return catalogComponent(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ReportEvidence" props={decoded} />;
      });
    }
    case "ReportLink": {
      const decode = Schema.decodeUnknownSync(workComponents.ReportLink.props);
      return catalogComponent(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ReportLink" props={decoded} />;
      });
    }
    case "ResourceLink": {
      const decode = Schema.decodeUnknownSync(workComponents.ResourceLink.props);
      return catalogComponent(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ResourceLink" props={decoded} />;
      });
    }
    default: {
      const decode = Schema.decodeUnknownSync(workComponents[name].props);
      return catalogComponent(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name={name} props={decoded} />;
      });
    }
  }
}
export const reactWorkCatalog = implementedCatalog<ReactCatalogComponent>([
  ...basicComponentNames.map((name) => {
    const api = catalog.components.get(name);
    const implementation = basicCatalog.components.get(name);
    if (!api || !implementation) throw new Error(`Missing basic component ${name}`);
    if (name === "Video" || name === "AudioPlayer" || name === "Image")
      return catalogComponent(api, function Media({ props }) {
        const view = useContext(ViewContext);
        return <CatalogMedia kind={name} props={props} frozen={!!view?.frozen} />;
      });
    if (name === "Icon")
      return catalogComponent(api, ({ props }) => <CatalogIcon name={props.name} />);
    return implementation;
  }),
  ...contentNames.map(contentImplementation),
  ...workComponentNames.map(bindWidget),
]);

export function WorkViews({
  records,
  work,
  inspect,
  actions,
  prepareMessage,
  liveCoverage,
  hideLiveWidgets,
}: {
  records: readonly SurfaceEntry[];
  work: readonly WorkItem[];
  inspect: Inspect;
  liveCoverage?: BindingCoverage;
  hideLiveWidgets?: boolean;
  prepareMessage?: (text: string) => void;
  actions?: (record: SurfaceRecord) => ReactNode;
}) {
  return (
    <div className="generated-views">
      {records.map((record) =>
        "unavailable" in record ? (
          <p className="error" key={record.surface_id}>
            {record.unavailable}
          </p>
        ) : (
          <div key={record.surface.createSurface.surfaceId} className="surface-publication">
            <GeneratedSurface
              record={record}
              prepareMessage={prepareMessage}
              work={work}
              liveCoverage={liveCoverage}
              hideLiveWidgets={hideLiveWidgets}
              inspect={inspect}
            />
            {actions?.(record)}
          </div>
        ),
      )}
    </div>
  );
}
type Rendered = {
  live: DataModel;
  processor: MessageProcessor<ReactCatalogComponent>;
  surface: SurfaceModel<ReactCatalogComponent>;
  record: WorkViewContext["record"];
};
function prepareSurface(record: WorkViewContext["record"]): Rendered {
  const processor = new MessageProcessor<ReactCatalogComponent>([reactWorkCatalog], undefined, {
    version: "1.0",
    validationConfig: {
      ...surfaceValidation,
      allowedMessages: ["createSurface", "updateComponents", "updateDataModel"],
      allowOrphanComponents: true,
    },
  });
  try {
    validateSurface(record.surface, undefined, processor);
    const surface = processor.model.getSurface(record.surface.createSurface.surfaceId);
    if (!surface) throw new Error("Surface was not created");
    return { processor, surface, record, live: new DataModel() };
  } catch (error) {
    processor.dispose();
    throw error;
  }
}
function updateSurface(current: Rendered, record: WorkViewContext["record"]) {
  const surfaceId = record.surface.createSurface.surfaceId;
  if (surfaceId !== current.surface.id || current.record.session_id !== record.session_id)
    return false;
  const { components, dataModel } = validateSurface(record.surface).createSurface;
  const [failure] = current.processor.processMessagesWithErrors({
    version: "1.0",
    updateComponents: { surfaceId, components },
  });
  if (failure) throw new Error(failure.error.message);
  const ids = new Set(components.map((component) => component.id));
  for (const previous of current.record.surface.createSurface.components) {
    if (typeof previous.id === "string" && !ids.has(previous.id))
      current.surface.componentsModel.removeComponent(previous.id);
  }
  const prior = current.record.surface.createSurface.dataModel ?? {};
  const next = dataModel ?? {};
  for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
    if (JSON.stringify(prior[key]) === JSON.stringify(next[key])) continue;
    const path = "/" + key.replaceAll("~", "~0").replaceAll("/", "~1");
    current.processor.processMessages({
      version: "1.0",
      updateDataModel: { surfaceId, path, value: next[key] ?? null },
    });
  }
  current.record = record;
  return true;
}

export function GeneratedSurface({
  record,
  work,
  inspect,
  frozen,
  prepareMessage,
  evidence,
  preparedDiagrams,
  diagramRequest,
  liveCoverage,
  hideLiveWidgets,
}: WorkViewContext) {
  const request = useMemo(
    () =>
      collectDiagrams(record.surface.createSurface.components, evidence).length
        ? (diagramRequest ??
          (record.surface_hash
            ? {
                kind: "surface" as const,
                surface_id: record.surface.createSurface.surfaceId,
                revision: record.revision,
                hash: record.surface_hash,
              }
            : undefined))
        : undefined,
    [record.surface, record.revision, record.surface_hash, evidence, diagramRequest],
  );
  const diagrams = usePreparedDiagrams(request, preparedDiagrams);
  const { rendered, error } = useSurfaceOwner(
    record,
    prepareSurface,
    (view) => {
      view.live.dispose();
      view.processor.dispose();
    },
    (a, b) =>
      a.revision === b.revision &&
      a.session_id === b.session_id &&
      a.surface.createSurface.surfaceId === b.surface.createSurface.surfaceId &&
      (a.surface_hash && b.surface_hash
        ? a.surface_hash === b.surface_hash
        : a.surface === b.surface &&
          a.snapshot === b.snapshot &&
          a.coverage === b.coverage &&
          a.at === b.at),
    updateSurface,
  );
  const live = rendered?.live;
  useLayoutEffect(() => {
    live?.set("/work", work);
  }, [live, work]);
  useLayoutEffect(() => {
    live?.set("/coverage", liveCoverage);
  }, [live, liveCoverage]);
  const renderedRecord = rendered?.record;
  const viewContext = useMemo<WidgetContext | undefined>(
    () =>
      renderedRecord && live
        ? {
            record: renderedRecord,
            live,
            inspect,
            frozen,
            evidence,
            preparedDiagrams: diagrams.assets,
            diagramMessage: diagrams.message,
            hideLiveWidgets,
          }
        : undefined,
    [
      renderedRecord,
      live,
      inspect,
      frozen,
      evidence,
      diagrams.assets,
      diagrams.message,
      hideLiveWidgets,
    ],
  );
  const [feedback, setFeedback] = useState<{ surface: Rendered; text: string }>();
  useEffect(() => {
    if (!rendered) return;
    const action = rendered.surface.onAction.subscribe(({ name, userMessage, context }) => {
      const message = userMessage || name;
      const text = Object.keys(context).length ? `${message}\n${JSON.stringify(context)}` : message;
      if (prepareMessage) prepareMessage(text);
      else setFeedback({ surface: rendered, text: `Report interaction: ${text}` });
    });
    const failure = rendered.surface.onError.subscribe(({ message }) =>
      setFeedback({ surface: rendered, text: message }),
    );
    return () => {
      action.unsubscribe();
      failure.unsubscribe();
    };
  }, [rendered, prepareMessage]);
  return (
    <section
      className="generated-surface"
      data-a2ui-renderer="upstream"
      data-work-catalog={
        rendered?.record.surface.createSurface.catalogId === catalogId ? "v1" : undefined
      }
    >
      {diagrams.retry && (
        <Button variant="outline" disabled={diagrams.pending} onClick={diagrams.retry}>
          Retry diagrams
        </Button>
      )}
      {feedback && feedback.surface === rendered && <output>{feedback.text}</output>}
      {error && <output className="error">{error}</output>}
      {rendered && viewContext && (
        <ViewContext.Provider value={viewContext}>
          <MarkdownComponentContext.Provider value={A2uiMarkdown}>
            <A2uiSurface key={rendered.surface.id} surface={rendered.surface} />
          </MarkdownComponentContext.Provider>
        </ViewContext.Provider>
      )}
    </section>
  );
}

function BoundWidget(input: WorkWidgetInput) {
  const context = useContext(ViewContext);
  if (!context) throw new Error("Work widget requires its retained surface context");
  const work = useSignalValue(context.live.getSignal<readonly WorkItem[]>("/work"));
  const coverage = useSignalValue(context.live.getSignal<BindingCoverage>("/coverage"));
  return (
    <WorkWidget
      {...input}
      binding={{
        work: work ?? [],
        captured: context.record.snapshot,
        capturedAt: context.record.at,
        capturedCoverage: context.record.coverage,
        liveCoverage: coverage,
        inspect: context.inspect,
        frozen: context.frozen,
        hideLiveWidgets: context.hideLiveWidgets,
        evidence: context.evidence,
        preparedDiagrams: context.preparedDiagrams,
        diagramMessage: context.diagramMessage,
      }}
    />
  );
}
