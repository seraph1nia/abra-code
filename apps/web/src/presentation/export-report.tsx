import { useState } from "react";
import { ArrowUpRight } from "@abracode/presentation/icons";
import { useAtom } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { exportDocument } from "../data.ts";
import { IssueId, RequestId, ContentHash } from "@abracode/contracts/identities";
import { Button } from "@abracode/presentation/ui/button";
import { api } from "../api.ts";

/** Host action. Never imported by the pure frozen renderer or offline export. */
export function ExportReport(props: { issue: string; request: string; hash: string }) {
  return <ExportState key={`${props.issue}/${props.request}/${props.hash}`} {...props} />;
}
function ExportState({ issue, request, hash }: { issue: string; request: string; hash: string }) {
  const [preview, setPreview] = useState(false);
  const [state, invoke] = useAtom(exportDocument(`${issue}/${request}/${hash}`), {
    mode: "promiseExit",
  });
  const retained = AsyncResult.value(state);
  const result =
    Option.isSome(retained) && retained.value.document_hash === hash ? retained.value : undefined;
  return (
    <div className="report-export space-y-2">
      <Button
        id={"export-report-" + issue}
        variant="outline"
        disabled={state.waiting}
        onClick={() => {
          void invoke({
            issue_id: IssueId.make(issue),
            request_id: RequestId.make(request),
            hash: ContentHash.make(hash),
          });
        }}
      >
        {state.waiting ? "Exporting HTML…" : result ? "Verify HTML export" : "Export offline HTML"}
      </Button>
      {AsyncResult.isFailure(state) && (
        <output>
          HTML export was unavailable. The saved JSON remains available; retry uses the same
          document identity.
        </output>
      )}
      {result && (
        <>
          <a href={api.exportURL(issue, request, hash, result.exporter_hash, true)} download>
            Download exported HTML <ArrowUpRight aria-hidden="true" />
          </a>
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            {preview ? "Close HTML preview" : "Preview exported HTML"}
          </Button>
          <p className="muted">
            Portable snapshot · {result.bytes.toLocaleString()} bytes · local review feedback only.
          </p>
          {preview && (
            <iframe
              className="report-preview"
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
