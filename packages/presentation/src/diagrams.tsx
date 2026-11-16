import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DiagramPreparation } from "@abracode/contracts/presentation/diagrams";
import type { PrepareDiagramSelection } from "@abracode/contracts/web/diagram-actions";
import { ContentHash } from "@abracode/contracts/identities";
import { Button } from "./ui/button.tsx";

export type PreparedReportDiagram = { id?: string; source: string; svg: string };
export const DiagramLoaderContext = createContext<
  | ((selection: PrepareDiagramSelection, signal: AbortSignal) => Promise<DiagramPreparation>)
  | undefined
>(undefined);
export type DiagramRequest =
  | PrepareDiagramSelection
  | { kind: "surface"; surface_id: string; revision: number; surface: unknown };
const stable = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

export function usePreparedDiagrams(
  request: DiagramRequest | undefined,
  supplied?: readonly PreparedReportDiagram[],
) {
  const load = useContext(DiagramLoaderContext);
  const key = request ? stable(request) : "";
  const [state, setState] = useState<{
    key: string;
    assets: readonly PreparedReportDiagram[];
    message?: string;
  }>();
  useEffect(() => {
    if (!load || !request || supplied) return;
    const controller = new AbortController();
    let current = true;
    const prepare = async () => {
      let selection: PrepareDiagramSelection;
      if (request.kind === "surface" && "surface" in request) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(stable(request.surface)),
        );
        selection = {
          kind: "surface",
          surface_id: request.surface_id,
          revision: request.revision,
          hash: ContentHash.make(
            Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(""),
          ),
        };
      } else selection = request;
      const prepared = await load(selection, controller.signal);
      if (current)
        setState({
          key,
          assets: prepared.assets,
          message: prepared.verified
            ? undefined
            : prepared.results
                .filter((r) => r.status !== "verified")
                .map((r) => `${r.id}: ${r.status}: ${r.message}`)
                .join("\n"),
        });
    };
    void prepare().catch(() => {
      if (current)
        setState({
          key,
          assets: [],
          message: "Diagram rendering is unavailable. Retained source remains readable.",
        });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [key, load, supplied]); // The stable key includes every selected source/revision/hash.
  return supplied
    ? { assets: supplied }
    : state?.key === key
      ? state
      : {
          assets: [],
          message: load
            ? "Preparing diagrams…"
            : "Captured Mermaid source. A prepared rendering is available in an explicit HTML export.",
        };
}

/** Namespacing changes SVG references only; captured source and visible label text stay exact. */
function namespaceSVG(svg: string, prefix: string) {
  const template = document.createElement("template");
  template.innerHTML = svg;
  const ids = new Map<string, string>();
  const placements = new Map<Element, string>();
  for (const [index, element] of Array.from(template.content.querySelectorAll("[id]")).entries()) {
    const original = element.id;
    const next = ids.has(original)
      ? `${prefix}-${original}-instance-${index}`
      : `${prefix}-${original}`;
    if (!ids.has(original)) ids.set(original, next);
    placements.set(element, next);
  }
  const references = (value: string) => {
    for (const [id, next] of [...ids].sort(([a], [b]) => b.length - a.length))
      value = value
        .replaceAll(`url(#${id})`, `url(#${next})`)
        .replaceAll(`url("#${id}")`, `url("#${next}")`)
        .replaceAll(`url('#${id}')`, `url('#${next}')`);
    return value;
  };
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") element.setAttribute("id", placements.get(element)!);
      else if (["href", "xlink:href"].includes(attribute.name) && attribute.value.startsWith("#"))
        element.setAttribute(
          attribute.name,
          `#${ids.get(attribute.value.slice(1)) ?? attribute.value.slice(1)}`,
        );
      else if (["aria-labelledby", "aria-describedby"].includes(attribute.name))
        element.setAttribute(
          attribute.name,
          attribute.value
            .split(/\s+/)
            .map((id) => ids.get(id) ?? id)
            .join(" "),
        );
      else element.setAttribute(attribute.name, references(attribute.value));
    }
    if (element.localName === "style") {
      let css = references(element.textContent ?? "");
      for (const [id, next] of [...ids].sort(([a], [b]) => b.length - a.length))
        css = css.replace(
          new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z0-9_-])`, "g"),
          `#${next}`,
        );
      element.textContent = css;
    }
  }
  return template.innerHTML;
}

export function DiagramView({
  title,
  source,
  description,
  prepared,
  message,
}: {
  title: string;
  source: string;
  description?: string;
  prepared?: PreparedReportDiagram;
  message?: string;
}) {
  const identity = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const svg = useMemo(
    () => (prepared ? namespaceSVG(prepared.svg, identity) : undefined),
    [prepared?.svg, identity],
  );
  const expandedSVG = useMemo(
    () => (prepared ? namespaceSVG(prepared.svg, `${identity}-expanded`) : undefined),
    [prepared?.svg, identity],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  return (
    <figure className="mermaid-diagram" data-diagram-state={svg ? "ready" : "source"}>
      <figcaption>
        <strong>{title}</strong>
      </figcaption>
      {description && <p id={`${identity}-description`}>{description}</p>}
      {svg ? (
        <>
          <div
            className="diagram-scroll"
            role="img"
            aria-label={title}
            aria-describedby={description ? `${identity}-description` : undefined}
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <Button
            ref={trigger}
            variant="outline"
            onClick={() => {
              setZoom(1);
              setExpanded(true);
              dialog.current?.showModal();
            }}
          >
            Expand diagram
          </Button>
          <dialog
            ref={dialog}
            className="diagram-dialog"
            onKeyDown={(event) => {
              if (event.key === "Escape") event.stopPropagation();
            }}
            aria-labelledby={`${identity}-title`}
            onClose={() => {
              setExpanded(false);
              trigger.current?.focus();
            }}
          >
            <div className="diagram-toolbar">
              <h3 id={`${identity}-title`}>{title}</h3>
              <Button
                variant="outline"
                aria-label="Zoom out"
                disabled={zoom <= 0.25}
                onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}
              >
                −
              </Button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <Button
                variant="outline"
                aria-label="Zoom in"
                disabled={zoom >= 4}
                onClick={() => setZoom((v) => Math.min(4, v + 0.25))}
              >
                +
              </Button>
              <Button variant="outline" onClick={() => setZoom(1)}>
                Reset zoom
              </Button>
              <Button onClick={() => dialog.current?.close()}>Close diagram</Button>
            </div>
            <div
              className="diagram-scroll diagram-expanded"
              tabIndex={0}
              role="img"
              aria-label={title}
            >
              <div
                style={{ zoom }}
                dangerouslySetInnerHTML={{ __html: expanded ? expandedSVG! : "" }}
              />
            </div>
          </dialog>
        </>
      ) : (
        <p role="status">
          {message ?? "Diagram rendering is unavailable. Retained source remains readable."}
        </p>
      )}
      <details>
        <summary>Diagram source · {title}</summary>
        <pre className="report-code" tabIndex={0} aria-label="Diagram source">
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
