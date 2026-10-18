import { FeedbackForm } from "./components/feedback.tsx";
import { createSignal, Show } from "solid-js";
import {
  FindingList,
  ReportHeader,
  Section,
  SectionNavigation,
  type Finding,
} from "./components/report.tsx";
import VerificationExample from "./examples/verification.tsx";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import flow from "./diagrams/report-flow.mmd";
import sequence from "./diagrams/report-sequence.mmd";
import state from "./diagrams/report-state.mmd";

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

function FieldNotes() {
  return (
    <main>
      <ReportHeader
        eyebrow="AbraCode / Field notes / 001"
        title="A small report, ready to share."
        summary="Author in Solid. Build once. Read in the conversation’s HTML preview or open the same file in a browser."
        labels={["Example report", "Local interactions", "One HTML file"]}
      />
      <SectionNavigation
        sections={[
          { id: "findings", title: "Findings" },
          { id: "delivery", title: "Delivery" },
          { id: "diagrams", title: "Diagrams" },
          { id: "feedback", title: "Feedback" },
        ]}
      />

      <section class="recommendation" aria-labelledby="recommendation-title">
        <p class="eyebrow">Recommendation</p>
        <h2 id="recommendation-title">Start with the page you need.</h2>
        <p>
          Replace this example with your findings. Use ordinary TSX and CSS; add a component only
          when the report benefits from it.
        </p>
      </section>

      <Section id="findings" title="Findings">
        <FindingList findings={findings} />
      </Section>

      <section id="delivery" aria-labelledby="delivery-title">
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
      <section id="diagrams" aria-labelledby="diagrams-title">
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
      <Section id="feedback" title="Local review feedback">
        <FeedbackForm
          sections={[
            { id: "findings", title: "Findings" },
            { id: "delivery", title: "Delivery" },
            { id: "diagrams", title: "Diagrams" },
          ]}
        />
      </Section>
      <footer>Prepared with the AbraCode report template · Presentation only</footer>
    </main>
  );
}

export default function Report() {
  const [view, setView] = createSignal<"field-notes" | "verification">("field-notes");
  return (
    <>
      <nav class="example-nav" aria-label="Example reports">
        <button
          type="button"
          aria-pressed={view() === "field-notes"}
          onClick={() => setView("field-notes")}
        >
          Field notes
        </button>
        <button
          type="button"
          aria-pressed={view() === "verification"}
          onClick={() => setView("verification")}
        >
          Verification example
        </button>
      </nav>
      <Show when={view() === "field-notes"} fallback={<VerificationExample />}>
        <FieldNotes />
      </Show>
    </>
  );
}
