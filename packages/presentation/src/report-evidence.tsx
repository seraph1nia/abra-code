import { useId, useState } from "react";
import type {
  ReportSnapshot,
  SourceReference,
} from "@abracode/contracts/presentation/report-evidence";
import type { WorkProps } from "@abracode/contracts/web/catalog";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.tsx";
import { Badge } from "./ui/badge.tsx";
import { Input } from "./ui/input.tsx";
/** Supplied only by the trusted offline build, never by generated props or JSON. */
export type PreparedReportDiagram = { source: string; svg: string };

function Reference({ reference }: { reference: SourceReference }) {
  return (
    <dl className="report-reference">
      {reference.path && (
        <>
          <dt>Captured path</dt>
          <dd>
            <code>
              {reference.path}
              {reference.line ? `:${reference.line}` : ""}
            </code>
          </dd>
        </>
      )}
      {reference.commit && (
        <>
          <dt>Commit</dt>
          <dd>
            <code>{reference.commit}</code>
          </dd>
        </>
      )}
      {reference.url && (
        <>
          <dt>Evidence link</dt>
          <dd>
            <a href={reference.url} target="_blank" rel="noopener noreferrer">
              {reference.url}
            </a>
          </dd>
        </>
      )}
    </dl>
  );
}
/** Pure captured evidence. It never fetches or substitutes a current observation. */
export function ReportEvidence({
  section,
  snapshot,
  preparedDiagrams,
}: {
  section: WorkProps<"ReportEvidence">["section"];
  snapshot?: ReportSnapshot;
  preparedDiagrams?: readonly PreparedReportDiagram[];
}) {
  const [filter, setFilter] = useState("");
  const filterId = useId();
  if (!snapshot)
    return (
      <section className="report-evidence" data-report-section={section}>
        <p role="status">Captured report evidence is unavailable for this view.</p>
      </section>
    );
  const findings = snapshot.findings.filter((finding) =>
    `${finding.title} ${finding.category} ${finding.summary}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <section className="report-evidence space-y-3" data-report-section={section}>
      <p className="surface-binding">
        Captured report evidence · {new Date(snapshot.observed_at).toLocaleString()}
      </p>
      {section === "summary" && (
        <>
          <h2>{snapshot.title}</h2>
          <p>{snapshot.summary}</p>
          <Badge variant="secondary">{snapshot.status}</Badge>
          <details>
            <summary>Evidence & provenance</summary>
            <p>{snapshot.provenance}</p>
            <p>
              Task {snapshot.issue_id} · Execution {snapshot.execution_id}
            </p>
          </details>
        </>
      )}
      {section === "findings" && (
        <>
          <h3>Retained findings</h3>
          <label htmlFor={filterId}>Filter captured findings</label>
          <Input id={filterId} value={filter} onChange={(event) => setFilter(event.target.value)} />
          <p>
            {findings.length} of {snapshot.findings.length} findings
          </p>
          {findings.map((finding, index) => (
            <Card size="sm" key={index}>
              <CardHeader>
                <CardTitle>{finding.title}</CardTitle>
                <Badge variant="outline">{finding.category}</Badge>
              </CardHeader>
              <CardContent>
                <p>{finding.summary}</p>
                <details>
                  <summary>Captured evidence</summary>
                  <p>{finding.evidence}</p>
                  {finding.references.map((reference, i) => (
                    <Reference key={i} reference={reference} />
                  ))}
                </details>
              </CardContent>
            </Card>
          ))}
        </>
      )}
      {section === "checks" && (
        <>
          <h3>Check evidence</h3>
          <div
            className="work-table-scroll"
            role="region"
            aria-label="Captured checks"
            tabIndex={0}
          >
            <table className="work-table">
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
                {snapshot.checks.map((check, index) => (
                  <tr key={index}>
                    <th scope="row">{check.name}</th>
                    <td>{check.status.replaceAll("_", " ")}</td>
                    <td>{check.evidence ?? "Unavailable"}</td>
                    <td>
                      {check.at ? (
                        <time dateTime={check.at}>{new Date(check.at).toLocaleString()}</time>
                      ) : (
                        "Unavailable"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!snapshot.checks.length && <p>No captured check evidence.</p>}
        </>
      )}
      {section === "events" && (
        <>
          <h3>Captured lifecycle events</h3>
          <ol className="timeline">
            {[...snapshot.events]
              .sort(
                (a, b) =>
                  (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity),
              )
              .map((event, index) => (
                <li key={index}>
                  {event.at ? (
                    <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                  ) : (
                    <span>Observation time unavailable</span>
                  )}
                  <strong>{event.label}</strong>
                  <Badge variant="secondary">{event.status}</Badge>
                  {event.detail && <p>{event.detail}</p>}
                </li>
              ))}
          </ol>
          {!snapshot.events.length && <p>No captured lifecycle events.</p>}
        </>
      )}
      {section === "excerpts" && (
        <>
          <h3>Code and evidence excerpts</h3>
          {snapshot.excerpts.map((excerpt, index) => (
            <section key={index}>
              <h4>{excerpt.title}</h4>
              <p>{excerpt.provenance}</p>
              <pre className="report-code" tabIndex={0} aria-label={`${excerpt.kind} excerpt`}>
                <code>{excerpt.text}</code>
              </pre>
              {excerpt.reference && <Reference reference={excerpt.reference} />}
            </section>
          ))}
          {!snapshot.excerpts.length && <p>No captured source excerpts.</p>}
        </>
      )}
      {section === "limitations" && (
        <>
          <h3>Limitations</h3>
          <ul>
            {snapshot.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
          {!snapshot.limitations.length && (
            <p>No limitations were supplied; their absence is not verification evidence.</p>
          )}
        </>
      )}
      {section === "diagrams" && (
        <>
          <h3>Captured diagrams</h3>
          {snapshot.diagrams?.map((diagram, index) => (
            <figure
              key={index}
              data-diagram-state={
                preparedDiagrams?.some((prepared) => prepared.source === diagram.source)
                  ? "ready"
                  : "source"
              }
            >
              {preparedDiagrams
                ?.filter((prepared) => prepared.source === diagram.source)
                .map((prepared) => (
                  <div
                    key={prepared.source}
                    className="diagram-scroll"
                    role="img"
                    aria-label={diagram.title}
                    tabIndex={0}
                    dangerouslySetInnerHTML={{ __html: prepared.svg }}
                  />
                ))}
              <details>
                <summary>{diagram.title}</summary>
                <p>
                  {preparedDiagrams?.some((prepared) => prepared.source === diagram.source)
                    ? "Captured Mermaid source used for the prepared rendering."
                    : "Captured Mermaid source. A prepared rendering is available in an explicit HTML export."}
                </p>
                <pre className="report-code" tabIndex={0} aria-label="Diagram source">
                  <code>{diagram.source}</code>
                </pre>
              </details>
            </figure>
          ))}
          {!snapshot.diagrams?.length && <p>No diagram evidence was supplied.</p>}
        </>
      )}
    </section>
  );
}
