import { createSignal, createUniqueId, For, Show } from "solid-js";

type Feedback = {
  schema_version: 1;
  kind: "report-feedback";
  authority: "review-input-only";
  prepared_at: string;
  section: string;
  severity: string;
  comments: string;
  suggested_changes: string;
  questions: string;
};
const quote = (text: string) =>
  (text || "None supplied")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
function markdown(feedback: Feedback) {
  return `# Offline report feedback\n\nReview input only. This export does not approve work or authorize workflow changes.\n\nPrepared locally: ${feedback.prepared_at}\n\nSeverity: ${feedback.severity}\n\nAffected section:\n${quote(feedback.section)}\n\n## General comments\n${quote(feedback.comments)}\n\n## Suggested changes\n${quote(feedback.suggested_changes)}\n\n## Questions\n${quote(feedback.questions)}\n`;
}

/** Local presentation state only; no storage, network, session or approval API. */
export function FeedbackForm(props: { sections: readonly { id: string; title: string }[] }) {
  const id = createUniqueId();
  const [comments, setComments] = createSignal("");
  const [section, setSection] = createSignal("");
  const [severity, setSeverity] = createSignal("comment");
  const [changes, setChanges] = createSignal("");
  const [questions, setQuestions] = createSignal("");
  const [output, setOutput] = createSignal("");
  const [format, setFormat] = createSignal("Markdown");
  let exported: HTMLTextAreaElement | undefined;
  const prepare = (kind: "Markdown" | "JSON") => {
    const feedback: Feedback = {
      schema_version: 1,
      kind: "report-feedback",
      authority: "review-input-only",
      prepared_at: new Date().toISOString(),
      section: section(),
      severity: severity(),
      comments: comments(),
      suggested_changes: changes(),
      questions: questions(),
    };
    setFormat(kind);
    setOutput(kind === "JSON" ? JSON.stringify(feedback, null, 2) : markdown(feedback));
  };
  return (
    <form class="feedback-form" onSubmit={(event) => event.preventDefault()}>
      <p>
        Review input only. Feedback does not approve work or change workflow state. Export before
        closing or switching examples; this form keeps only local view state.
      </p>
      <label>
        General comments
        <textarea
          maxLength={8192}
          value={comments()}
          onInput={(event) => setComments(event.currentTarget.value)}
        />
      </label>
      <div class="feedback-fields">
        <div>
          <label for={`${id}-severity`}>Finding severity</label>
          <select
            id={`${id}-severity`}
            value={severity()}
            onChange={(event) => setSeverity(event.currentTarget.value)}
          >
            <option value="comment">Comment</option>
            <option value="suggestion">Suggestion</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label for={`${id}-section`}>Affected section</label>
          <select
            id={`${id}-section`}
            value={section()}
            onChange={(event) => setSection(event.currentTarget.value)}
          >
            <option value="">General report</option>
            <For each={props.sections}>
              {(item) => <option value={item.id}>{item.title}</option>}
            </For>
          </select>
        </div>
      </div>
      <label>
        Suggested changes
        <textarea
          maxLength={8192}
          value={changes()}
          onInput={(event) => setChanges(event.currentTarget.value)}
        />
      </label>
      <label>
        Questions
        <textarea
          maxLength={8192}
          value={questions()}
          onInput={(event) => setQuestions(event.currentTarget.value)}
        />
      </label>
      <div class="view-controls" role="group" aria-label="Prepare feedback export">
        <button type="button" onClick={() => prepare("Markdown")}>
          Prepare Markdown
        </button>
        <button type="button" onClick={() => prepare("JSON")}>
          Prepare JSON
        </button>
      </div>
      <Show when={output()}>
        <div class="feedback-export">
          <p role="status">
            {format()} prepared locally. Select the text below and copy it to share review input.
          </p>
          <label>
            Feedback export
            <textarea
              ref={(element) => {
                exported = element;
              }}
              readOnly
              value={output()}
              rows={14}
            />
          </label>
          <div class="view-controls">
            <button
              type="button"
              onClick={() => {
                exported?.focus();
                exported?.select();
              }}
            >
              Select export
            </button>
          </div>
        </div>
      </Show>
    </form>
  );
}
