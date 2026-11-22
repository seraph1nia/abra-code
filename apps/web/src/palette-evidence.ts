import { useState } from "react";
import type { EvidenceKind } from "@abracode/contracts/visibility/discovery-contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type { WorkspaceSearch } from "./navigation.ts";
import { WorkspaceApi } from "./data.ts";
import { type Hit, useSource, sourceFeedback } from "./palette-source.ts";

export function useEvidenceSource(
  active: boolean,
  input: string,
  query: string,
  evidenceKind: EvidenceKind | undefined,
  go: (target: ResourceSelection) => void,
  reader: (search: WorkspaceSearch) => void,
) {
  const [page, setPage] = useState<{
    forInput: string;
    after_owner: string;
    after_entry: string;
  }>();
  const cursor =
    page?.forInput === input
      ? { after_owner: page.after_owner, after_entry: page.after_entry }
      : {};
  const evidence = useSource(active, () =>
    WorkspaceApi.query("work", "evidenceSearch", {
      query: { search: query, kind: evidenceKind, ...cursor },
      timeToLive: "0 seconds",
    }),
  );
  const hits: Hit[] = (evidence.data?.entries ?? []).map((row) => {
    const { repository_id, issue_id, kind, identity } = row;
    const owner = [repository_id, issue_id, kind, identity].join("/");
    return {
      id: "evidence/" + owner,
      source: "evidence",
      identity: owner,
      label: row.label,
      detail: kind + " · " + row.context,
      effect: "Open",
      run: () =>
        row.resource
          ? go(row.resource)
          : reader({ retained: { kind, issue_id, repository_id, identity } }),
    };
  });
  const { more, status, report } = sourceFeedback();
  report("Retained evidence", evidence);
  if (evidence.data) status.push(...evidence.data.coverage);
  const next = evidence.data?.next;
  if (next) {
    status.push("More retained evidence is available.");
    more.push({
      id: "more-evidence",
      label: "Search next retained evidence page",
      keepOpen: true,
      run: () => setPage({ forInput: input, ...next }),
    });
  }
  return { hits, more, status, reset: () => setPage(undefined) };
}
