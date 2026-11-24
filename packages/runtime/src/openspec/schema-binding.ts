import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { Effect, Schema } from "effect";
import {
  AbsolutePath,
  RelativePath,
  ContentHash,
  SpecSchemaName,
} from "@abracode/contracts/identities";
import { CrewError, ensure, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { lstat, realpath, readBytes, pathExists } from "../filesystem.ts";
import {
  SchemaName,
  type SchemaResolution,
  type BoundSchema,
} from "@abracode/contracts/openspec/schema-contracts";
import { canonicalJSON } from "../presentation/identity.ts";
const hash = (text: string) => ContentHash.make(createHash("sha256").update(text).digest("hex"));
const Definition = Schema.Struct({
  name: SchemaName,
  artifacts: Schema.Array(Schema.Struct({ template: RelativePath })).check(Schema.isMaxLength(128)),
});

function ownedFile(path: string, root: string) {
  return domainEffect(
    Effect.gen(function* () {
      const file = resolve(path),
        inside = relative(root, file);
      ensure(
        inside && inside !== ".." && !inside.startsWith("../"),
        "SCHEMA_PATH",
        "Schema inputs must remain inside their resolved schema directory",
      );
      const stat = yield* lstat(file);
      ensure(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size > 0 &&
          stat.size <= 262144 &&
          (yield* realpath(file)) === file,
        "SCHEMA_INPUT",
        "Schema inputs must be bounded real regular files; restore the retained definition/templates",
      );
      const bytes = yield* readBytes(file);
      const text = Buffer.from(bytes).toString("utf8");
      ensure(
        bytes.length === stat.size && Buffer.from(text, "utf8").equals(bytes),
        "SCHEMA_INPUT",
        "Schema inputs must retain their exact UTF-8 bytes",
      );
      return text;
    }),
  );
}
/** Native new-change precedence: explicit selection, target config, built-in root default. */
export function schemaName(e: Execution) {
  return domainEffect(
    Effect.gen(function* () {
      if (e.openspec_schema)
        return yield* decode(SchemaName, e.openspec_schema, "Selected schema name");
      ensure(
        e.worktree_directory,
        "WORKTREE_MISSING",
        "Owned worktree required for schema selection",
      );
      const root = yield* realpath(e.worktree_directory);
      for (const name of ["config.yaml", "config.yml"]) {
        const path = join(root, "openspec", name);
        if (!(yield* pathExists(path))) continue;
        const text = yield* ownedFile(path, root);
        const config = yield* Effect.try({ try: () => parse(text), catch: CrewError.from });
        return (yield* decode(
          Schema.Struct({ schema: SchemaName }),
          config,
          "OpenSpec project schema selection",
        )).schema;
      }
      return SpecSchemaName.make("spec-driven");
    }),
  );
}
/** Content evidence, never a second schema registry or executable template loader. */
export function schemaEvidence(
  e: Execution,
  resolution: typeof SchemaResolution.Type,
  selection: BoundSchema["selection_source"],
) {
  return domainEffect(
    Effect.gen(function* () {
      const root = yield* realpath(resolution.path),
        stat = yield* lstat(resolution.path);
      ensure(
        stat.isDirectory() && !stat.isSymbolicLink() && root === resolve(resolution.path),
        "SCHEMA_PATH",
        "Schema resolution must be a real directory",
      );
      if (resolution.source === "project") {
        ensure(e.worktree_directory, "WORKTREE_MISSING", "Owned worktree required");
        ensure(
          root === join(yield* realpath(e.worktree_directory), "openspec/schemas", resolution.name),
          "SCHEMA_PATH",
          "Project schema resolution escaped the owned worktree",
        );
      }
      const definition = yield* ownedFile(join(root, "schema.yaml"), root);
      const decoded = yield* Effect.try({ try: () => parse(definition), catch: CrewError.from });
      const schema = yield* decode(Definition, decoded, "OpenSpec schema template references");
      ensure(
        schema.name === resolution.name,
        "SCHEMA_IDENTITY",
        "Resolved schema definition has another name",
      );
      const files: BoundSchema["files"][number][] = [
        {
          path: RelativePath.make("schema.yaml"),
          hash: hash(definition),
          bytes: Buffer.byteLength(definition),
        },
      ];
      for (const template of [...new Set(schema.artifacts.map((a) => a.template))].sort()) {
        ensure(
          !template.startsWith("/") && !template.split(/[\\/]/).includes(".."),
          "SCHEMA_PATH",
          "Template references must stay inside the schema templates directory",
        );
        const path = RelativePath.make(`templates/${template}`),
          text = yield* ownedFile(join(root, path), root);
        files.push({ path, hash: hash(text), bytes: Buffer.byteLength(text) });
      }
      ensure(
        files.reduce((total, file) => total + file.bytes, 0) <= 1024 * 1024,
        "SCHEMA_LIMIT",
        "Schema and templates exceed 1 MiB",
      );
      const identity = {
        schema_version: 1 as const,
        state: "bound" as const,
        selection_source: selection,
        name: resolution.name,
        source: resolution.source,
        root: AbsolutePath.make(root),
        files,
      };
      return { ...identity, hash: hash(canonicalJSON(identity)) };
    }),
  );
}
