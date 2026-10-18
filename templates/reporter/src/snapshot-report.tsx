import { MermaidDiagram, type PreparedDiagram } from "./mermaid-diagram.tsx";
import { For, Show } from "solid-js";
import {
  CodePanel,
  FindingList,
  EvidenceReference,
  ReportHeader,
  Section,
  SectionNavigation,
  StatusTimeline,
} from "./components/report.tsx";
import { FeedbackForm } from "./components/feedback.tsx";
import { type ReportSnapshot } from "./snapshot-data.ts";

/** Consume validated snapshots; arbitrary repository strings remain inert text. */
export default function SnapshotReport(props: {
  snapshot: ReportSnapshot;
  diagrams?: readonly PreparedDiagram[];
}) {
  const sections = [
    { id: "snapshot-architecture", title: "Architecture and relationships" },
    { id: "snapshot-findings", title: "Findings" },
    { id: "snapshot-checks", title: "Checks" },
    { id: "snapshot-excerpts", title: "Code and evidence" },
    { id: "snapshot-timeline", title: "Timeline" },
    { id: "snapshot-limitations", title: "Limitations" },
    { id: "snapshot-feedback", title: "Feedback" },
  ];
  return (
    <main>
      <ReportHeader
        eyebrow="AbraCode / Evidence snapshot"
        title={props.snapshot.title}
        summary={props.snapshot.summary}
        observedAt={props.snapshot.observed_at}
        labels={[props.snapshot.issue_id, props.snapshot.execution_id, props.snapshot.status]}
      />
      <p class="snapshot-provenance">{props.snapshot.provenance}</p>
      <SectionNavigation sections={sections} />
      <Section id="snapshot-architecture" title="Architecture and relationships">
        <For each={props.diagrams}>
          {(diagram, index) => (
            <MermaidDiagram
              title={props.snapshot.diagrams?.[index()]?.title ?? "Retained relationships"}
              diagram={diagram}
              caption="Pre-rendered snapshot; source is available below."
            />
          )}
        </For>
        <Show when={!props.diagrams?.length}>
          <p>No diagram evidence was supplied.</p>
        </Show>
      </Section>
      <Section id="snapshot-findings" title="Retained findings">
        <FindingList findings={props.snapshot.findings} />
      </Section>
      <Section id="snapshot-checks" title="Check evidence">
        <div class="table-scroll" role="region" aria-label="Snapshot checks" tabIndex={0}>
          <table>
            <caption>Observed check results; missing evidence is not success.</caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Status</th>
                <th scope="col">Evidence</th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.snapshot.checks}>
                {(check) => (
                  <tr>
                    <th scope="row">{check.name}</th>
                    <td>{check.status.replaceAll("_", " ")}</td>
                    <td>{check.evidence ?? "Unavailable"}</td>
                    <td>{check.at ?? "Unavailable"}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={props.snapshot.checks.length === 0}>
          <p>No check evidence was supplied.</p>
        </Show>
      </Section>
      <Section id="snapshot-excerpts" title="Code and evidence excerpts">
        <For each={props.snapshot.excerpts}>
          {(excerpt) => (
            <>
              <CodePanel
                title={excerpt.title}
                text={excerpt.text}
                kind={excerpt.kind}
                provenance={excerpt.provenance}
              />
              <Show when={excerpt.reference}>
                {(reference) => <EvidenceReference reference={reference()} />}
              </Show>
            </>
          )}
        </For>
        <Show when={props.snapshot.excerpts.length === 0}>
          <p>No source excerpts were supplied.</p>
        </Show>
      </Section>
      <Section id="snapshot-timeline" title="Lifecycle snapshot">
        <StatusTimeline
          observedAt={props.snapshot.observed_at}
          provenance={props.snapshot.provenance}
          events={props.snapshot.events}
        />
      </Section>
      <Section id="snapshot-limitations" title="Limitations">
        <ul>
          <For each={props.snapshot.limitations}>{(limitation) => <li>{limitation}</li>}</For>
        </ul>
        <Show when={props.snapshot.limitations.length === 0}>
          <p>No limitations were supplied; their absence is not verification evidence.</p>
        </Show>
      </Section>
      <Section id="snapshot-feedback" title="Local review feedback">
        <FeedbackForm sections={sections} />
      </Section>
      <footer>AbraCode evidence snapshot · Read-only presentation</footer>
    </main>
  );
}
