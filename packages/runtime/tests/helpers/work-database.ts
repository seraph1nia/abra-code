import { Effect, Exit, Scope } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
