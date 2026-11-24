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
import { WorkWidget, type WorkWidgetInput } from "./work-widgets.tsx";
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
const ViewContext = createContext<WorkViewContext | undefined>(undefined);

const CatalogChart = lazy(() => import("./charts.tsx"));

function bindWidget(name: WorkComponentName) {
  const api = catalog.components.get(name);
  if (!api) throw new Error(`Missing catalog component ${name}`);
  if (isChartComponent(name)) {
    const decode = chartComponents[name].decode;
    return createComponentImplementation(api, ({ props }) => {
      const chart = useMemo(() => decode(props), [props]);
      return (
        <Suspense fallback={<output>Loading chart…</output>}>
          <CatalogChart {...chart} />
        </Suspense>
      );
    });
  }
  switch (name) {
    case "Mermaid": {
      const decode = Schema.decodeUnknownSync(workComponents.Mermaid.props);
      return createComponentImplementation(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="Mermaid" props={decoded} />;
      });
    }
    case "ReportEvidence": {
      const decode = Schema.decodeUnknownSync(workComponents.ReportEvidence.props);
      return createComponentImplementation(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ReportEvidence" props={decoded} />;
      });
    }
    case "ReportLink": {
      const decode = Schema.decodeUnknownSync(workComponents.ReportLink.props);
      return createComponentImplementation(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ReportLink" props={decoded} />;
      });
    }
    case "ResourceLink": {
      const decode = Schema.decodeUnknownSync(workComponents.ResourceLink.props);
      return createComponentImplementation(api, ({ props }) => {
        const decoded = useMemo(() => decode(props), [props]);
        return <BoundWidget name="ResourceLink" props={decoded} />;
      });
    }
    default: {
      const decode = Schema.decodeUnknownSync(workComponents[name].props);
      return createComponentImplementation(api, ({ props }) => {
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

function safeMarkdownHref(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || /^[\\/]{2}/.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {
    return undefined;
  }
  return undefined;
}

const inlinePattern =
  /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(~~[^~\n]+~~)/g;

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    if (match[1]) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeMarkdownHref(token.slice(split + 2, -1));
      nodes.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (match[3]) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (match[5]) {
      nodes.push(<del key={key++}>{token.slice(2, -2)}</del>);
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Pure-React safe Markdown renderer shared across every A2uiSurface (live, reviews, offline reports).
 * Never uses dangerouslySetInnerHTML so raw HTML / script payloads always render as escaped text.
 */
export function A2uiMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre key={key++}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = renderInlineMarkdown(heading[2]!);
      if (level === 1) blocks.push(<h1 key={key++}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={key++}>{content}</h3>);
      else if (level === 4) blocks.push(<h4 key={key++}>{content}</h4>);
      else if (level === 5) blocks.push(<h5 key={key++}>{content}</h5>);
      else blocks.push(<h6 key={key++}>{content}</h6>);
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(
          <li key={items.length}>{renderInlineMarkdown(lines[i]!.replace(/^\s*[-*+]\s+/, ""))}</li>,
        );
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(
          <li key={items.length}>{renderInlineMarkdown(lines[i]!.replace(/^\s*\d+\.\s+/, ""))}</li>,
        );
        i++;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++}>{renderInlineMarkdown(quoteLines.join(" "))}</blockquote>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.trimStart().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^\s*[-*+]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!)
    ) {
      paragraph.push(lines[i]!);
      i++;
    }
    const joined = paragraph.join("\n");
    if (blocks.length === 0 && i >= lines.length) {
      return <span>{renderInlineMarkdown(joined)}</span>;
    }
    blocks.push(<p key={key++}>{renderInlineMarkdown(joined)}</p>);
  }
  if (!blocks.length) return <span>{markdown}</span>;
  return <>{blocks}</>;
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
          a.surface_hash === b.surface_hash &&
          a.surface.createSurface.surfaceId === b.surface.createSurface.surfaceId,
      ),
  );
  const view = useSyncExternalStore(owner.subscribe, owner.read, owner.read);
  useEffect(() => owner.replace(record), [owner, record]);
  useEffect(() => owner.committed(view), [owner, view]);
  const { rendered, error } = view;
  const viewContext = useMemo<WorkViewContext | undefined>(
    () =>
      rendered
        ? {
            record: rendered.record,
            work,
            inspect,
            frozen,
            evidence,
            preparedDiagrams: diagrams.assets,
            diagramMessage: diagrams.message,
            liveCoverage,
            hideLiveWidgets,
          }
        : undefined,
    [
      rendered,
      work,
      inspect,
      frozen,
      evidence,
      diagrams.assets,
      diagrams.message,
      liveCoverage,
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
      {rendered && viewContext && (
        <ViewContext.Provider value={viewContext}>
          <MarkdownComponentContext.Provider value={A2uiMarkdown}>
            <A2uiSurface key={rendered.record.revision} surface={rendered.surface} />
          </MarkdownComponentContext.Provider>
        </ViewContext.Provider>
      )}
    </section>
  );
}

function BoundWidget(input: WorkWidgetInput) {
  const context = useContext(ViewContext);
  if (!context) throw new Error("Work widget requires its retained surface context");
  return (
    <WorkWidget
      {...input}
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
