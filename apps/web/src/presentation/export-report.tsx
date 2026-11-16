/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect atoms isolate explicit export requests. */
import { useState } from "react";
import { useAtom } from "@effect/atom-react";
import { Exit } from "effect";
import { exportDocument } from "../data.ts";
import { IssueId, RequestId, ContentHash } from "../../../../src/identities.ts";
import type { ReportExportSchema } from "../../../../src/presentation/report-export-contract.ts";
import { Button } from "../components/ui/button.tsx";
import { api } from "../api.ts";

/** Host action. Never imported by the pure frozen renderer or offline export. */
export function ExportReport({
  issue,
  request,
  hash,
}: {
  issue: string;
  request: string;
  hash: string;
}) {
  const [result, setResult] = useState<typeof ReportExportSchema.Type>();
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const [, invoke] = useAtom(exportDocument(`${issue}/${request}/${hash}`), {
    mode: "promiseExit",
  });
  return (
    <div className="report-export space-y-2">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const exit = await invoke({
              issue_id: IssueId.make(issue),
              request_id: RequestId.make(request),
              hash: ContentHash.make(hash),
            });
            if (Exit.isSuccess(exit)) setResult(exit.value);
            else setError(true);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Exporting HTML…" : result ? "Verify HTML export" : "Export offline HTML"}
      </Button>
      {error && (
        <p role="status">
          HTML export was unavailable. The saved JSON remains available; retry uses the same
          document identity.
        </p>
      )}
      {result && (
        <>
          <a href={api.exportURL(issue, request, hash, result.exporter_hash, true)} download>
            Download exported HTML ↗
          </a>
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            {preview ? "Close HTML preview" : "Preview exported HTML"}
          </Button>
          <p className="muted">
            Portable snapshot · {result.bytes.toLocaleString()} bytes · local review feedback only.
          </p>
          {preview && (
            <iframe
              title="Offline HTML export"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              src={api.exportURL(issue, request, hash, result.exporter_hash)}
            />
          )}
        </>
      )}
    </div>
  );
}
