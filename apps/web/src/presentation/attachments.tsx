import { ReviewAttachment, ReviewsForSource } from "./interactive-review-loader.tsx";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect HTTP atoms own shared generated-binding queries. */
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, type AtomRegistry, type Atom } from "effect/reactivity";
import { Option } from "effect";
import {
  bindingRequirements,
  type BindingSelection,
  type BindingCoverage,
} from "@abracode/contracts/web/bindings";
import type { SurfaceRecord } from "@abracode/contracts/web/contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import { useContext, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import { SessionId } from "@abracode/contracts/identities";
import { useCanvasRead } from "../canvas-refresh.tsx";
import { OpenSurface, type WorkspaceSearch } from "../navigation.ts";
import { Button } from "@abracode/presentation/ui/button";
import { deferred } from "../deferred.tsx";

import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
const WorkViews = deferred<
  ComponentProps<typeof import("@abracode/presentation/surfaces").WorkViews>
>(
  () => import("@abracode/presentation/surfaces").then((module) => ({ default: module.WorkViews })),
  "Generated view",
);
import { surfaceQuery, bindingQuery } from "../data.ts";
import { RequestState } from "../request-state.tsx";
import type { Inspect } from "@abracode/presentation/cards";
const SaveSurfaceButton = deferred<
  ComponentProps<typeof import("./save-surface.tsx").SaveSurfaceButton>
>(
  () => import("./save-surface.tsx").then((module) => ({ default: module.SaveSurfaceButton })),
  "Save view",
);

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
          <output key={entry.surface_id}>{entry.unavailable}</output>
        ) : "surface" in entry ? (
          <BoundSurface
            key={entry.surface.createSurface.surfaceId}
            record={entry}
            inspect={inspect}
          />
        ) : (
          <SurfaceAttachment
            expanded
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
  expanded = false,
  inspect,
}: {
  target: Extract<Target, { kind: "surface" }>;
  expanded?: boolean;
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
            <output className="error">{entry.unavailable}</output>
          ) : (
            <>
              {entry.history === "latest-only" && (
                <p className="muted">
                  Legacy layout: only the latest retained revision is available.
                </p>
              )}
              {expanded ? (
                <BoundSurface record={entry} inspect={inspect} />
              ) : (
                <SurfacePreview record={entry} inspect={inspect} />
              )}
            </>
          )
        }
      </RequestState>
    </div>
  );
}
function SurfacePreview({ record, inspect }: { record: SurfaceRecord; inspect: Inspect }) {
  const open = useContext(OpenSurface);
  const { components, surfaceId } = record.surface.createSurface;
  const rich =
    components.some((c) =>
      ["WorkTable", "Kanban", "Mermaid", "DependencyGraph", "Timeline"].some(
        (name) => name === c.component,
      ),
    ) || components.length > 5;
  const heading = components.find(
    (c) => c.component === "Text" && typeof c.text === "string",
  )?.text;
  return (
    <div className="surface-preview">
      {rich ? (
        <p>{typeof heading === "string" ? heading.slice(0, 180) : "Generated work view"}</p>
      ) : (
        <BoundSurface record={record} inspect={inspect} />
      )}
      <Button
        variant="outline"
        onClick={() =>
          open({
            session_id: SessionId.make(record.session_id),
            surface_id: surfaceId,
            revision: record.revision,
          })
        }
      >
        Open{" "}
        {components.some((c) => c.component === "WorkTable")
          ? "comparison"
          : components.some((c) => c.component === "Kanban")
            ? "board"
            : "view"}
      </Button>
    </div>
  );
}

export function ExactSurface({
  target,
  inspect,
}: {
  target: NonNullable<WorkspaceSearch["surface"]>;
  inspect: Inspect;
}) {
  return (
    <div data-surface-reference={target.surface_id + "/" + target.revision}>
      <RequestState query={surfaceQuery(target.surface_id, target.revision, target.session_id)}>
        {(entry) => {
          if ("unavailable" in entry) return <output>{entry.unavailable}</output>;
          if (
            entry.session_id !== target.session_id ||
            entry.revision !== target.revision ||
            entry.surface.createSurface.surfaceId !== target.surface_id
          )
            return <output>This exact layout is unavailable.</output>;
          const live = bindingRequirements(entry.surface, "live");
          return (
            <>
              <p className="muted">
                {live.unfiltered || live.ids.length
                  ? "Live widgets show current work. Snapshot widgets show captured values."
                  : "Captured layout and values."}
              </p>
              <BoundSurface record={entry} inspect={inspect} />
            </>
          );
        }}
      </RequestState>
    </div>
  );
}
function BoundSurface({ record, inspect }: { record: SurfaceRecord; inspect: Inspect }) {
  return (
    <>
      <BoundSurfaceContent record={record} inspect={inspect} />
      <ReviewsForSource
        source={{
          kind: "surface",
          surface_id: record.surface.createSurface.surfaceId,
          revision: record.revision,
        }}
      />
    </>
  );
}
function BoundSurfaceContent({ record, inspect }: { record: SurfaceRecord; inspect: Inspect }) {
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
function liveBindingStore(
  registry: AtomRegistry.AtomRegistry,
  query: ReturnType<typeof bindingQuery>,
) {
  // A lazy layout can render several times before it commits. Start its live
  // binding only when React subscribes so discarded renders never issue reads.
  let mounted = false;
  const pending: Atom.Type<typeof query> = AsyncResult.initial();
  return {
    subscribe: (notify: () => void) => {
      mounted = true;
      const release = registry.subscribe(query, notify);
      return () => {
        mounted = false;
        release();
      };
    },
    read: () => (mounted ? registry.get(query) : pending),
  };
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
  const query = bindingQuery(selection);
  const { refresh } = useCanvasRead(query);
  const registry = useContext(RegistryContext);
  const reader = useMemo(() => liveBindingStore(registry, query), [registry, query]);
  const result = useSyncExternalStore(reader.subscribe, reader.read);
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
    <>
      {AsyncResult.isFailure(result) && (
        <div role="alert">
          {previous ? "Showing the last successful binding." : "Live data unavailable."}{" "}
          <Button variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      <WorkViews
        records={[record]}
        work={previous?.work ?? []}
        liveCoverage={coverage}
        inspect={inspect}
        actions={(record) => <SaveSurfaceButton record={record} inspect={inspect} />}
      />
    </>
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
  if (target.kind === "review") return <ReviewAttachment target={target} />;
  if (target.kind === "surface")
    return <SurfaceAttachment target={target} work={work} inspect={inspect} />;
  return <ArtifactAttachment target={target} inspect={inspect} />;
}
const ArtifactAttachment = deferred<
  ComponentProps<typeof import("./artifact-attachment.tsx").ArtifactAttachment>
>(
  () =>
    import("./artifact-attachment.tsx").then((module) => ({ default: module.ArtifactAttachment })),
  "Report attachment",
);
