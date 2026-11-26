import { sha256 } from "../digest.ts";
import { tryDomainValue } from "../effect.ts";
import { ConfigurationError } from "../errors.ts";
import { validateDispatch } from "./dispatch.ts";
import { capabilityRequirements } from "../opencode/role-policy.ts";
import { Effect, Schema } from "effect";
import { CrewError, type Config } from "../domain.ts";
import { readFile, realpath } from "../filesystem.ts";
import { join } from "node:path";
import { decode } from "../decode.ts";
import { ConfigInputSchema, ConfigSchema, parseYaml } from "./contracts.ts";
import { resolveConfigurationPath, modelRoles } from "./identity.ts";
import { remoteIdentity } from "../git/source.ts";
import { readDevNotebook } from "./memos.ts";

export const configDigest = (content: string) => sha256(content);

export function resolveConfig(
  home: string,
  path: string,
  content: string,
): Effect.Effect<Config, CrewError> {
  return Effect.gen(function* () {
    const raw = yield* parseYaml(content, "AbraCode configuration");
    const input = yield* Schema.decodeUnknownEffect(ConfigInputSchema, {
      onExcessProperty: "error",
      reportInput: false,
    })(raw).pipe(
      Effect.mapError(
        (error) =>
          new ConfigurationError(
            "CONFIG",
            `AbraCode configuration: ${error.message.slice(0, 2048)}`,
          ),
      ),
    );
    const mode = input.supervision_mode;
    const explicitSchedule = typeof raw === "object" && raw !== null && "auto_schedule" in raw;
    const autoSchedule = mode ? mode !== "manual" : input.auto_schedule;
    if (mode && explicitSchedule && input.auto_schedule !== autoSchedule)
      return yield* new ConfigurationError(
        "CONFIG",
        "supervision_mode conflicts with explicit auto_schedule",
      );
    const ids = new Set<string>();
    const remotes = new Set<string>();
    for (const repository of input.repositories ?? []) {
      if (ids.has(repository.id))
        return yield* new ConfigurationError(
          "CONFIG",
          `repositories: duplicate ID ${repository.id}`,
        );
      ids.add(repository.id);
      if (!repository.remote && !repository.path)
        return yield* new ConfigurationError(
          "CONFIG",
          `repositories.${repository.id}: remote or path is required`,
        );
      const keys = [
        ...(repository.remote ? [yield* tryDomainValue(remoteIdentity, repository.remote)] : []),
        ...(repository.path ? [`path:${repository.path}`] : []),
      ];
      for (const key of keys) {
        if (remotes.has(key))
          return yield* new ConfigurationError(
            "CONFIG",
            `repositories.${repository.id}: duplicate repository identity (already registered in another declaration)`,
          );
        remotes.add(key);
      }
    }
    const workers = Object.fromEntries(
      modelRoles
        .filter((role) => role !== "supervisor")
        .map((role) => [
          role,
          {
            ...input.workers?.[role],
            definition: input.workers?.[role]?.definition ?? role,
            model: input.models.overrides?.[role] ?? input.models.default,
          },
        ]),
    );
    const config = yield* decode(
      ConfigSchema,
      {
        ...input,
        auto_schedule: autoSchedule,
        home,
        config_path: path,
        config_digest: configDigest(content),
        work_database: input.work_database ?? join(home, ".abracode/work.sqlite"),
        worktree_root: input.worktree_root ?? join(home, ".abracode/worktrees"),
        repository_root: input.repository_root ?? join(home, ".abracode/repositories"),
        workers,
        supervisor_model: input.models.overrides?.supervisor ?? input.models.default,
        repositories: input.repositories ?? [],
        max_executions: input.max_executions ?? input.max_workers,
        attention_capacity: input.attention_capacity ?? 1,
        research_capacity: input.research_capacity ?? input.explore_capacity,
        progress_timeout_ms: input.progress_timeout_ms ?? {
          explore: 900000,
          apply: 1800000,
          review: 900000,
          research: 900000,
          operation: 300000,
        },
        commands: {
          openspec: input.commands?.openspec ?? join(home, "node_modules/.bin/openspec"),
          forge: input.commands?.forge ?? "gh",
        },
      },
      "Resolved AbraCode configuration",
    );
    for (const role of ["explore", "apply", "review", "research"] as const)
      yield* tryDomainValue(
        capabilityRequirements,
        role,
        config.default_workflow,
        config.workers[role],
      );
    for (const project of config.repositories)
      yield* tryDomainValue(validateDispatch, config, project.dispatch);
    return config;
  });
}

export function loadPersonalConfig(home: string): Effect.Effect<Config, CrewError> {
  return Effect.gen(function* () {
    home = yield* realpath(home);
    const path = yield* resolveConfigurationPath(home);
    const content = yield* readFile(path, "utf8").pipe(
      Effect.catchIf(
        (error) => error.code === "ENOENT",
        () =>
          Effect.fail(
            new ConfigurationError(
              "CONFIG_MISSING",
              `Missing ${path}. Copy abracode.example.yaml to abracode.yaml and choose models.default.`,
            ),
          ),
      ),
    );
    return yield* resolveConfig(home, path, content);
  });
}

export const loadConfig = (home: string) =>
  Effect.gen(function* () {
    const config = yield* loadPersonalConfig(home);
    if (!config.memos) config.memos = yield* readDevNotebook(config);
    return config;
  });
