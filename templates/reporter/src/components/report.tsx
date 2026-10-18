import { type SourceReference } from "../snapshot-data.ts";
import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from "solid-js";

export type Finding = {
  title: string;
  category: string;
  summary: string;
  evidence: string;
  source?: { label: string; href: string };
  references?: readonly SourceReference[];
};

/** Evidence links navigate only on a reader's explicit action. */
export function evidenceHref(value: string): string | undefined {
  if (/^#[A-Za-z][\w-]*$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function ReportHeader(props: {
  eyebrow: string;
  title: string;
  summary: string;
  labels?: readonly string[];
  observedAt?: string;
}) {
  return (
    <header class="report-header">
      <p class="eyebrow">{props.eyebrow}</p>
      <h1>{props.title}</h1>
      <p class="lede">{props.summary}</p>
      <Show when={props.observedAt}>
        {(at) => (
          <p class="snapshot-time">
            Snapshot observed: <time dateTime={at()}>{at()}</time>. This is a static snapshot.
          </p>
        )}
      </Show>
      <div class="meta">
        <For each={props.labels}>{(label) => <span>{label}</span>}</For>
      </div>
    </header>
  );
}

export function SectionNavigation(props: { sections: readonly { id: string; title: string }[] }) {
  return (
    <nav class="section-nav" aria-label="Report sections">
      <For each={props.sections}>{(section) => <a href={`#${section.id}`}>{section.title}</a>}</For>
    </nav>
  );
}

export function Section(props: {
  id: string;
  title: string;
  aside?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section id={props.id} aria-labelledby={`${props.id}-title`}>
      <div class="section-heading">
        <h2 id={`${props.id}-title`}>{props.title}</h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

export function EvidenceReference(props: { reference: SourceReference }) {
  const url = () => props.reference.url && evidenceHref(props.reference.url);
  return (
    <dl class="source-reference">
      <dt>Source path</dt>
      <dd>
        <code>{props.reference.path ?? "Unavailable"}</code>
        <Show when={props.reference.line}>:{props.reference.line}</Show>
      </dd>
      <dt>Commit</dt>
      <dd>
        <code>{props.reference.commit ?? "Unavailable"}</code>
      </dd>
      <Show when={url()}>
        {(href) => (
          <>
            <dt>Evidence link</dt>
            <dd>
              <a href={href()}>{href()}</a>
            </dd>
          </>
        )}
      </Show>
    </dl>
  );
}

function EvidenceDisclosure(props: { finding: Finding }) {
  const href = () => props.finding.source && evidenceHref(props.finding.source.href);
  return (
    <details>
      <summary>Read evidence</summary>
      <p>{props.finding.evidence}</p>
      <Show
        when={href()}
        fallback={
          <Show when={!props.finding.references?.length}>
            <p>Source reference unavailable.</p>
          </Show>
        }
      >
        {(url) => (
          <a href={url()}>
            {props.finding.source!.label} <span aria-hidden="true">↗</span>
          </a>
        )}
      </Show>
      <For each={props.finding.references}>
        {(reference) => <EvidenceReference reference={reference} />}
      </For>
    </details>
  );
}

export function EvidenceCard(props: { finding: Finding }) {
  return (
    <article class="finding">
      <span class="tag">{props.finding.category}</span>
      <h3>{props.finding.title}</h3>
      <p>{props.finding.summary}</p>
      <EvidenceDisclosure finding={props.finding} />
    </article>
  );
}

export function FindingList(props: { findings: readonly Finding[]; label?: string }) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [view, setView] = createSignal<"cards" | "table">("cards");
  const visible = createMemo(() => {
    const term = query().trim().toLowerCase();
    return props.findings.filter((f) =>
      `${f.title} ${f.category} ${f.summary} ${f.evidence}`.toLowerCase().includes(term),
    );
  });
  return (
    <>
      <p class="finding-count" aria-live="polite">
        {visible().length} of {props.findings.length} shown
      </p>
      <label for={id}>{props.label ?? "Filter findings"}</label>
      <input
        id={id}
        type="search"
        placeholder="Try delivery or evidence…"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <div class="view-controls" role="group" aria-label="Finding view">
        <button type="button" aria-pressed={view() === "cards"} onClick={() => setView("cards")}>
          Cards
        </button>
        <button type="button" aria-pressed={view() === "table"} onClick={() => setView("table")}>
          Table
        </button>
      </div>
      <Show
        when={view() === "cards"}
        fallback={
          <div class="table-scroll" role="region" aria-label="Findings table" tabIndex={0}>
            <table>
              <caption>Filtered findings and their evidence</caption>
              <thead>
                <tr>
                  <th scope="col">Finding</th>
                  <th scope="col">Category</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                <For each={visible()}>
                  {(finding) => (
                    <tr class="finding-row">
                      <th scope="row">
                        {finding.title}
                        <p>{finding.summary}</p>
                      </th>
                      <td>{finding.category}</td>
                      <td>
                        <EvidenceDisclosure finding={finding} />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        }
      >
        <div class="findings">
          <For each={visible()}>{(finding) => <EvidenceCard finding={finding} />}</For>
        </div>
      </Show>
      <Show when={visible().length === 0}>
        <p class="empty">No findings match. Try a different search.</p>
      </Show>
    </>
  );
}

export function CodePanel(props: {
  title: string;
  text: string;
  kind?: "code" | "diff";
  provenance: string;
}) {
  return (
    <figure class={`code-panel ${props.kind ?? "code"}`}>
      <figcaption>
        <strong>{props.title}</strong>
        <p>{props.provenance}</p>
      </figcaption>
      <pre tabIndex={0} aria-label={props.title}>
        <code>{props.text}</code>
      </pre>
    </figure>
  );
}

export function StatusTimeline(props: {
  observedAt: string;
  provenance: string;
  events: readonly { label: string; status: string; at?: string; detail?: string }[];
}) {
  return (
    <div class="status-timeline">
      <p>
        Snapshot observed: <time dateTime={props.observedAt}>{props.observedAt}</time>
      </p>
      <p>{props.provenance}</p>
      <ol>
        <For each={props.events}>
          {(event) => (
            <li>
              <div>
                <strong>{event.label}</strong>
                <span class="tag">{event.status}</span>
              </div>
              <Show when={event.at} fallback={<span>Time unavailable</span>}>
                {(at) => <time dateTime={at()}>{at()}</time>}
              </Show>
              <Show when={event.detail}>
                <p>{event.detail}</p>
              </Show>
            </li>
          )}
        </For>
      </ol>
      <Show when={props.events.length === 0}>
        <p>No lifecycle evidence was supplied.</p>
      </Show>
    </div>
  );
}
