import * as Id from "@abracode/contracts/identities";
import { run } from "../effects.ts";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned } from "../fixtures.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
test("a plan passage is bound to its occurrence, generation and exact document", async (t) => {
  const { captureSelection } = await import("../../src/web/capture-selection.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const file = Id.RelativePath.make("design.md");
  const document = join(e.worktree_directory!, "openspec/changes", e.openspec_change, file);
  await writeFile(document, "Same criterion\nFirst context\nSame criterion\nSecond context");
  const source = await run(new Visibility(f.controller).document(e.issue_id, file));
  const selection = {
    kind: "plan" as const,
    issue_id: e.issue_id,
    file,
    generation: source.generation!,
    hash: source.hash!,
    start: 3,
    end: 4,
  };
  assert.equal(
    await run(captureSelection(f.controller.queries, selection)),
    "Same criterion\nSecond context",
  );
  await assert.rejects(
    run(
      captureSelection(f.controller.queries, {
        ...selection,
        generation: selection.generation + 1,
      }),
    ),
    /changed/,
  );
  await writeFile(document, "Updated criteria");
  await assert.rejects(run(captureSelection(f.controller.queries, selection)), /changed/);
});

test("retained discovery pages same-file plan passages, checks the owner and never previews a patch", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const queries = f.controller.queries;
  const file = join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md");
  await writeFile(file, Array.from({ length: 18 }, (_, i) => "Notebook journey " + i).join("\n"));
  const q = { search: "Notebook journey", kind: "plan" as const };
  const first = await run(queries.discoverEvidence(q));
  assert.equal(first.entries.length, 12);
  assert.ok(first.next);
  const second = await run(queries.discoverEvidence({ ...q, ...first.next }));
  assert.equal(second.entries.length, 6);
  assert.equal(new Set([...first.entries, ...second.entries].map((r) => r.identity)).size, 18);
  const selected = first.entries[0];
  assert.equal(selected.resource?.action, "open_passage");
  const exact = {
    kind: selected.kind,
    repository_id: selected.repository_id,
    issue_id: e.issue_id,
    identity: selected.identity,
  };
  assert.equal((await run(queries.discoverEvidence(exact))).entries.length, 1);
  assert.equal(
    (
      await run(
        queries.discoverEvidence({ ...exact, repository_id: Id.RepositoryId.make("foreign") }),
      )
    ).entries.length,
    0,
  );
  await writeFile(file, "Edited passage");
  assert.equal((await run(queries.discoverEvidence(exact))).entries.length, 0);
  const diff = vi.spyOn(queries, "diff");
  await writeFile(join(e.worktree_directory!, "same-path.ts"), "export const marker=1");
  const files = await run(
    queries.discoverEvidence({ kind: "file", search: "same-path.ts", issue_id: e.issue_id }),
  );
  assert.equal(files.entries[0]?.resource?.action, "open_changes");
  assert.ok(diff.mock.calls.length && diff.mock.calls.every((call) => call[3] === true));
  const peer = Id.IssueId.make("different-owner");
  f.seed.named(peer);
  const snapshot = await run(queries.diff(e.issue_id, "all", undefined, true));
  const record = (await run(queries.execution(e.issue_id)))!;
  vi.spyOn(queries, "execution").mockImplementation((id) =>
    Effect.succeed({ ...record, issue_id: id }),
  );
  diff.mockReturnValue(Effect.succeed(snapshot));
  const sameName = await run(queries.discoverEvidence({ kind: "file", search: "same-path.ts" }));
  assert.deepEqual(
    new Set(sameName.entries.map((hit) => hit.resource?.issue_id)),
    new Set([e.issue_id, peer]),
  );
});

test("worker discovery returns current and retired identities without a transcript read", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const view = new Visibility(f.controller);
  const inspect = vi.spyOn(f.runtime, "session");
  const search = await run(view.sessionSearch({ search: e.explore_session_id, limit: 1 }));
  assert.equal(search.entries.length, 1);
  assert.equal(search.entries[0].issue_id, e.issue_id);
  assert.equal(search.entries[0].session_id, e.explore_session_id);
  const retained = await run(f.controller.queries.executions());
  retained[0].current_phase = "completed";
  vi.spyOn(f.controller.queries, "executions").mockReturnValue(Effect.succeed(retained));
  Object.assign(f.runtime, {
    sessionOwner: () => Effect.succeed({ issue_id: "unrelated", directory: e.worktree_directory }),
  });
  const historical = await run(view.sessionSearch({ search: e.explore_session_id }));
  assert.equal(historical.entries[0].association, "historical");
  assert.equal(historical.entries[0].availability, "unavailable");
  const oldIssue = Id.IssueId.make("zz-retired");
  f.seed.named(oldIssue);
  const oldSession = Id.SessionId.make("ses_archive");
  const workers = Array.from({ length: 35 }, (_, i) => {
    const id = Id.IssueId.make("earlier-" + String(i).padStart(2, "0"));
    f.seed.named(id);
    return {
      ...retained[0],
      issue_id: id,
      explore_session_id: Id.SessionId.make("ses_worker_" + i),
    };
  });
  vi.spyOn(f.controller.queries, "executions").mockReturnValue(
    Effect.succeed([
      ...workers,
      { ...retained[0], issue_id: oldIssue, explore_session_id: oldSession },
    ]),
  );
  const first = await run(view.sessionSearch({ limit: 30 }));
  assert.ok(first.next_offset);
  assert.equal(
    first.entries.some((row) => row.session_id === oldSession),
    false,
  );
  const exact = await run(view.sessionSearch({ search: oldSession, limit: 1 }));
  assert.equal(exact.entries[0].issue_id, oldIssue);
  assert.equal(inspect.mock.calls.length, 0);
  assert.deepEqual(
    (
      await run(
        view.sessionSearch({
          search: e.explore_session_id,
          repository_id: Id.RepositoryId.make("foreign"),
        }),
      )
    ).entries,
    [],
  );
});
