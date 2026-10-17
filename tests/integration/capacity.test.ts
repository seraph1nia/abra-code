import * as Id from "../../src/identities.ts";
import { Effect, Fiber, Schedule } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Records } from "../../src/storage/store.ts";
import { FileStore } from "../helpers/file-store.ts";
import { ProcessRunner } from "../../src/process.ts";
import { exists } from "../../src/filesystem.ts";

for (const limit of ["active", "repository", "role"] as const) {
  test(`independent processes cannot exceed ${limit} admission capacity`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const root = join(f.root, "shared");
    await mkdir(root);
    await writeFile(
      join(root, "abracode.yaml"),
      `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nmax_workers: ${limit === "active" ? 1 : 2}\nmax_executions: 4\nexplore_capacity: ${limit === "role" ? 1 : 2}\n`,
    );
    const records = new Records(new FileStore(join(root, "records")));
    for (const id of ["api", "frontend"]) {
      const p = (await run(f.records.project(Id.RepositoryId.make(id))))!;
      p.max_workers = limit === "repository" ? 1 : 2;
      p.max_executions = 4;
      await run(records.saveProject(p));
    }
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const runner = new ProcessRunner();
          const children = yield* Effect.forEach(["one", "two"], (id) =>
            runner
              .run(
                Id.Executable.make(process.execPath),
                [
                  "--import",
                  "tsx",
                  resolve("tests/helpers/reserve-capacity.ts"),
                  root,
                  id,
                  limit === "repository" || id === "one" ? "api" : "frontend",
                ],
                Id.AbsolutePath.make(process.cwd()),
                { ABRACODE_CONFIG: join(root, "abracode.yaml") },
              )
              .pipe(Effect.forkScoped),
          );
          yield* Effect.all([
            exists(join(root, "one.ready")),
            exists(join(root, "two.ready")),
          ]).pipe(
            Effect.repeat({
              schedule: Schedule.spaced(10),
              until: (ready) => ready.every(Boolean),
            }),
            Effect.timeout("5 seconds"),
          );
          yield* Effect.promise(() => writeFile(join(root, "release"), "go"));
          const results = yield* Effect.forEach(children, Fiber.join);
          const admitted = results.map((result) => JSON.parse(result) as { admitted: boolean });
          assert.equal(admitted.filter((r) => r.admitted).length, 1);
          assert.equal(
            (yield* records.executions()).filter((e) => e.capacity_reservation).length,
            1,
          );
        }),
      ),
    );
  });
}
