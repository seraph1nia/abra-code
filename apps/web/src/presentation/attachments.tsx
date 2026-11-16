/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect HTTP atoms own shared generated-binding queries. */
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Option } from "effect";
import {
  bindingRequirements,
  type BindingSelection,
  type BindingCoverage,
} from "@abracode/contracts/web/bindings";
import type { SurfaceRecord } from "@abracode/contracts/web/contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import { useState, type ComponentProps } from "react";
import { deferred } from "../deferred.tsx";
const ReportDocumentView = deferred<
  ComponentProps<typeof import("@abracode/presentation/report-document").ReportDocumentView>
>(
  () =>
    import("@abracode/presentation/report-document").then((module) => ({
      default: module.ReportDocumentView,
    })),
  "Saved report",
);
import { api } from "../api.ts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
const WorkViews = deferred<
  ComponentProps<typeof import("@abracode/presentation/surfaces").WorkViews>
>(
  () => import("@abracode/presentation/surfaces").then((module) => ({ default: module.WorkViews })),
  "Generated view",
);
import { surfaceQuery, queries } from "../data.ts";
import { RequestState } from "../request-state.tsx";
import { ArtifactCard, type Inspect } from "@abracode/presentation/cards";
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
          <BoundSurface
            key={entry.surface.createSurface.surfaceId}
            record={entry}
            inspect={inspect}
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
  work: _work,
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
              <BoundSurface record={entry} inspect={inspect} />
            </>
          )
        }
      </RequestState>
    </div>
  );
}
function BoundSurface({ record, inspect }: { record: SurfaceRecord; inspect: Inspect }) {
  const selection = bindingRequirements(record.surface, "live");
  return selection.unfiltered || selection.ids.length ? (
    <LiveSurface record={record} inspect={inspect} selection={selection} />
  ) : (
    <WorkViews
      records={[record]}
      work={[]}
      inspect={inspect}
      actions={(record) => <SaveSurfaceButton record={record} inspect={inspect} />}
    />
  );
}
function LiveSurface({
  record,
  inspect,
  selection,
}: {
  record: SurfaceRecord;
  inspect: Inspect;
  selection: BindingSelection;
}) {
  const result = useAtomValue(queries.binding(selection));
  const value = AsyncResult.value(result);
  const previous = Option.isSome(value) ? value.value : undefined;
  const coverage: BindingCoverage = {
    ...(previous?.coverage ?? {
      population: "retained-work",
      requested_ids: [],
      returned: 0,
      unavailable_ids: [],
      truncated: selection.unfiltered,
    }),
    status: AsyncResult.isFailure(result)
      ? previous
        ? "stale"
        : "unavailable"
      : result.waiting && !previous
        ? "pending"
        : (previous?.coverage.status ?? "pending"),
  };
  return (
    <WorkViews
      records={[record]}
      work={previous?.work ?? []}
      liveCoverage={coverage}
      inspect={inspect}
      actions={(record) => <SaveSurfaceButton record={record} inspect={inspect} />}
    />
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
