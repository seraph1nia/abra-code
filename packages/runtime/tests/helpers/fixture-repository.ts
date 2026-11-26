import { cp } from "node:fs/promises";
import { decode } from "../../src/decode.ts";
import { ConfigSchema } from "../../src/config/contracts.ts";
import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "../effects.ts";
import { Effect } from "effect";
import { mkdir, writeFile } from "../../src/filesystem.ts";
import { join } from "node:path";
import { ProcessRunner } from "../../src/process.ts";
import { Git } from "../../src/git/repository.ts";
import { CrewError } from "../../src/domain.ts";

export function repo(root: string, name: string) {
  return domainEffect(
    Effect.gen(function* () {
      const path = join(root, name);
      const seed = process.env.ABRACODE_TEST_REPOSITORY_SEED;
      if (seed) {
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              cp(join(seed, "repository"), path, { recursive: true }),
              cp(join(seed, "remote.git"), `${path}.git`, { recursive: true }),
            ]),
          catch: CrewError.from,
        });
        yield* new Git(new ProcessRunner()).run(Id.AbsolutePath.make(path), [
          "remote",
          "add",
          "origin",
          join(root, `${name}.git`),
        ]);
        return path;
      }
      yield* mkdir(path, { recursive: true });
      const git = new Git(new ProcessRunner());
      yield* git.run(Id.AbsolutePath.make(path), ["init", "-b", "main"]);
      yield* git.run(Id.AbsolutePath.make(path), [
        "config",
        "user.email",
        "fixture@example.invalid",
      ]);
      yield* git.run(Id.AbsolutePath.make(path), ["config", "user.name", "Fixture"]);
      yield* git.run(Id.AbsolutePath.make(path), [
        "remote",
        "add",
        "origin",
        join(root, `${name}.git`),
      ]);
      yield* mkdir(join(path, "openspec"), { recursive: true });
      yield* writeFile(join(path, "openspec/config.yaml"), "schema: spec-driven\n");
      yield* writeFile(join(path, "source.txt"), "original\n");
      yield* git.run(Id.AbsolutePath.make(path), ["add", "."]);
      yield* git.run(Id.AbsolutePath.make(root), ["init", "--bare", "-b", "main", `${path}.git`]);
      yield* git.run(Id.AbsolutePath.make(path), ["commit", "-m", "Initial"]);
      yield* git.run(Id.AbsolutePath.make(path), ["push", "origin", "main"]);
      return path;
    }),
  );
}
export function fixtureConfig(root: string) {
  return decode(
    ConfigSchema,
    {
      version: 1,
      models: { default: { providerID: "fixture", id: "fixture" } },
      supervisor_model: { providerID: "fixture", id: "fixture" },
      config_path: join(root, "abracode.yaml"),
      config_digest: "fixture",
      home: root,
      work_database: Id.AbsolutePath.make(join(root, "work.sqlite")),
      worktree_root: Id.AbsolutePath.make(join(root, "trees")),
      repository_root: Id.AbsolutePath.make(join(root, "repositories")),
      default_workflow: "full-openspec",
      auto_schedule: false,
      max_workers: 2,
      explore_capacity: 2,
      review_capacity: 2,
      reconcile_interval_ms: 30000,
      workers: {},
      commands: { openspec: "openspec", forge: "gh" },
      repositories: [],
      max_executions: 2,
      attention_capacity: 1,
      research_capacity: 2,
      progress_timeout_ms: {
        explore: 900000,
        apply: 1800000,
        review: 900000,
        research: 900000,
        operation: 300000,
      },
    },
    "Fixture configuration",
  );
}
