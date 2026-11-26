import { decode } from "../../src/decode.ts";
import { SpecStatusSchema, ApplyStatusSchema, OpenSpec } from "../../src/openspec/adapter.ts";
import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "../effects.ts";
import { Effect } from "effect";
import { mkdir, writeFile, rename } from "../../src/filesystem.ts";
import { join } from "node:path";
import { ProcessRunner } from "../../src/process.ts";
import { CrewError, ensure, type Execution } from "../../src/domain.ts";

export class FakeSpec extends OpenSpec {
  planned = false;
  done = false;
  valid = true;
  constructor() {
    super(new ProcessRunner(), Id.Executable.make("unused"));
  }
  update = (_e: Execution): Effect.Effect<void, CrewError> => Effect.void;
  bind = (e: Execution) =>
    Effect.succeed({
      schema_version: 1 as const,
      state: "bound" as const,
      selection_source: e.openspec_schema ? ("task" as const) : ("repository_default" as const),
      name: e.openspec_schema ?? Id.SpecSchemaName.make("spec-driven"),
      source: "package" as const,
      root: Id.AbsolutePath.make("/fixture/schema"),
      files: [
        {
          path: Id.RelativePath.make("schema.yaml"),
          hash: Id.ContentHash.make("a".repeat(64)),
          bytes: 1,
        },
      ],
      hash: Id.ContentHash.make("b".repeat(64)),
    });
  assertSchema = (_e: Execution): Effect.Effect<void, CrewError> => Effect.void;
  create = Effect.fn("FakeSpec.create")(
    function* (this: FakeSpec, e: Execution) {
      yield* writePlan(e.worktree_directory!, e.openspec_change);
    }.bind(this),
    domainEffect,
  );
  status(e: Execution) {
    return Effect.suspend(() =>
      decode(
        SpecStatusSchema,
        {
          changeName: e.openspec_change,
          schemaName:
            e.openspec_schema_binding?.state === "bound"
              ? e.openspec_schema_binding.name
              : (e.openspec_schema ?? "spec-driven"),
          isPlanningComplete: this.planned,
          isComplete: this.planned,
          artifacts: [
            {
              id: "tasks",
              status: this.planned ? ("done" as const) : ("ready" as const),
              outputPath: "tasks.md",
              requires: [],
            },
          ],
          applyRequires: ["tasks"],
          actionContext: { mode: "repo-local" },
        },
        "Fixture OpenSpec",
      ),
    );
  }
  apply() {
    return Effect.suspend(() =>
      decode(
        ApplyStatusSchema,
        {
          state: this.done
            ? ("all_done" as const)
            : this.planned
              ? ("ready" as const)
              : ("blocked" as const),
          taskTrackingConfigured: true,
          progress: { total: 1, complete: this.done ? 1 : 0, remaining: this.done ? 0 : 1 },
          tasks: [{ id: "1", done: this.done }],
        },
        "Fixture OpenSpec",
      ),
    );
  }
  validate = () => {
    return domainEffect(
      Effect.sync(() => {
        ensure(this.valid, "INVALID_SPEC", "Invalid OpenSpec");
        return { items: [{ valid: true }], summary: { totals: { failed: 0, passed: 1 } } };
      }),
    );
  };
  archive = Effect.fn("FakeSpec.archive")(
    function* (this: FakeSpec, e: Execution) {
      const target = join(e.worktree_directory!, "openspec/changes/archive");
      yield* mkdir(target, { recursive: true });
      yield* rename(
        join(e.worktree_directory!, "openspec/changes", e.openspec_change),
        join(target, `2026-10-14-${e.openspec_change}`),
      );
      return Id.RelativePath.make(`openspec/changes/archive/2026-10-14-${e.openspec_change}`);
    }.bind(this),
    domainEffect,
  );
}
export function writePlan(path: string, change: string, done = false) {
  return domainEffect(
    Effect.gen(function* () {
      const root = join(path, "openspec/changes", change);
      yield* mkdir(join(root, "specs/sample"), { recursive: true });
      yield* writeFile(
        join(root, "proposal.md"),
        "## Why\nNeed a sample.\n## What Changes\nAdd sample.\n## Capabilities\n### New Capabilities\n- `sample`: Sample capability.\n### Modified Capabilities\n## Impact\nSample code.\n",
      );
      yield* writeFile(join(root, "design.md"), "## Design\nReturn a sample.\n");
      yield* writeFile(
        join(root, "tasks.md"),
        `## Implementation\n- [${done ? "x" : " "}] 1.1 Implement sample\n`,
      );
      yield* writeFile(
        join(root, "specs/sample/spec.md"),
        "## Purpose\nProvide a stable sample response that consumers can request through the sample capability.\n\n## ADDED Requirements\n### Requirement: Sample behavior\nThe system SHALL return a sample.\n#### Scenario: Request sample\n- **WHEN** a sample is requested\n- **THEN** a sample is returned\n",
      );
    }),
  );
}
