import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { Input } from "@abracode/presentation/ui/input";
import { useState } from "react";
import { RelativePath, type IssueId } from "@abracode/contracts/identities";
import type { WorkDocumentSchema } from "@abracode/contracts/web/wire";
import { AskAbra } from "./ask-abra.tsx";

export function PlanPassage({
  issue,
  document,
  initial,
}: {
  initial?: { start: number; end: number };
  issue: IssueId;
  document: typeof WorkDocumentSchema.Type;
}) {
  const [start, setStart] = useState(initial?.start ?? 1),
    [end, setEnd] = useState(initial?.end ?? 1);
  const { hash, generation, path, content } = document;
  if (!hash || generation === undefined) return null;
  const lines = content.split("\n");
  const criteria = lines.flatMap((line, index) =>
    /^\s*(?:[-*]\s+|#{2,6}\s)/.test(line) ? [{ line: index + 1, text: line.trim() }] : [],
  );
  const valid =
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 1 &&
    start <= end &&
    end <= lines.length;
  const excerpt = valid ? lines.slice(start - 1, end).join("\n") : "";
  return (
    <details>
      <summary>Ask about a plan passage</summary>
      {criteria.length > 0 && (
        <label>
          Plan criterion{" "}
          <NativeSelect
            value={start === end && criteria.some((c) => c.line === start) ? start : ""}
            onChange={(e) => {
              if (e.target.value) {
                const line = Number(e.target.value);
                setStart(line);
                setEnd(line);
              }
            }}
          >
            <option value="">Choose a source line</option>
            {criteria.map((criterion) => (
              <option key={criterion.line} value={criterion.line}>
                {criterion.line} · {criterion.text}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <label>
        First plan line{" "}
        <Input
          type="number"
          min={1}
          max={lines.length}
          value={Number.isNaN(start) ? "" : start}
          onChange={(e) => {
            setStart(e.target.valueAsNumber);
            setEnd(Math.max(e.target.valueAsNumber, end));
          }}
        />
      </label>
      <label>
        Last plan line{" "}
        <Input
          type="number"
          min={start}
          max={lines.length}
          value={Number.isNaN(end) ? "" : end}
          onChange={(e) => setEnd(e.target.valueAsNumber)}
        />
      </label>
      <pre>{excerpt}</pre>
      <AskAbra
        selection={{
          kind: "plan",
          issue_id: issue,
          file: RelativePath.make(path),
          generation,
          hash,
          start,
          end,
        }}
        excerpt={excerpt}
        disabled={!valid || !excerpt.trim() || excerpt.length > 8192}
      />
    </details>
  );
}
