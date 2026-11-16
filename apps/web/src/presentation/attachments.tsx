import type { PresentationAttachmentSchema } from "../../../../src/presentation/contracts.ts";
import { useState } from "react";
import { ReportDocumentView } from "./report-document.tsx";
import { api } from "../api.ts";
import type { WebWorkItem } from "../../../../src/web/wire.ts";
import type { WorkspaceSnapshot } from "../../../../src/web/contracts.ts";
import { WorkViews } from "../surfaces.tsx";
import { surfaceQuery, queries } from "../data.ts";
import { RequestState } from "../request-state.tsx";
import { ArtifactCard, type Inspect } from "./cards.tsx";
import { SaveSurfaceButton } from "./save-surface.tsx";

type Target = typeof PresentationAttachmentSchema.Type.target;
export function RetainedSurfaces({
  entries,
  work,
  inspect,
}: {
  entries: WorkspaceSnapshot["surfaces"];
  work: readonly WebWorkItem[];
  inspect: Inspect;
}) {
  return (
    <>
      {entries.map((entry) =>
        "unavailable" in entry ? (
          <p role="status" key={entry.surface_id}>
            {entry.unavailable}
          </p>
        ) : "surface" in entry ? (
          <WorkViews
            key={entry.surface.createSurface.surfaceId}
            records={[entry]}
            work={work}
            inspect={inspect}
            actions={(record) => <SaveSurfaceButton record={record} inspect={inspect} />}
          />
        ) : (
          <SurfaceAttachment
            key={`${entry.surface_id}/${entry.revision}`}
            target={{ kind: "surface", surface_id: entry.surface_id, revision: entry.revision }}
            work={work}
            inspect={inspect}
          />
        ),
      )}
    </>
  );
}
export function SurfaceAttachment({
  target,
  work,
  inspect,
}: {
  target: Extract<Target, { kind: "surface" }>;
  work: readonly WebWorkItem[];
  inspect: Inspect;
}) {
  return (
    <div
      className="inline-surface"
      data-surface-reference={`${target.surface_id}/${target.revision}`}
    >
      <RequestState query={surfaceQuery(target.surface_id, target.revision)}>
        {(entry) =>
          "unavailable" in entry ? (
            <p role="status" className="error">
              {entry.unavailable}
            </p>
          ) : (
            <>
              {entry.history === "latest-only" && (
                <p className="muted">
                  Legacy layout: only the latest retained revision is available.
                </p>
              )}
              <WorkViews
                records={[entry]}
                work={work}
                inspect={inspect}
                actions={(record) => <SaveSurfaceButton record={record} inspect={inspect} />}
              />
            </>
          )
        }
      </RequestState>
    </div>
  );
}
export function MessageAttachment({
  attachment,
  work,
  inspect,
}: {
  attachment: typeof PresentationAttachmentSchema.Type;
  work: readonly WebWorkItem[];
  inspect: Inspect;
}) {
  const target = attachment.target;
  if (target.kind === "surface")
    return <SurfaceAttachment target={target} work={work} inspect={inspect} />;
  return <ArtifactAttachment target={target} inspect={inspect} />;
}
function ArtifactAttachment({
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
            <a
              href={
                artifact.format === "a2ui-snapshot"
                  ? api.documentURL(target.issue_id, target.request_id, target.hash)
                  : api.reportURL(target.issue_id, target.request_id, true)
              }
              download
            >
              {artifact.format === "a2ui-snapshot" ? "Download JSON ↗" : "Download HTML ↗"}
            </a>
            <details
              className="artifact-inline-preview"
              open={preview}
              onToggle={(event) => setPreview(event.currentTarget.open)}
            >
              <summary>Preview saved report</summary>
              {preview &&
                (artifact.format === "a2ui-snapshot" ? (
                  <RequestState
                    query={queries.artifactDocument(
                      target.issue_id,
                      target.request_id,
                      target.hash,
                    )}
                  >
                    {(body) =>
                      body.hash === target.hash ? (
                        <ReportDocumentView artifact={body} inspect={inspect} />
                      ) : (
                        <p role="status">The document does not match this attachment.</p>
                      )
                    }
                  </RequestState>
                ) : (
                  <iframe
                    title="Isolated retained report preview"
                    className="report-preview"
                    sandbox="allow-scripts"
                    src={api.reportURL(target.issue_id, target.request_id)}
                  />
                ))}
            </details>
          </div>
        ) : (
          <p role="status">
            This exact report receipt is unavailable. Other task reports remain available.
          </p>
        );
      }}
    </RequestState>
  );
}
