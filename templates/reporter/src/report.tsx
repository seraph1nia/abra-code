import { createMemo, createSignal, For, Show } from "solid-js";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import flow from "./diagrams/report-flow.mmd";
import sequence from "./diagrams/report-sequence.mmd";
import state from "./diagrams/report-state.mmd";

type Finding = {
  title: string;
  category: "Authoring" | "Delivery" | "Interaction";
  summary: string;
  evidence: string;
  source: { label: string; href: string };
};

// Start here: replace this example's content and compose ordinary Solid/HTML below.
const findings: Finding[] = [
  {
    title: "Write the report in TypeScript",
    category: "Authoring",
    summary: "One editable TSX file contains the content, layout and local interactions.",
    evidence:
      "Solid signals update only the parts of the page that depend on them. Add a table, diagram or custom control directly when the report needs it.",
    source: { label: "Solid documentation", href: "https://docs.solidjs.com/" },
  },
  {
    title: "Carry one HTML file",
    category: "Delivery",
    summary: "The checked build bundles the application and styles into a portable page.",
    evidence:
      "Open the built HTML in the native preview or move it to another directory. This example needs no server, network, credentials or browser storage to work.",
    source: {
      label: "Single-file build plugin",
      href: "https://github.com/richardtallent/vite-plugin-singlefile",
    },
  },
  {
    title: "Keep interactions local",
    category: "Interaction",
    summary: "Filter findings and expand evidence using browser controls.",
    evidence:
      "The search changes only this page. Evidence disclosures use native HTML details elements. Neither control contacts an agent or changes orchestration state.",
    source: { label: "Explore this report's findings", href: "#findings" },
  },
];

export default function Report() {
  const [query, setQuery] = createSignal("");
  const visible = createMemo(() => {
    const term = query().trim().toLowerCase();
    return findings.filter((finding) =>
      `${finding.title} ${finding.category} ${finding.summary} ${finding.evidence}`
        .toLowerCase()
        .includes(term),
    );
  });

  return (
    <main>
      <header class="report-header">
        <p class="eyebrow">AbraCode / Field notes / 001</p>
        <h1>A small report, ready to share.</h1>
        <p class="lede">
          Author in Solid. Build once. Read in the conversation’s HTML preview or open the same file
          in a browser.
        </p>
        <div class="meta">
          <span>Example report</span>
          <span>Local interactions</span>
          <span>One HTML file</span>
        </div>
      </header>

      <section class="recommendation" aria-labelledby="recommendation-title">
        <p class="eyebrow">Recommendation</p>
        <h2 id="recommendation-title">Start with the page you need.</h2>
        <p>
          Replace this example with your findings. Use ordinary TSX and CSS; add a component only
          when the report benefits from it.
        </p>
      </section>

      <section id="findings" aria-labelledby="findings-title">
        <div class="section-heading">
          <h2 id="findings-title">Findings</h2>
          <p aria-live="polite">
            {visible().length} of {findings.length} shown
          </p>
        </div>
        <label for="finding-filter">Filter findings</label>
        <input
          id="finding-filter"
          type="search"
          placeholder="Try delivery or evidence…"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <div class="findings">
          <For each={visible()}>
            {(finding) => (
              <article class="finding">
                <span class="tag">{finding.category}</span>
                <h3>{finding.title}</h3>
                <p>{finding.summary}</p>
                <details>
                  <summary>Read evidence</summary>
                  <p>{finding.evidence}</p>
                  <a href={finding.source.href}>
                    {finding.source.label} <span aria-hidden="true">↗</span>
                  </a>
                </details>
              </article>
            )}
          </For>
          <Show when={visible().length === 0}>
            <p class="empty">No findings match. Try a different search.</p>
          </Show>
        </div>
      </section>

      <section aria-labelledby="delivery-title">
        <h2 id="delivery-title">Two ways to read</h2>
        <div class="table-scroll" role="region" aria-label="Delivery comparison" tabIndex={0}>
          <table>
            <caption>The same artifact, opened where it is useful.</caption>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">Open with</th>
                <th scope="col">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Native preview</th>
                <td>Absolute HTML file link in chat</td>
                <td>While the file exists</td>
              </tr>
              <tr>
                <th scope="row">Browser page</th>
                <td>URL printed by local preview</td>
                <td>While preview is running on this machine</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="diagrams-title">
        <p class="eyebrow">Visual explanations</p>
        <h2 id="diagrams-title">Choose the view that answers the question.</h2>
        <p>Use a flowchart for steps, a sequence for interactions, or states for a lifecycle.</p>
        <MermaidDiagram
          title="How a report reaches the reader"
          diagram={flow}
          caption="A flowchart shows the path from a question to a portable report."
        />
        <MermaidDiagram
          title="Who interacts with whom"
          diagram={sequence}
          caption="A sequence diagram makes the order of exchanges explicit."
        />
        <MermaidDiagram
          title="The report lifecycle"
          diagram={state}
          caption="A state diagram shows valid transitions and the revision loop."
        />
      </section>
      <footer>Prepared with the AbraCode report template · Presentation only</footer>
    </main>
  );
}
