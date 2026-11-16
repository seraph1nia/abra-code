import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkWidget } from "./presentation/work-widgets.tsx";
import type { Inspect } from "./presentation/cards.tsx";
import type { ReportSnapshot } from "../../../src/presentation/report-evidence.ts";
import type { PreparedReportDiagram } from "./presentation/report-evidence.tsx";
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
import type { SurfaceEntry, SurfaceRecord } from "../../../src/web/contracts.ts";
import type { WebWorkItem as WorkItem } from "../../../src/web/wire.ts";
import { surfaceValidation, toSdkSurface, validateSurface } from "../../../src/web/surfaces.ts";
import {
  basicComponentNames,
  catalog,
  implementedCatalog,
  workComponents,
  workComponentNames,
  type WorkComponentName,
} from "../../../src/web/catalog.ts";

injectBasicCatalogStyles();
type WorkViewContext = {
  record: Pick<SurfaceRecord, "surface" | "snapshot" | "revision" | "at">;
  work: readonly WorkItem[];
  inspect?: Inspect;
  frozen?: boolean;
  evidence?: ReportSnapshot;
  preparedDiagrams?: readonly PreparedReportDiagram[];
};
const ViewContext = createContext<WorkViewContext | undefined>(undefined);

function bindWidget<N extends WorkComponentName>(name: N) {
  const api = catalog.components.get(name);
  if (!api) throw new Error(`Missing catalog component ${name}`);
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
    return { ...implementation, schema: api.schema };
  }),
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
}: {
  records: readonly SurfaceEntry[];
  work: readonly WorkItem[];
  inspect: Inspect;
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
            <GeneratedSurface record={record} work={work} inspect={inspect} />
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
export function GeneratedSurface({
  record,
  work,
  inspect,
  frozen,
  evidence,
  preparedDiagrams,
}: WorkViewContext) {
  const [rendered, setRendered] = useState<Rendered>();
  const [error, setError] = useState("");
  const current = useRef<Rendered | undefined>(undefined);
  useEffect(() => {
    if (current.current?.record.revision === record.revision) return;
    const processor = new MessageProcessor<ReactCatalogComponent>([reactWorkCatalog], undefined, {
      version: "1.0",
      validationConfig: surfaceValidation,
    });
    try {
      validateSurface(
        record.surface,
        new Set([...work, ...record.snapshot].map((w) => w.issue_id)),
      );
      processor.processMessages(toSdkSurface(record.surface));
      const surface = processor.model.getSurface(record.surface.createSurface.surfaceId);
      if (!surface) throw new Error("Surface was not created");
      const next = { processor, surface, record };
      current.current = next;
      setRendered(next);
      setError("");
    } catch {
      processor.dispose();
      setError("Generated view update unavailable: its catalog or structure is invalid.");
    }
  }, [record, work]);
  // Dispose only after a successfully staged replacement commits, or on unmount.
  useEffect(() => () => rendered?.processor.dispose(), [rendered]);
  return (
    <section className="generated-surface" data-a2ui-renderer="upstream">
      <div className="eyebrow">
        Generated work view <span>rev {rendered?.record.revision ?? record.revision}</span>
      </div>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {rendered && (
        <ViewContext.Provider
          value={{ record: rendered.record, work, inspect, frozen, evidence, preparedDiagrams }}
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
        inspect: context.inspect,
        frozen: context.frozen,
        evidence: context.evidence,
        preparedDiagrams: context.preparedDiagrams,
      }}
    />
  );
}
