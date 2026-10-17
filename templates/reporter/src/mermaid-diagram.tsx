import { Show } from "solid-js";

export type PreparedDiagram = { source: string; svg: string };

export function MermaidDiagram(props: {
  title: string;
  diagram: PreparedDiagram;
  caption?: string;
}) {
  return (
    <figure class="mermaid-diagram" data-diagram-state="ready">
      <figcaption>
        <h3>{props.title}</h3>
        <Show when={props.caption}>
          <p>{props.caption}</p>
        </Show>
      </figcaption>
      <div
        class="diagram-scroll"
        role="img"
        aria-label={props.title}
        tabIndex={0}
        innerHTML={props.diagram.svg}
      />
      <details>
        <summary>Mermaid source</summary>
        <pre>
          <code>{props.diagram.source}</code>
        </pre>
      </details>
    </figure>
  );
}
