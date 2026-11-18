import { Effect, Exit, Scope } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AbsolutePath } from "../../src/identities.ts";
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

export function removeFinderIndexForLegacyFixture(db: DatabaseSync) {
  db.exec(`
    DROP INDEX issues_finder_rank;
    DROP INDEX issues_finder_priority;
    DROP INDEX issues_finder_repository;
    DROP INDEX issues_finder_status;
    DROP INDEX issues_finder_repository_status;
    DROP TABLE finder_order;
    ALTER TABLE issues DROP COLUMN finder_rank;
    PRAGMA user_version = 7;
  `);
}
