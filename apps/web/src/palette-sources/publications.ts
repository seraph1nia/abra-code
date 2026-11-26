import { useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { WorkspaceApi } from "../data.ts";
import { reviewListQuery } from "../review-data.ts";
import type { WorkspaceSearch } from "../navigation.ts";
import { paletteHits, useSource, sourceFeedback, type Source } from "../palette-source.ts";

export function usePublicationSource(
  input: string,
  query: string,
  filter: Source | undefined,
  activeExplicit: (s: Source) => boolean,
  current: WorkspaceSnapshot | undefined,
  reader: (search: WorkspaceSearch) => void,
) {
  const { hits, add } = paletteHits();
  const { more, status, report } = sourceFeedback();
  const [publicationPage, setPublicationPage] = useState<{
    forInput: string;
    session: string;
    cursor: string;
  }>();
  const pubs = useSource(!!current && (activeExplicit("surface") || activeExplicit("review")), () =>
    WorkspaceApi.query("workspace", "publications", {
      query: {
        search: query,
        kind: filter === "surface" || filter === "review" ? filter : undefined,
        cursor:
          publicationPage?.session === current?.session_id && publicationPage?.forInput === input
            ? publicationPage.cursor
            : undefined,
      },
      reactivityKeys: ["publications/" + current?.session_id],
      timeToLive: "15 seconds",
    }),
  );
  const reviews = useSource(activeExplicit("review"), () => reviewListQuery());
  for (const row of reviews.data?.reviews ?? [])
    add(
      "review",
      row.review_id + "/" + row.revision,
      row.title,
      "Interactive review · " + row.hash,
      "Open",
      () => reader({ review: { review_id: row.review_id, revision: row.revision } }),
    );
  for (const row of current?.surfaces ?? [])
    if (!("unavailable" in row) && current) {
      const id = "surface" in row ? row.surface.createSurface.surfaceId : row.surface_id;
      add(
        "surface",
        id + "/" + row.revision,
        id,
        "Generated view · revision " + row.revision,
        "Open",
        () =>
          reader({
            surface: { session_id: current.session_id, surface_id: id, revision: row.revision },
          }),
      );
    }
  const confirmedPublications = new Set<string>();
  for (const entry of pubs.data?.entries ?? []) {
    if (entry.session_id !== current?.session_id) continue;
    if (entry.target.kind === "surface")
      confirmedPublications.add("surface/" + entry.target.surface_id + "/" + entry.target.revision);
    if (entry.target.kind === "review")
      confirmedPublications.add("review/" + entry.target.review_id + "/" + entry.target.revision);
    const t = entry.target;
    if (t.kind === "surface")
      add(
        "surface",
        t.surface_id + "/" + t.revision,
        t.surface_id,
        "Published revision " + t.revision + " · " + entry.message_id,
        "Open",
        () =>
          reader({
            surface: {
              session_id: entry.session_id,
              surface_id: t.surface_id,
              revision: t.revision,
            },
          }),
      );
    if (t.kind === "review")
      add(
        "review",
        t.review_id + "/" + t.revision,
        t.review_id,
        "Published revision " + t.revision + " · " + entry.message_id,
        "Open",
        () => reader({ review: { review_id: t.review_id, revision: t.revision } }),
      );
  }
  report("Publications", pubs);
  if (pubs.data?.incomplete) status.push("Some retained publication associations are unavailable.");
  const publicationNext = pubs.data?.next;
  if (publicationNext && current)
    more.push({
      id: "more-publications",
      label: "Search next publication page",
      keepOpen: true,
      run: () =>
        setPublicationPage({
          forInput: input,
          session: current.session_id,
          cursor: publicationNext,
        }),
    });
  report("Interactive reviews", reviews);
  if (reviews.data) status.push(...reviews.data.diagnostics);
  return { hits, more, status, confirmedPublications, reset: () => setPublicationPage(undefined) };
}
