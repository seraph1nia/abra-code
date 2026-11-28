import type { PlanBrief } from "@abracode/contracts/visibility/document-contracts";
import { Markdown } from "../markdown.tsx";

export function PlanBriefView({ brief }: { brief: PlanBrief }) {
  const current = brief.sections.length ? (
    brief.sections.map((section) => (
      <section key={section.title}>
        <h3>{section.title}</h3>
        <Markdown className="prose" content={section.text} mode="static" />
      </section>
    ))
  ) : (
    <p>This revision has no recorded brief. Open the proposal for its full scope.</p>
  );
  return (
    <article className="inspector-stack" aria-label="Plan brief">
      {brief.previous ? (
        <>
          <section>
            <h3>What changed</h3>
            <Markdown
              className="prose"
              content={brief.changes ?? "Comparison unavailable."}
              mode="static"
            />
          </section>
          <section>
            <h3>Why it matters</h3>
            <Markdown
              className="prose"
              content={
                brief.significance ?? "The plan does not record the significance of this revision."
              }
              mode="static"
            />
          </section>
          <details>
            <summary>Full current brief</summary>
            {current}
          </details>
        </>
      ) : (
        <>
          {brief.revised && <p>The preceding plan brief is unavailable for comparison.</p>}
          {current}
        </>
      )}
    </article>
  );
}
