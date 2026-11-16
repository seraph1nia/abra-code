import { createExecution } from "../../src/workflow/execution.ts";
import * as Id from "../../src/identities.ts";
import { Effect, Schedule } from "effect";
import { join } from "node:path";
import { loadConfig } from "../../src/config/load.ts";
import { identifier, ensure } from "../../src/domain.ts";
import { Records } from "../../src/storage/store.ts";
import { FileLocks } from "../../src/storage/lock.ts";
import { Capacity } from "../../src/workflow/capacity.ts";
import { exists, writeFile } from "../../src/filesystem.ts";
import { FileStore } from "./file-store.ts";

await Effect.runPromise(
  Effect.gen(function* () {
    const [root, id, repository] = process.argv.slice(2);
    identifier(id);
    identifier(repository);
    const config = yield* loadConfig(root);
    const records = new Records(new FileStore(join(root, "records")));
    const coordination = records.coordinate(
      new FileLocks(Id.AbsolutePath.make(join(root, "locks"))),
    );
    const project = yield* records.project(Id.RepositoryId.make(repository));
    ensure(project, "FIXTURE", "Missing fixture project");
    const e = yield* createExecution(project, {
      issue_id: Id.IssueId.make(id),
      repository_id: Id.RepositoryId.make(repository),
      execution_id: Id.ExecutionId.make(`execution-${id}`),
      workflow_policy: "full-openspec",
      current_phase: "claiming",
      branch: Id.BranchName.make(`work/${id}`),
      openspec_change: Id.ChangeName.make(id),
    });
    yield* writeFile(join(root, `${id}.ready`), "ready");
    yield* exists(join(root, "release")).pipe(
      Effect.repeat({ schedule: Schedule.spaced(10), until: Boolean }),
      Effect.timeout("10 seconds"),
    );
    const admitted = yield* new Capacity(config, records, coordination).reserve(
      e,
      "explore",
      project,
      true,
    );
    yield* Effect.sync(() =>
      process.stdout.write(JSON.stringify({ id, admitted, wait: e.capacity_wait })),
    );
  }),
);
