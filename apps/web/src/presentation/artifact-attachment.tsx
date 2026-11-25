import { useState, type ComponentProps } from "react";
import { ArrowUpRight } from "@abracode/presentation/icons";
import { ArtifactCard, type Inspect } from "@abracode/presentation/cards";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import { api } from "../api.ts";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";
import { deferred } from "@abracode/presentation/deferred";
import { ReviewsForSource } from "./interactive-review-loader.tsx";
type Target = typeof PresentationAttachmentSchema.Type.target;
const ReportDocumentView = deferred<
  ComponentProps<typeof import("@abracode/presentation/report-document").ReportDocumentView>
>(
  () =>
    import("@abracode/presentation/report-document").then((module) => ({
      default: module.ReportDocumentView,
    })),
  "Saved report",
);
export function ArtifactAttachment({
  target,
  inspect,
}: {
  target: Extract<Target, { kind: "artifact" }>;
  inspect: Inspect;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <RequestState query={queries.artifactSummary(target.issue_id, target.request_id, target.hash)}>
      {(artifact) => {
        return artifact.hash === target.hash ? (
          <div className="artifact-attachment">
            <ArtifactCard artifact={artifact} issue={target.issue_id} inspect={inspect} />
            <a href={api.documentURL(target.issue_id, target.request_id, target.hash)} download>
              Download JSON <ArrowUpRight aria-hidden="true" />
            </a>
            <details
              className="artifact-inline-preview"
              open={preview}
              onToggle={(event) => setPreview(event.currentTarget.open)}
            >
              <summary>Preview saved report</summary>
              {preview && (
                <RequestState
                  query={queries.artifactDocument(target.issue_id, target.request_id, target.hash)}
                >
                  {(body) =>
                    body.hash === target.hash ? (
                      <ReportDocumentView artifact={body} inspect={inspect} />
                    ) : (
                      <output>The document does not match this attachment.</output>
                    )
                  }
                </RequestState>
              )}
            </details>
            <ReviewsForSource
              issue={target.issue_id}
              source={{ kind: "report", request_id: target.request_id, hash: target.hash }}
            />
          </div>
        ) : (
          <output>
            This exact report receipt is unavailable. Other task reports remain available.
          </output>
        );
      }}
    </RequestState>
  );
}
