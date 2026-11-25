import { readRetained, writeRetained } from "../retained-input.ts";
import { useRef, useState } from "react";
import { useAtom } from "@effect/atom-react";
import { Exit, Schema } from "effect";
import { saveSurface } from "../data.ts";
import { SaveSurfaceSchema } from "@abracode/contracts/web/report-actions";
import { ArtifactSummarySchema } from "@abracode/contracts/web/wire";
import type { SurfaceRecord } from "@abracode/contracts/web/contracts";
import { IssueId, RequestId } from "@abracode/contracts/identities";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import type { Inspect } from "@abracode/presentation/cards";

const RetainedSave = Schema.Struct({
  input: SaveSurfaceSchema,
  result: Schema.optionalKey(ArtifactSummarySchema),
  attempted: Schema.optionalKey(Schema.Boolean),
});
type Attempt = typeof RetainedSave.Type;
/** A host artifact action, kept outside the reusable renderer and offline bundle. */
export function SaveSurfaceButton({
  record,
  inspect,
}: {
  record: SurfaceRecord;
  inspect: Inspect;
}) {
  const [selected, setIssue] = useState<string>();
  const issue =
    record.snapshot.find((item) => item.issue_id === selected)?.issue_id ??
    record.snapshot[0]?.issue_id;
  if (!issue) return <p className="muted">Saving requires a retained task with an execution.</p>;
  return (
    <div className="surface-save space-y-2">
      <NativeSelect
        aria-label="Save snapshot with task"
        value={issue}
        onChange={(event) => setIssue(event.target.value)}
      >
        {record.snapshot.map((work) => (
          <option key={work.issue_id} value={work.issue_id}>
            {work.title}
          </option>
        ))}
      </NativeSelect>
      <SaveAttempt
        key={`${record.session_id}/${record.surface.createSurface.surfaceId}/${record.revision}/${issue}`}
        record={record}
        issue={issue}
        inspect={inspect}
      />
    </div>
  );
}
function SaveAttempt({
  record,
  issue,
  inspect,
}: {
  record: SurfaceRecord;
  issue: string;
  inspect: Inspect;
}) {
  const key = `abra-report-save-${record.session_id}/${record.surface.createSurface.surfaceId}/${record.revision}/${issue}`;
  const makeInput = (): Attempt => ({
    input: {
      issue_id: IssueId.make(issue),
      request_id: RequestId.make(`report-${crypto.randomUUID()}`),
      surface_id: record.surface.createSurface.surfaceId,
      revision: record.revision,
    },
  });
  const [attempt, setAttempt] = useState<Attempt>(() => {
    const prior = readRetained(key, RetainedSave);
    if (
      prior &&
      prior.input.issue_id === issue &&
      prior.input.surface_id === record.surface.createSurface.surfaceId &&
      prior.input.revision === record.revision &&
      (!prior.result || prior.result.request_id === prior.input.request_id)
    )
      return prior;
    return makeInput();
  });
  const [state, invoke] = useAtom(saveSurface(attempt.input.request_id), { mode: "promiseExit" });
  const [failed, setFailed] = useState(!!attempt.attempted && !attempt.result);
  const [storageError, setStorageError] = useState(false);
  const submitting = useRef(false);
  const result = attempt.result;
  async function save() {
    if (submitting.current) return;
    if (!writeRetained(key, { ...attempt, attempted: true })) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    submitting.current = true;
    try {
      const response = await invoke(attempt.input);
      if (Exit.isSuccess(response) && response.value.request_id === attempt.input.request_id) {
        const next = { input: attempt.input, result: response.value, attempted: true };
        if (!writeRetained(key, next)) {
          setStorageError(true);
          setFailed(true);
          return;
        }
        setAttempt(next);
        setFailed(false);
      } else setFailed(true);
    } finally {
      submitting.current = false;
    }
  }
  return (
    <div className="space-y-2">
      <div className="button-row">
        {result?.hash && result.status === "published" ? (
          <>
            <Button
              variant="outline"
              onClick={() =>
                inspect({
                  action: "open_artifact",
                  issue_id: attempt.input.issue_id,
                  request_id: result.request_id,
                  hash: result.hash!,
                })
              }
            >
              Open saved report
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const next = makeInput();
                if (!writeRetained(key, next)) {
                  setStorageError(true);
                  return;
                }
                setStorageError(false);
                setAttempt(next);
                setFailed(false);
              }}
            >
              Save another snapshot
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={state.waiting}
            onClick={() => {
              void save();
            }}
          >
            {state.waiting ? "Saving snapshot…" : failed ? "Retry same save" : "Save snapshot"}
          </Button>
        )}
      </div>
      {storageError && (
        <output>
          Enable browser storage before saving this snapshot. Your selection is still open.
        </output>
      )}
      {failed && !storageError && (
        <output>
          Save was not confirmed. Retry the same request; a changed layout must be reopened before
          saving.
        </output>
      )}
      <p className="muted">
        Creates an immutable JSON report without asking Abra or advancing work.
      </p>
    </div>
  );
}
