import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { RepositoryId } from "@abracode/contracts/identities";
import { WorkspaceApi, memoryEnabledQuery, repositoriesQuery } from "./data.ts";
import { type Hit, useSource, sourceFeedback } from "./palette-source.ts";
import { RequestState } from "./request-state.tsx";
import type { MemoryReference } from "@abracode/contracts/visibility/memory";
import { Button } from "@abracode/presentation/ui/button";

const memoryReferenceKey = (reference: MemoryReference) =>
  `${reference.scope.kind === "shared" ? "shared" : reference.scope.repository_id}:${reference.path}:${reference.revision}`;

export function useMemorySource(active: boolean, filtered: boolean, query: string) {
  const enabled = useAtomValue(memoryEnabledQuery);
  const memoryAvailable = AsyncResult.isSuccess(enabled) && enabled.value;
  const [repository, setRepository] = useState<RepositoryId>();
  const [memoryCursor, setMemoryCursor] = useState<string>();
  const [note, setNote] = useState<MemoryReference>();
  const memoryRepo = filtered ? repository : undefined;
  const memory = useSource(memoryAvailable && active && !!query && !note, () =>
    WorkspaceApi.query("workspace", "memorySearch", {
      query: { query, repository_id: memoryRepo, cursor: memoryCursor },
      timeToLive: "0 seconds",
    }),
  );
  const repos = useSource(memoryAvailable && filtered, () => repositoriesQuery);
  const hits: Hit[] = [];
  for (const { reference, title, excerpt } of memory.data?.entries ?? []) {
    const scope =
      reference.scope.kind === "shared" ? "All projects" : reference.scope.repository_id;
    hits.push({
      id: "memory/" + memoryReferenceKey(reference),
      source: "memory",
      identity: reference.path,
      label: title,
      detail: scope + " · " + excerpt,
      effect: "Open",
      keepOpen: true,
      run: () => setNote(reference),
    });
  }
  const { more, status, report } = sourceFeedback();
  report("Memory", memory);
  if (filtered && !query && memoryAvailable) status.push("Enter a term to search memory.");
  if (filtered && AsyncResult.isSuccess(enabled) && !enabled.value)
    status.push("Enable Basic Memory in personal settings to search notes.");
  if (filtered && AsyncResult.isFailure(enabled)) status.push("Memory settings are unavailable.");
  if (memory.data?.next_cursor)
    more.push({
      id: "more-memory",
      label: "Search next memory page",
      keepOpen: true,
      run: () => setMemoryCursor(memory.data?.next_cursor),
    });
  report("Repositories", repos);
  function reset() {
    setNote(undefined);
    setMemoryCursor(undefined);
  }
  const controls = memoryAvailable && filtered && (
    <label className="px-3 pt-2 text-sm">
      Memory scope{" "}
      <select
        aria-label="Memory scope"
        value={repository ?? ""}
        onChange={(event) => {
          setRepository(event.target.value ? RepositoryId.make(event.target.value) : undefined);
          reset();
        }}
      >
        <option value="">All projects · shared notes</option>
        {repos.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} + shared notes
          </option>
        ))}
      </select>
    </label>
  );
  const reader = note && (
    <MemoryNote
      key={memoryReferenceKey(note)}
      reference={note}
      repository={memoryRepo}
      back={() => setNote(undefined)}
    />
  );
  return { hits, status, more, available: memoryAvailable, controls, reader, reset };
}
function MemoryNote({
  reference,
  repository,
  back,
}: {
  reference: MemoryReference;
  repository?: RepositoryId;
  back: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const atom = WorkspaceApi.query("workspace", "memoryRead", {
    payload: { reference, repository_id: repository, offset },
    timeToLive: "0 seconds",
  });
  return (
    <section aria-label="Memory note" className="min-h-0 overflow-y-auto p-3 text-sm">
      <Button variant="ghost" onClick={back}>
        Back to results
      </Button>
      <p className="break-all">
        {reference.scope.kind === "shared" ? "Shared" : reference.scope.repository_id} ·{" "}
        {reference.path} · {reference.revision}
      </p>
      <RequestState query={atom} showRefresh={false}>
        {(note) => (
          <>
            <pre className="whitespace-pre-wrap break-words">{note.body}</pre>
            {offset > 0 && (
              <Button variant="ghost" onClick={() => setOffset(0)}>
                Read from start
              </Button>
            )}
            {note.next_offset !== undefined && (
              <Button variant="ghost" onClick={() => setOffset(note.next_offset!)}>
                Read next section
              </Button>
            )}
          </>
        )}
      </RequestState>
    </section>
  );
}
