import * as Id from "../src/identities.ts";
import { Effect, Console } from "effect";
import { loadConfig } from "../src/config/load.ts";
import { readFile } from "../src/filesystem.ts";
import { ensure } from "../src/domain.ts";
import { domainEffect } from "../src/effect.ts";
import { FileLocks } from "../src/storage/lock.ts";
import { SqliteWorkGraph } from "../src/work/graph.ts";
import { parseBeadsExport } from "../src/work/import.ts";
import { join } from "node:path";

await Effect.runPromise(
  Effect.scoped(
    domainEffect(
      Effect.gen(function* () {
        const file = process.argv[2];
        ensure(
          file,
          "IMPORT_FILE",
          "Usage: pnpm work:import <bd-export.jsonl>. Stop the old service and export with bd export first.",
        );
        const config = yield* loadConfig(process.env.ABRACODE_HOME ?? process.cwd());
        // The native coordinator holds this lock for its lifetime. Never import over a live service.
        yield* new FileLocks(Id.AbsolutePath.make(join(config.home, ".abracode/locks"))).acquire(
          Id.LockKey.make("scheduler-leader"),
        );
        const source = yield* readFile(file, "utf8");
        const issues = parseBeadsExport(source, config.default_workflow);
        const work = yield* SqliteWorkGraph.open(config.work_database);
        const count = yield* work.importIssues(issues, source);
        yield* Console.log(
          `Imported ${count} issues into ${config.work_database}; issue IDs, claims, dependencies and request IDs preserved. The original export is saved in SQLite; Beads data is untouched.`,
        );
      }),
    ),
  ),
);
