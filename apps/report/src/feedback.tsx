import { useId, useRef, useState } from "react";
import { Button } from "@abracode/presentation/ui/button";
import { Textarea } from "@abracode/presentation/ui/textarea";
import { NativeSelect } from "@abracode/presentation/ui/native-select";

const quote = (text: string) =>
  (text || "None supplied")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
/** Local review input only: no native client, storage, prompt or approval capability. */
export function FeedbackForm({ sections }: { sections: readonly string[] }) {
  const id = useId(),
    outputRef = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState(""),
    [changes, setChanges] = useState(""),
    [questions, setQuestions] = useState(""),
    [section, setSection] = useState(""),
    [severity, setSeverity] = useState("comment"),
    [output, setOutput] = useState("");
  const prepare = (format: "Markdown" | "JSON") => {
    const feedback = {
      schema_version: 1,
      kind: "report-feedback",
      authority: "review-input-only",
      prepared_at: new Date().toISOString(),
      section,
      severity,
      comments,
      suggested_changes: changes,
      questions,
    };
    setOutput(
      format === "JSON"
        ? JSON.stringify(feedback, null, 2)
        : `# Offline report feedback\n\nReview input only. This export does not approve work or authorize workflow changes.\n\nPrepared locally: ${feedback.prepared_at}\n\nSeverity: ${severity}\n\nAffected section:\n${quote(section)}\n\n## General comments\n${quote(comments)}\n\n## Suggested changes\n${quote(changes)}\n\n## Questions\n${quote(questions)}\n`,
    );
  };
  return (
    <form className="portable-feedback" onSubmit={(event) => event.preventDefault()}>
      <h2>Local review feedback</h2>
      <p>Review input only. Export before closing; these fields remain local to this page.</p>
      <div>
        <label htmlFor={`${id}-comments`}>General comments</label>
        <Textarea
          id={`${id}-comments`}
          maxLength={8192}
          value={comments}
          onChange={(event) => setComments(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-severity`}>Finding severity</label>
        <NativeSelect
          id={`${id}-severity`}
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          {["comment", "suggestion", "warning", "critical"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <label htmlFor={`${id}-section`}>Affected section</label>
        <NativeSelect
          id={`${id}-section`}
          value={section}
          onChange={(event) => setSection(event.target.value)}
        >
          <option value="">General report</option>
          {sections.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <label htmlFor={`${id}-changes`}>Suggested changes</label>
        <Textarea
          id={`${id}-changes`}
          maxLength={8192}
          value={changes}
          onChange={(event) => setChanges(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-questions`}>Questions</label>
        <Textarea
          id={`${id}-questions`}
          maxLength={8192}
          value={questions}
          onChange={(event) => setQuestions(event.target.value)}
        />
      </div>
      <div className="feedback-buttons">
        <Button type="button" variant="outline" onClick={() => prepare("Markdown")}>
          Prepare Markdown
        </Button>
        <Button type="button" variant="outline" onClick={() => prepare("JSON")}>
          Prepare JSON
        </Button>
      </div>
      {output && (
        <>
          <output>Prepared locally. Copy the text to share review input.</output>
          <div>
            <label htmlFor={`${id}-output`}>Feedback export</label>
            <Textarea id={`${id}-output`} ref={outputRef} readOnly rows={14} value={output} />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              outputRef.current?.focus();
              outputRef.current?.select();
            }}
          >
            Select export
          </Button>
        </>
      )}
    </form>
  );
}
