import { parse as parseYaml } from "yaml";
import { SchemaName } from "./schema-contracts.ts";
import { decode } from "../decode.ts";
import { planningPrerequisites, trackedImplementation } from "./prerequisites.ts";
import { SchemaResolution, NativeSchemaValidation } from "./schema-contracts.ts";
import { schemaName, schemaEvidence } from "./schema-binding.ts";
import { ensure } from "../domain.ts";
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
  bind = Effect.fn("OpenSpec.bind")(
    function* (this: OpenSpec, e: Execution) {
      const name = yield* schemaName(e);
      const resolution = yield* this.call(e, SchemaResolution, ["schema", "which", name]).pipe(
        Effect.mapError(
          (error) =>
            new CrewError(
              "SCHEMA_UNAVAILABLE",
              `Selected schema ${name} is unavailable in the owned worktree; restore it there and retry the original execution. ${error.message}`,
            ),
        ),
      );
      const validation = yield* this.call(e, NativeSchemaValidation, ["schema", "validate", name]);
      ensure(
        resolution.name === name &&
          validation.name === name &&
          validation.path === resolution.path &&
          validation.valid,
        "SCHEMA_INVALID",
        "Selected native schema is invalid or changed during resolution; restore its definition/templates before retrying",
      );
      return yield* schemaEvidence(
        e,
        resolution,
        e.openspec_schema_binding?.selection_source ??
          (e.openspec_schema ? "task" : "repository_default"),
      );
    }.bind(this),
    domainEffect,
  );
  assertSchema = Effect.fn("OpenSpec.assertSchema")(
    function* (this: OpenSpec, e: Execution) {
      const binding = e.openspec_schema_binding;
      if (!binding) return;
      ensure(
        binding.state === "bound",
        "SCHEMA_UNBOUND",
        "Resolve the retained schema in the owned worktree before admitting dependent work",
      );
      const resolution = yield* this.call(e, SchemaResolution, [
        "schema",
        "which",
        binding.name,
      ]).pipe(
        Effect.mapError(
          (error) =>
            new CrewError(
              "SCHEMA_UNAVAILABLE",
              `Retained schema ${binding.name} is unavailable; restore its original definition and templates before continuing. ${error.message}`,
            ),
        ),
      );
      const current = yield* schemaEvidence(e, resolution, binding.selection_source);
      ensure(
        current.hash === binding.hash,
        "SCHEMA_DRIFT",
        "Selected schema definition, resolution source or templates changed; restore the retained inputs before continuing. A new schema requires separately planned work.",
      );
      const directory = join(yield* this.cwd(e), "openspec/changes", e.openspec_change);
      if (yield* access(directory).pipe(Effect.isSuccess))
        ensure(
          (yield* this.status(e)).schemaName === binding.name,
          "SCHEMA_IDENTITY",
          "Change metadata no longer matches the retained schema; restore it before dependent work",
        );
    }.bind(this),
    domainEffect,
  );
  private legacyRevisionSchema = Effect.fn("OpenSpec.legacyRevisionSchema")(
    function* (this: OpenSpec, e: Execution) {
      const correction = e.rounds?.find(
        (round) => e.openspec_change === `${round.openspec_change}-r${round.ordinal}`,
      );
      const synchronization = e.finishing?.synchronization?.find(
        (attempt) => e.openspec_change === `${attempt.prior_change}-sync${attempt.ordinal}`,
      );
      const archive = correction?.archive_path ?? synchronization?.prior_archive;
      const commit = correction?.starting_head ?? synchronization?.head;
      ensure(
        archive &&
          commit &&
          archive.startsWith("openspec/changes/archive/") &&
          !archive.split("/").includes(".."),
        "SCHEMA_LEGACY",
        "Original legacy schema metadata is unavailable; restore the original change/archive evidence before creating a revision. Do not substitute today's default.",
      );
      const path = `${archive}/.openspec.yaml`,
        cwd = yield* this.cwd(e);
      const entry = yield* this.runner.run(
        Executable.make("git"),
        ["--literal-pathspecs", "ls-tree", "-z", commit, "--", path],
        cwd,
        undefined,
        { deadline_ms: 5000, max_output_bytes: 65536 },
      );
      const match = /^100(?:644|755) blob ([0-9a-f]{40,64})\t([^\0]+)\0$/.exec(entry);
      ensure(
        match && match[2] === path,
        "SCHEMA_LEGACY",
        "Original archive schema metadata must be a verified regular Git blob",
      );
      const text = yield* this.runner.run(
        Executable.make("git"),
        ["cat-file", "blob", match[1]!],
        cwd,
        undefined,
        { deadline_ms: 5000, max_output_bytes: 65536 },
      );
      const data = yield* Effect.try({ try: () => parseYaml(text), catch: CrewError.from });
      return (yield* decode(
        Schema.Struct({ schema: SchemaName }),
        data,
        "Original archive schema metadata",
      )).schema;
    }.bind(this),
    domainEffect,
  );
  create = Effect.fn("OpenSpec.create")(
    function* (this: OpenSpec, e: Execution) {
      yield* this.assertSchema(e);
      const binding = e.openspec_schema_binding;
      let name = binding?.state === "bound" ? binding.name : e.openspec_schema;
      const dir = join(yield* this.cwd(e), "openspec/changes", e.openspec_change);
      if (yield* access(dir).pipe(Effect.isSuccess)) {
        if (name)
          ensure(
            (yield* this.status(e)).schemaName === name,
            "SCHEMA_IDENTITY",
            "Existing change metadata names another schema; preserve it and inspect the original execution",
          );
        return;
      }
      name ??= yield* this.legacyRevisionSchema(e);
      const created = yield* this.call(e, CreatedSchema, [
        "new",
        "change",
        e.openspec_change,
        ...(name ? ["--schema", name] : []),
      ]);
      if (name)
        ensure(
          created.change.schema === name,
          "SCHEMA_IDENTITY",
          "Created change does not match the retained schema",
        );
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
      yield* this.assertSchema(e);
      const s = yield* this.status(e);
      if (!(s.actionContext?.mode === "repo-local"))
        return yield* new CrewError(
          "SHARED_SPEC_UNSUPPORTED",
          "MVP requires repository-local OpenSpec",
        );
      planningPrerequisites(s);
      yield* this.validate(e);
      const a = yield* this.apply(e);
      trackedImplementation(a);
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
      yield* this.assertSchema(e);
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
      const active = yield* access(join(root, e.openspec_change)).pipe(Effect.isSuccess);
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
          !(yield* access(join(root, e.openspec_change)).pipe(Effect.isSuccess))
        )
      )
        return yield* new CrewError("ARCHIVE_FAILED", "Archive completion could not be verified");
      yield* this.validateCanonical(e);
      return RelativePath.make(join("openspec/changes/archive", after[0]));
    }.bind(this),
    domainEffect,
  );
}
