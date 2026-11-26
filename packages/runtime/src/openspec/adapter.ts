import { tryDomainValue } from "../effect.ts";
import { parse as parseYaml } from "yaml";
import { SchemaName } from "@abracode/contracts/openspec/schema-contracts";
import { decode } from "../decode.ts";
import { planningPrerequisites, trackedImplementation } from "./prerequisites.ts";
import {
  SchemaResolution,
  NativeSchemaValidation,
} from "@abracode/contracts/openspec/schema-contracts";
import { schemaName, schemaEvidence } from "./schema-binding.ts";
import {
  Executable,
  ArtifactId,
  RelativePath,
  type AbsolutePath,
} from "@abracode/contracts/identities";

import { Effect, Schema } from "effect";

import { retainedEntry, entryExists, readdir, readdirIfPresent } from "../filesystem.ts";
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
  update = Effect.fn("OpenSpec.update")({ self: this }, function* (e: Execution) {
    yield* this.runner.run(this.bin, ["update"], yield* this.cwd(e));
  });
  bind = Effect.fn("OpenSpec.bind")({ self: this }, function* (e: Execution) {
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
    if (
      resolution.name !== name ||
      validation.name !== name ||
      validation.path !== resolution.path ||
      !validation.valid
    )
      return yield* new CrewError(
        "SCHEMA_INVALID",
        "Selected native schema is invalid or changed during resolution; restore its definition/templates before retrying",
      );
    return yield* schemaEvidence(
      e,
      resolution,
      e.openspec_schema_binding?.selection_source ??
        (e.openspec_schema ? "task" : "repository_default"),
    );
  });
  assertSchema = Effect.fn("OpenSpec.assertSchema")(
    { self: this },
    function* (e: Execution): Effect.fn.Return<void, CrewError> {
      const binding = e.openspec_schema_binding;
      if (!binding) return;
      if (binding.state !== "bound")
        return yield* new CrewError(
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
      if (current.hash !== binding.hash)
        return yield* new CrewError(
          "SCHEMA_DRIFT",
          "Selected schema definition, resolution source or templates changed; restore the retained inputs before continuing. A new schema requires separately planned work.",
        );
      const directory = join(yield* this.cwd(e), "openspec/changes", e.openspec_change);
      if (yield* retainedEntry(directory, "directory"))
        if ((yield* this.status(e)).schemaName !== binding.name)
          return yield* new CrewError(
            "SCHEMA_IDENTITY",
            "Change metadata no longer matches the retained schema; restore it before dependent work",
          );
    },
  );
  private legacyRevisionSchema = Effect.fn("OpenSpec.legacyRevisionSchema")(
    { self: this },
    function* (e: Execution) {
      const correction = e.rounds?.find(
        (round) =>
          e.openspec_change ===
          `${e.openspec_base_change ?? round.openspec_change}-r${round.ordinal}`,
      );
      const synchronization = e.finishing?.synchronization?.find(
        (attempt) =>
          e.openspec_change ===
          `${e.openspec_base_change ?? attempt.prior_change}-sync${attempt.ordinal}`,
      );
      const archive = correction?.archive_path ?? synchronization?.prior_archive;
      const commit = correction?.starting_head ?? synchronization?.head;
      if (
        !archive ||
        !commit ||
        !archive.startsWith("openspec/changes/archive/") ||
        archive.split("/").includes("..")
      )
        return yield* new CrewError(
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
      if (!match || match[2] !== path)
        return yield* new CrewError(
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
    },
  );
  create = Effect.fn("OpenSpec.create")({ self: this }, function* (e: Execution): Effect.fn.Return<
    void,
    CrewError
  > {
    yield* this.assertSchema(e);
    const binding = e.openspec_schema_binding;
    let name = binding?.state === "bound" ? binding.name : e.openspec_schema;
    const dir = join(yield* this.cwd(e), "openspec/changes", e.openspec_change);
    if (yield* retainedEntry(dir, "directory")) {
      const status = yield* this.status(e);
      if (status.changeName !== e.openspec_change || (name && status.schemaName !== name))
        return yield* new CrewError(
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
      if (created.change.schema !== name)
        return yield* new CrewError(
          "SCHEMA_IDENTITY",
          "Created change does not match the retained schema",
        );
  });
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
  validate = Effect.fn("OpenSpec.validate")({ self: this }, function* (e: Execution) {
    const result = yield* this.call(e, ValidationSchema, [
      "validate",
      e.openspec_change,
      "--strict",
    ]);
    if (
      !(result.items?.length > 0) ||
      !result.items.every((i) => i.valid === true) ||
      result.summary?.totals.failed !== 0
    )
      return yield* new CrewError("INVALID_SPEC", "OpenSpec strict validation failed");
    return result;
  });
  plan = Effect.fn("OpenSpec.plan")({ self: this }, function* (e: Execution) {
    yield* this.assertSchema(e);
    const s = yield* this.status(e);
    if (s.actionContext?.mode !== "repo-local")
      return yield* new CrewError(
        "SHARED_SPEC_UNSUPPORTED",
        "MVP requires repository-local OpenSpec",
      );
    yield* tryDomainValue(planningPrerequisites, s);
    yield* this.validate(e);
    const a = yield* this.apply(e);
    yield* tryDomainValue(trackedImplementation, a);
    return { status: s, apply: a };
  });
  implemented = Effect.fn("OpenSpec.implemented")({ self: this }, function* (e: Execution) {
    const { apply: a } = yield* this.plan(e);
    if (
      a.state !== "all_done" ||
      a.progress.remaining !== 0 ||
      a.progress.complete !== a.progress.total
    )
      return yield* new CrewError(
        "TASKS_REMAIN",
        "OpenSpec implementation tasks remain unfinished",
      );
    return a;
  });
  validateCanonical = Effect.fn("OpenSpec.validateCanonical")(
    { self: this },
    function* (e: Execution) {
      const result = yield* this.call(e, ValidationSchema, ["validate", "--specs", "--strict"]);
      if (result.summary.totals.failed !== 0 || !result.items.every((i) => i.valid))
        return yield* new CrewError(
          "CANONICAL_INVALID",
          "Canonical specifications failed strict validation",
        );
    },
  );
  archive = Effect.fn("OpenSpec.archive")({ self: this }, function* (e: Execution) {
    yield* this.assertSchema(e);
    const root = join(yield* this.cwd(e), "openspec/changes");
    const matches = (yield* readdirIfPresent(join(root, "archive"))).filter((n) =>
      n.endsWith(`-${e.openspec_change}`),
    );
    const activePath = join(root, e.openspec_change);
    const active = yield* entryExists(activePath);
    if (!active && matches.length === 1) {
      yield* this.validateCanonical(e);
      return RelativePath.make(join("openspec/changes/archive", matches[0]));
    }
    if (!active || matches.length !== 0)
      return yield* new CrewError(
        "ARCHIVE_AMBIGUOUS",
        "Cannot identify one unambiguous OpenSpec change/archive",
      );
    yield* this.call(e, ArchiveSchema, ["archive", e.openspec_change, "--yes"]);
    const after = (yield* readdir(join(root, "archive"))).filter((n) =>
      n.endsWith(`-${e.openspec_change}`),
    );
    if (after.length !== 1 || (yield* entryExists(activePath)))
      return yield* new CrewError("ARCHIVE_FAILED", "Archive completion could not be verified");
    yield* this.validateCanonical(e);
    return RelativePath.make(join("openspec/changes/archive", after[0]));
  });
}
