import { Effect, Schema } from "effect";
import { parseDocument } from "yaml";
import { randomUUID } from "node:crypto";
import { type Config, type OnboardInput, CrewError } from "../domain.ts";
import { LockKey, StorageKey } from "../identities.ts";
import { type Locks } from "../storage/lock.ts";
import { type Records } from "../storage/store.ts";
import { readFile, writeFile, rename, rm } from "../filesystem.ts";
import { configDigest, resolveConfig } from "./load.ts";
import { ProjectInputSchema } from "./contracts.ts";
import { digest } from "../digest.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { Count } from "../contracts.ts";

export const DeclarationOutcomeSchema = Schema.Struct({
  id: ProjectInputSchema.fields.id,
  status: Schema.Literals([
    "declared/pending",
    "registered/ready",
    "registered/setup-blocked",
    "apply-failed",
    "retained/undeclared",
  ]),
  digest: Schema.String,
  error: Schema.optional(Schema.String),
});
export type DeclarationOutcome = typeof DeclarationOutcomeSchema.Type;
export const ConfigurationReportSchema = Schema.Struct({
  outcomes: Schema.Array(DeclarationOutcomeSchema).check(Schema.isMaxLength(128)),
  total: Count,
  next_page: Schema.optional(Count),
  restart_required_for_process_settings: Schema.Boolean,
});
export const configurationReport = (outcomes: DeclarationOutcome[], page = 0) => ({
  outcomes: outcomes.slice(page * 128, (page + 1) * 128),
  total: outcomes.length,
  ...((page + 1) * 128 < outcomes.length ? { next_page: page + 1 } : {}),
  restart_required_for_process_settings: true,
});
const key = (id: string) => StorageKey.make(`configuration/${id}`);
export const declarationDigest = (input: OnboardInput) => digest(input);
export const declarationOutcome = (
  records: Records,
  id: string,
): Effect.Effect<DeclarationOutcome | undefined, CrewError> =>
  Effect.gen(function* () {
    const value = yield* records.store.get(key(id));
    if (value === undefined) return undefined;
    return yield* decode(DeclarationOutcomeSchema, value, "Repository configuration outcome");
  });
export const saveDeclarationOutcome = (records: Records, outcome: DeclarationOutcome) =>
  records.coordinateCommit(() => records.store.set(key(outcome.id), outcome));

/** Only this seam edits the selected personal file; network operations never hold its lock. */
export const configurationFiles = { readFile, writeFile, rename, rm };
export const saveDeclaration = (
  config: Config,
  input: OnboardInput,
  locks: Locks,
  files = configurationFiles,
) =>
  locks.with(LockKey.make(`config-${configDigest(config.config_path).slice(0, 32)}`), () =>
    domainEffect(
      Effect.gen(function* () {
        const before = yield* files.readFile(config.config_path, "utf8");
        const current = yield* resolveConfig(config.home, config.config_path, before);
        const previous = current.repositories.find((p) => p.id === input.id);
        const updates = Object.fromEntries(
          Object.entries(input).filter(
            ([name, value]) => name in ProjectInputSchema.fields && value !== undefined,
          ),
        );
        const declaration = yield* decode(
          ProjectInputSchema,
          { ...previous, ...updates },
          "Repository declaration",
        );
        const document = parseDocument(before, { uniqueKeys: true });
        const index = current.repositories.findIndex((p) => p.id === input.id);
        if (!document.has("repositories")) document.set("repositories", document.createNode([]));
        if (index < 0) document.addIn(["repositories"], document.createNode(declaration));
        else
          for (const [name, value] of Object.entries(updates))
            document.setIn(["repositories", index, name], document.createNode(value));
        const after = document.toString();
        const resolved = yield* resolveConfig(config.home, config.config_path, after);
        if (after !== before) {
          const temporary = `${config.config_path}.${randomUUID()}.tmp`;
          yield* Effect.gen(function* () {
            yield* files.writeFile(temporary, after, { mode: 0o600, flag: "wx" });
            if ((yield* files.readFile(config.config_path, "utf8")) !== before)
              return yield* new CrewError(
                "CONFIG_CONFLICT",
                "Configuration changed while preparing a repository update; reread and retry. User edits were preserved.",
              );
            yield* files.rename(temporary, config.config_path);
          }).pipe(Effect.ensuring(files.rm(temporary, { force: true }).pipe(Effect.orDie)));
        }
        config.repositories = resolved.repositories;
        config.config_digest = resolved.config_digest;
        return resolved.repositories.find((p) => p.id === input.id)!;
      }),
    ),
  );
