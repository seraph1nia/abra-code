import { isDeepStrictEqual } from "node:util";
import { CommandExit } from "./exit.ts";
import { Service } from "@opencode/client/effect/service";
import { Console, Effect, FileSystem, Schema } from "effect";
import { ConfigInputSchema } from "../config/contracts.ts";
import { resolveInstallationHome, runtimePaths } from "../config/identity.ts";
import { loadConfig } from "../config/load.ts";
import { presentConfig } from "../config/presentation.ts";
import { configuration } from "../config/protocol.ts";
import { CrewError } from "../domain.ts";
import { AbsolutePath } from "@abracode/contracts/identities";
import { makeClient, OPENCODE_VERSION } from "../opencode/client.ts";
import { findSupervisor } from "../opencode/supervisor.ts";

const runConfigInspect = (show: boolean, json: boolean) =>
  Effect.gen(function* () {
    const config = yield* loadConfig(yield* resolveInstallationHome);
    const result = show
      ? presentConfig(config)
      : {
          valid: true,
          config_path: config.config_path,
          live_readiness: "unverified",
        };
    yield* Console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
  }).pipe(
    Effect.catch((error) =>
      Console.error(
        JSON.stringify({ valid: false, code: error.code, message: error.message }),
      ).pipe(Effect.andThen(Effect.fail(new CommandExit({ status: 1 })))),
    ),
  );

export const runConfigValidate = (json: boolean) => runConfigInspect(false, json);

export const runConfigShow = (json: boolean) => runConfigInspect(true, json);

export interface ConfigApplyOptions {
  readonly status: boolean;
  readonly page: number;
  readonly json: boolean;
}

export const runConfigApply = (options: ConfigApplyOptions) =>
  Effect.gen(function* () {
    if (!Number.isSafeInteger(options.page) || options.page < 0)
      return yield* new CrewError("PAGE", "--page requires a nonnegative integer");
    const config = yield* loadConfig(yield* resolveInstallationHome);
    const endpoint = yield* Service.discover({
      file: runtimePaths(config.home).service,
      version: OPENCODE_VERSION,
    });
    if (!endpoint)
      return yield* new CrewError(
        "SERVICE_REQUIRED",
        "Run pnpm service:start first; config:apply requires the native service",
      );
    const client = yield* makeClient(endpoint);
    const session = yield* findSupervisor(client, AbsolutePath.make(config.home));
    if (!session)
      return yield* new CrewError(
        "ABRA_REQUIRED",
        "Abra was not bootstrapped; run pnpm service:start",
      );
    const result = yield* client.rpc(configuration).reconcile(
      {
        session_id: session.id,
        page: options.page,
        config_path: config.config_path,
        action: options.status ? "status" : "apply",
      },
      { location: { directory: AbsolutePath.make(config.home) } },
    );
    yield* Console.log(JSON.stringify(result, null, options.json ? undefined : 2));
    if (result.outcomes.some((o) => o.status === "apply-failed" || o.status === "declared/pending"))
      return yield* new CommandExit({ status: 1 });
  });

export const runConfigSchema = (options: { readonly write: boolean; readonly check: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (options.write && options.check)
      return yield* new CrewError("CONFIG_SCHEMA_MODE", "Choose --write or --check");
    const document = Schema.toJsonSchemaDocument(ConfigInputSchema, { onExcessProperty: "error" });
    const output =
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          ...document.schema,
          $defs: document.definitions,
        },
        null,
        2,
      ) + "\n";
    if (options.write) {
      yield* fs
        .writeFileString("abracode.schema.json", output)
        .pipe(Effect.mapError((cause) => CrewError.from(cause.reason.cause ?? cause)));
      return;
    }
    const existing = yield* fs
      .readFileString("abracode.schema.json", "utf8")
      .pipe(Effect.mapError((cause) => CrewError.from(cause.reason.cause ?? cause)));
    const parsedExisting: unknown = yield* Effect.try({
      try: () => JSON.parse(existing),
      catch: CrewError.from,
    });
    const parsedOutput: unknown = JSON.parse(output);
    if (!isDeepStrictEqual(parsedExisting, parsedOutput))
      return yield* new CrewError(
        "CONFIG_SCHEMA_STALE",
        "Config schema is stale; run pnpm config:schema --write",
      );
  });
