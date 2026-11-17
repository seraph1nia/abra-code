import { useId, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button.tsx";
import { Expand, ZoomOut, ZoomIn, RotateCcw, X } from "./icons.ts";
import type { PreparedReportDiagram } from "./diagram-resource.tsx";
export { usePreparedDiagrams } from "./diagram-resource.tsx";
export type { DiagramRequest, PreparedReportDiagram } from "./diagram-resource.tsx";

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
  const sourceSVG = prepared?.svg;
  const svg = useMemo(
    () => (sourceSVG ? namespaceSVG(sourceSVG, identity) : undefined),
    [sourceSVG, identity],
  );
  const expandedSVG = useMemo(
    () => (sourceSVG ? namespaceSVG(sourceSVG, `${identity}-expanded`) : undefined),
    [sourceSVG, identity],
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
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline verified SVG needs a labeled, keyboard-scrollable canvas rather than a replaced img element. */}
          <div
            className="diagram-scroll"
            role="img"
            aria-label={title}
            aria-describedby={description ? `${identity}-description` : undefined}
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
          <Button
            ref={trigger}
            variant="outline"
            onClick={() => {
              setZoom(1);
              setExpanded(true);
              dialog.current?.showModal();
            }}
          >
            <Expand aria-hidden="true" /> Expand diagram
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
                <ZoomOut aria-hidden="true" />
              </Button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <Button
                variant="outline"
                aria-label="Zoom in"
                disabled={zoom >= 4}
                onClick={() => setZoom((v) => Math.min(4, v + 0.25))}
              >
                <ZoomIn aria-hidden="true" />
              </Button>
              <Button variant="outline" onClick={() => setZoom(1)}>
                <RotateCcw aria-hidden="true" /> Reset zoom
              </Button>
              <Button onClick={() => dialog.current?.close()}>
                <X aria-hidden="true" /> Close diagram
              </Button>
            </div>
            {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The expanded inline SVG retains a labeled scroll/zoom canvas. */}
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
            {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
          </dialog>
        </>
      ) : (
        <output>
          {message ?? "Diagram rendering is unavailable. Retained source remains readable."}
        </output>
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
