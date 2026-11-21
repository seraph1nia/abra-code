import { CatalogMedia } from "./catalog-media.tsx";
import { contentImplementation } from "./catalog-content.tsx";
import { CatalogIcon } from "./catalog-icon.tsx";
import { SurfaceOwner } from "./surface-owner.ts";
import { usePreparedDiagrams, type DiagramRequest } from "./diagrams.tsx";
import { Button } from "./ui/button.tsx";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import type { BindingCoverage } from "@abracode/contracts/web/bindings";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { WorkWidget } from "./work-widgets.tsx";
import type { Inspect } from "./cards.tsx";
import type { ReportSnapshot } from "@abracode/contracts/presentation/report-evidence";
import type { PreparedReportDiagram } from "./report-evidence.tsx";
import { Schema } from "effect";
import {
  A2uiSurface,
  createComponentImplementation,
  MarkdownComponentContext,
  type ReactCatalogComponent,
} from "@a2ui/react";
import {
  basicCatalog,
  injectBasicCatalogStyles,
  MessageProcessor,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import type { SurfaceEntry, SurfaceRecord } from "@abracode/contracts/web/contracts";
import type { WebWorkItem as WorkItem } from "@abracode/contracts/web/wire";
import { surfaceValidation, toSdkSurface, validateSurface } from "@abracode/contracts/web/surfaces";
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

injectBasicCatalogStyles();
type WorkViewContext = {
  record: Pick<SurfaceRecord, "surface" | "snapshot" | "revision" | "at" | "coverage"> &
    Partial<Pick<SurfaceRecord, "session_id">>;
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
const ViewContext = createContext<WorkViewContext | undefined>(undefined);

const CatalogChart = lazy(() => import("./charts.tsx"));

function bindWidget(name: WorkComponentName) {
  const api = catalog.components.get(name);
  if (!api) throw new Error(`Missing catalog component ${name}`);
  if (isChartComponent(name)) {
    const decode = chartComponents[name].decode;
    return createComponentImplementation(api, ({ props }) => (
      <Suspense fallback={<output>Loading chart…</output>}>
        <CatalogChart {...decode(props)} />
      </Suspense>
    ));
  }
  return createComponentImplementation(api, ({ props }) => {
    const decoded = Schema.decodeUnknownSync(workComponents[name].props)(props);
    return <BoundWidget name={name} props={decoded} />;
  });
}
export const reactWorkCatalog = implementedCatalog<ReactCatalogComponent>([
  ...basicComponentNames.map((name) => {
    const api = catalog.components.get(name);
    const implementation = basicCatalog.components.get(name);
    if (!api || !implementation) throw new Error(`Missing basic component ${name}`);
    if (name === "Video" || name === "AudioPlayer" || name === "Image")
      return createComponentImplementation(api, function Media({ props }) {
        const view = useContext(ViewContext);
        return <CatalogMedia kind={name} props={props} frozen={!!view?.frozen} />;
      });
    if (name === "Icon")
      return createComponentImplementation(api, ({ props }) => <CatalogIcon name={props.name} />);
    return { ...implementation, schema: api.schema };
  }),
  ...contentNames.map(contentImplementation),
  ...workComponentNames.map(bindWidget),
]);

function PlainText({ markdown }: { markdown: string }) {
  return <span>{markdown}</span>;
}
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
  processor: MessageProcessor<ReactCatalogComponent>;
  surface: SurfaceModel<ReactCatalogComponent>;
  record: WorkViewContext["record"];
};
function prepareSurface(record: WorkViewContext["record"]): Rendered {
  const processor = new MessageProcessor<ReactCatalogComponent>([reactWorkCatalog], undefined, {
    version: "1.0",
    validationConfig: surfaceValidation,
  });
  try {
    validateSurface(record.surface);
    processor.processMessages(toSdkSurface(record.surface));
    const surface = processor.model.getSurface(record.surface.createSurface.surfaceId);
    if (!surface) throw new Error("Surface was not created");
    return { processor, surface, record };
  } catch (error) {
    processor.dispose();
    throw error;
  }
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
        ? (diagramRequest ?? {
            kind: "surface" as const,
            surface_id: record.surface.createSurface.surfaceId,
            revision: record.revision,
            surface: record.surface,
          })
        : undefined,
    [record.surface, record.revision, evidence, diagramRequest],
  );
  const diagrams = usePreparedDiagrams(request, preparedDiagrams);
  const [owner] = useState(
    () =>
      new SurfaceOwner(
        record,
        prepareSurface,
        (view) => view.processor.dispose(),
        (a, b) =>
          a.revision === b.revision &&
          a.at === b.at &&
          a.session_id === b.session_id &&
          a.surface.createSurface.surfaceId === b.surface.createSurface.surfaceId,
      ),
  );
  const view = useSyncExternalStore(owner.subscribe, owner.read, owner.read);
  useEffect(() => owner.replace(record), [owner, record]);
  useEffect(() => owner.committed(view), [owner, view]);
  const { rendered, error } = view;
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
        rendered?.record.surface.createSurface.catalogId === catalogId ? "v5" : undefined
      }
    >
      {diagrams.retry && (
        <Button variant="outline" disabled={diagrams.pending} onClick={diagrams.retry}>
          Retry diagrams
        </Button>
      )}
      {feedback && feedback.surface === rendered && <output>{feedback.text}</output>}
      {error && <output className="error">{error}</output>}
      {rendered && (
        <ViewContext.Provider
          value={{
            record: rendered.record,
            work,
            inspect,
            frozen,
            evidence,
            preparedDiagrams: diagrams.assets,
            diagramMessage: diagrams.message,
            liveCoverage,
            hideLiveWidgets,
          }}
        >
          <MarkdownComponentContext.Provider value={PlainText}>
            <A2uiSurface key={rendered.record.revision} surface={rendered.surface} />
          </MarkdownComponentContext.Provider>
        </ViewContext.Provider>
      )}
    </section>
  );
}

function BoundWidget({ name, props }: Pick<Parameters<typeof WorkWidget>[0], "name" | "props">) {
  const context = useContext(ViewContext);
  if (!context) throw new Error("Work widget requires its retained surface context");
  return (
    <WorkWidget
      name={name}
      props={props}
      binding={{
        work: context.work,
        captured: context.record.snapshot,
        capturedAt: context.record.at,
        capturedCoverage: context.record.coverage,
        liveCoverage: context.liveCoverage,
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
