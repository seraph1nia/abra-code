import { Executable, ArtifactId, RelativePath, type AbsolutePath } from "../identities.ts";

import { domainEffect } from "../effect.ts";
import { Effect, Schema } from "effect";

import { access, readdir } from "../filesystem.ts";
import { join } from "node:path";
import { CrewError, type Execution } from "../domain.ts";
import { json, type Runner } from "../process.ts";
import {
  SpecStatusSchema,
  ApplyStatusSchema,
  ValidationSchema,
  CreatedSchema,
  InstructionsSchema,
  ArchiveSchema,
} from "./contracts.ts";
export {
  SpecStatusSchema,
  ApplyStatusSchema,
  DiscoverySchema,
  type SpecStatus,
  type ApplyStatus,
} from "./contracts.ts";
export class OpenSpec {
  constructor(
    private runner: Runner,
    private bin: Executable,
  ) {}
  private cwd(e: Execution): Effect.Effect<AbsolutePath, CrewError> {
    return e.worktree_directory
      ? Effect.succeed(e.worktree_directory)
      : Effect.fail(new CrewError("WORKTREE_MISSING", "No owned worktree"));
  }
  call<S extends Schema.ConstraintDecoder<unknown>>(e: Execution, schema: S, args: string[]) {
    return this.cwd(e).pipe(
      Effect.flatMap((cwd) => json(this.runner, schema, this.bin, [...args, "--json"], cwd)),
    );
  }
  update = Effect.fn("OpenSpec.update")(
    function* (this: OpenSpec, e: Execution) {
      yield* this.runner.run(this.bin, ["update"], yield* this.cwd(e));
    }.bind(this),
    domainEffect,
  );
  create = Effect.fn("OpenSpec.create")(
    function* (this: OpenSpec, e: Execution) {
      const dir = join(yield* this.cwd(e), "openspec/changes", e.openspec_change);
      if (yield* access(dir).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })))
        return;
      yield* this.call(e, CreatedSchema, ["new", "change", e.openspec_change]);
    }.bind(this),
    domainEffect,
  );
  status(e: Execution) {
    return this.call(e, SpecStatusSchema, ["status", "--change", e.openspec_change]);
  }
  instructions(e: Execution, artifact: ArtifactId) {
    return this.call(e, InstructionsSchema, [
      "instructions",
      artifact,
      "--change",
      e.openspec_change,
    ]);
  }
  apply(e: Execution) {
    return this.call(e, ApplyStatusSchema, [
      "instructions",
      "apply",
      "--change",
      e.openspec_change,
    ]);
  }
  validate = Effect.fn("OpenSpec.validate")(
    function* (this: OpenSpec, e: Execution) {
      const result = yield* this.call(e, ValidationSchema, [
        "validate",
        e.openspec_change,
        "--strict",
      ]);
      if (
        !(
          result.items?.length > 0 &&
          result.items.every((i) => i.valid === true) &&
          result.summary?.totals.failed === 0
        )
      )
        return yield* new CrewError("INVALID_SPEC", "OpenSpec strict validation failed");
      return result;
    }.bind(this),
    domainEffect,
  );
  plan = Effect.fn("OpenSpec.plan")(
    function* (this: OpenSpec, e: Execution) {
      const s = yield* this.status(e);
      if (!(s.actionContext?.mode === "repo-local"))
        return yield* new CrewError(
          "SHARED_SPEC_UNSUPPORTED",
          "MVP requires repository-local OpenSpec",
        );
      if (
        !(
          s.isPlanningComplete === true &&
          s.artifacts.length > 0 &&
          s.artifacts.every((a) => a.status === "done")
        )
      )
        return yield* new CrewError(
          "PLAN_INCOMPLETE",
          "Configured schema planning artifacts are incomplete",
        );
      yield* this.validate(e);
      const a = yield* this.apply(e);
      if (!(a.state !== "blocked" && a.taskTrackingConfigured && a.progress.total > 0))
        return yield* new CrewError(
          "PLAN_INCOMPLETE",
          "Apply prerequisites or implementation task tracking are missing",
        );
      return { status: s, apply: a };
    }.bind(this),
    domainEffect,
  );
  implemented = Effect.fn("OpenSpec.implemented")(
    function* (this: OpenSpec, e: Execution) {
      yield* this.plan(e);
      const a = yield* this.apply(e);
      if (
        !(
          a.state === "all_done" &&
          a.progress.remaining === 0 &&
          a.progress.complete === a.progress.total
        )
      )
        return yield* new CrewError(
          "TASKS_REMAIN",
          "OpenSpec implementation tasks remain unfinished",
        );
      return a;
    }.bind(this),
    domainEffect,
  );
  validateCanonical = Effect.fn("OpenSpec.validateCanonical")(
    function* (this: OpenSpec, e: Execution) {
      const result = yield* this.call(e, ValidationSchema, ["validate", "--specs", "--strict"]);
      if (!(result.summary.totals.failed === 0 && result.items.every((i) => i.valid)))
        return yield* new CrewError(
          "CANONICAL_INVALID",
          "Canonical specifications failed strict validation",
        );
    }.bind(this),
    domainEffect,
  );
  archive = Effect.fn("OpenSpec.archive")(
    function* (this: OpenSpec, e: Execution) {
      const root = join(yield* this.cwd(e), "openspec/changes");
      const matches = (yield* readdir(join(root, "archive")).pipe(
        Effect.catch(() =>
          domainEffect(
            Effect.sync(() => {
              return [];
            }),
          ),
        ),
      )).filter((n) => n.endsWith(`-${e.openspec_change}`));
      const active = yield* access(join(root, e.openspec_change)).pipe(
        Effect.match({ onSuccess: () => true, onFailure: () => false }),
      );
      if (!active && matches.length === 1) {
        yield* this.validateCanonical(e);
        return RelativePath.make(join("openspec/changes/archive", matches[0]));
      }
      if (!(active && matches.length === 0))
        return yield* new CrewError(
          "ARCHIVE_AMBIGUOUS",
          "Cannot identify one unambiguous OpenSpec change/archive",
        );
      yield* this.call(e, ArchiveSchema, ["archive", e.openspec_change, "--yes"]);
      const after = (yield* readdir(join(root, "archive"))).filter((n) =>
        n.endsWith(`-${e.openspec_change}`),
      );
      if (
        !(
          after.length === 1 &&
          !(yield* access(join(root, e.openspec_change)).pipe(
            Effect.match({ onSuccess: () => true, onFailure: () => false }),
          ))
        )
      )
        return yield* new CrewError("ARCHIVE_FAILED", "Archive completion could not be verified");
      yield* this.validateCanonical(e);
      return RelativePath.make(join("openspec/changes/archive", after[0]));
    }.bind(this),
    domainEffect,
  );
}
