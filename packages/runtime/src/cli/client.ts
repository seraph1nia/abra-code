import { join } from "node:path";
import { Service } from "@opencode/client/effect/service";
import { Effect, Option } from "effect";
import { ChildProcess } from "effect/process";
import { assertFreshPaths } from "../config/host.ts";
import {
  resolveConfigurationPath,
  resolveInstallationHome,
  runtimePaths,
} from "../config/identity.ts";
import { loadConfig } from "../config/load.ts";
import { configuration } from "../config/protocol.ts";
import { CrewError } from "../domain.ts";
import { realpath } from "../filesystem.ts";
import { AbsolutePath } from "@abracode/contracts/identities";
import { makeClient, OPENCODE_VERSION } from "../opencode/client.ts";
import { findSupervisor } from "../opencode/supervisor.ts";

export interface ClientOptions {
  readonly pair: boolean;
  readonly auth: boolean;
  readonly url: Option.Option<string>;
  readonly extra: ReadonlyArray<string>;
}

export const runClient = (options: ClientOptions) =>
  Effect.gen(function* () {
    const home = yield* realpath(yield* resolveInstallationHome);
    yield* assertFreshPaths(yield* loadConfig(home));
    const configPath = yield* resolveConfigurationPath(home);
    const state = join(home, ".abracode/state");
    const endpoint = yield* Service.discover({
      file: runtimePaths(home).service,
      version: OPENCODE_VERSION,
    });
    if (!endpoint)
      return yield* new CrewError(
        "SERVER_ENDPOINT",
        "AbraCode service is not running; run pnpm start",
      );
    const client = yield* makeClient(endpoint);
    const supervisor = yield* findSupervisor(client, home);
    if (!supervisor)
      return yield* new CrewError(
        "SUPERVISOR_MISSING",
        "No Supervisor session; run pnpm start to bootstrap it",
      );
    yield* client.rpc(configuration).reconcile(
      {
        session_id: supervisor.id,
        action: "status",
        config_path: AbsolutePath.make(configPath),
      },
      { location: { directory: AbsolutePath.make(home) } },
    );
    const serverUrl = Option.getOrElse(options.url, () => endpoint.url);
    const args = options.pair
      ? ["pair", ...options.extra]
      : options.auth
        ? ["auth", "login", "--server", serverUrl, ...options.extra]
        : ["--server", serverUrl, "--session", supervisor.id, home, ...options.extra];
    const code = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* ChildProcess.make(join(home, "node_modules/.bin/opencode"), args, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          extendEnv: true,
          env: {
            XDG_STATE_HOME: state,
            ABRACODE_HOME: home,
            OPENCODE_CONFIG: runtimePaths(home).hostConfig,
            OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
            ABRACODE_CONFIG: configPath,
            ...(endpoint.auth ? { OPENCODE_PASSWORD: endpoint.auth.password } : {}),
          },
        });
        return yield* child.exitCode;
      }),
    ).pipe(Effect.mapError((cause) => CrewError.from(cause.reason.cause ?? cause)));
    yield* Effect.sync(() => {
      process.exitCode = Number(code);
    });
  });
