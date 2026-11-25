import { randomUUID } from "node:crypto";
import { IssueId, RequestId, ExecutionId, RepositoryId } from "@abracode/contracts/identities";
import type { NewIssue, WorkEvent } from "../../src/work/graph.ts";
import { Effect, Exit, Scope } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbsolutePath } from "@abracode/contracts/identities";
import { SqliteWorkGraph } from "../../src/work/graph.ts";
import { run } from "../effects.ts";

type Cleanup = { onTestFinished: (cleanup: () => Promise<void>) => void };
export async function workGraphAt(t: Cleanup, path: AbsolutePath | ":memory:" = ":memory:") {
  const scope = Scope.makeUnsafe();
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  const graph = await run(
    SqliteWorkGraph.open(path).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return { graph, scope };
}
export async function workDatabase(t: Cleanup) {
  const root = await mkdtemp(join(tmpdir(), "abracode-work-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = AbsolutePath.make(join(root, "work.sqlite"));
  return { root, path, ...(await workGraphAt(t, path)) };
}

/** Named identities are reserved for historical references and ordering scenarios. */
export const fixtureGraph = SqliteWorkGraph.open(":memory:", (request) =>
  request.startsWith("named-")
    ? IssueId.make(request.slice("named-".length))
    : IssueId.make(`abra-${randomUUID()}`),
).pipe(Effect.map((work) => ({ work, seed: graphSeeds(work) })));

function graphSeeds(work: SqliteWorkGraph) {
  const db = work["db"];
  return {
    db,
    named(
      id: IssueId,
      repository_id = RepositoryId.make("api"),
      dependencies: IssueId[] = [],
      choices: Partial<NewIssue> = {},
    ) {
      return Effect.runSync(
        work.create({
          repository_id,
          dependencies,
          title: id,
          description: id,
          priority: 1,
          request_id: RequestId.make(`named-${id}`),
          ...choices,
        }),
      );
    },
    close(value: string) {
      const id = IssueId.make(value);
      const current = Effect.runSync(work.show(id));
      const owner = current.assignee ?? ExecutionId.make("fixture-owner");
      if (!current.assignee) Effect.runSync(work.claim(id, owner));
      Effect.runSync(work.close(id, owner));
    },
    countEvents(kind: WorkEvent["kind"]) {
      return Number(
        db.prepare("SELECT COUNT(*) AS n FROM work_events WHERE kind = ?").get(kind)!.n,
      );
    },
  };
}
