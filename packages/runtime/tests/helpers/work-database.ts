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

export function restoreV8FinderFixture(db: DatabaseSync) {
  db.exec(`
    DROP INDEX issues_repository_priority;
    ALTER TABLE issues ADD COLUMN finder_rank INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE finder_order(singleton INTEGER PRIMARY KEY, collation TEXT NOT NULL);
    INSERT INTO finder_order VALUES(1, 'previous runtime locale');
    CREATE INDEX issues_finder_rank ON issues(finder_rank);
    CREATE INDEX issues_finder_priority ON issues(priority,finder_rank);
    CREATE INDEX issues_finder_repository ON issues(repository_id,priority,finder_rank);
    CREATE INDEX issues_finder_status ON issues(status,priority,finder_rank);
    CREATE INDEX issues_finder_repository_status ON issues(repository_id,status,priority,finder_rank);
    PRAGMA user_version = 8;
  `);
}
