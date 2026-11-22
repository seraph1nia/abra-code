/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned native Service and Node filesystem APIs. */
import { Service } from "@opencode/client/effect/service";
import { Effect } from "effect";
import { join } from "node:path";
import { configuration } from "../config/protocol.ts";
import { runtimePaths } from "../config/identity.ts";
import { decodeJSON } from "../decode.ts";
import { CrewError, type Config } from "../domain.ts";
import { readFile, realpath } from "../filesystem.ts";
import { makeClient } from "./client.ts";
import { awaitPluginState } from "./plugin-activation.ts";
import { findSupervisor } from "./supervisor.ts";

const ownershipError = () =>
  new CrewError(
    "SERVICE_OWNERSHIP",
    "Cannot confirm this installation's native service and selected configuration. No service was stopped; inspect the registration and native process.",
  );

/** A failed import cannot answer RPCs or create Abra. Verify its native process instead. */
export const stopService = (config: Config) =>
  Effect.gen(function* () {
    const file = runtimePaths(config.home).service;
    const endpoint = yield* Service.discover({ file, version: "2.3.0" });
    if (!endpoint) return;
    const client = yield* makeClient(endpoint);
    const state = yield* awaitPluginState(client, config.home);
    if (!state) return yield* ownershipError();
    if (state.status === "failed") {
      yield* Effect.gen(function* () {
        const registration = yield* readFile(file, "utf8");
        const info = yield* decodeJSON(Service.Info, registration, "Native service registration");
        const server = yield* client.server.info();
        if (info.pid !== server.pid || info.version !== server.version || info.url !== endpoint.url)
          return yield* ownershipError();
        const command = (yield* readFile(`/proc/${info.pid}/cmdline`, "utf8")).split("\0");
        if (command[1] !== "serve" || command[2] !== "--service") return yield* ownershipError();
        const executable = yield* realpath(command[0]);
        const installed = yield* realpath(
          join(config.home, "node_modules/@opencode/cli/bin/opencode.exe"),
        );
        if (executable !== installed) return yield* ownershipError();
        const environment = new Map(
          (yield* readFile(`/proc/${info.pid}/environ`, "utf8")).split("\0").map((entry) => {
            const separator = entry.indexOf("=");
            return [entry.slice(0, separator), entry.slice(separator + 1)];
          }),
        );
        for (const [key, expected] of Object.entries({
          ABRACODE_HOME: config.home,
          ABRACODE_CONFIG: config.config_path,
          OPENCODE_CONFIG: runtimePaths(config.home).hostConfig,
          OPENCODE_CONFIG_DIR: join(config.home, ".abracode/config/opencode"),
          XDG_STATE_HOME: join(config.home, ".abracode/state"),
        }))
          if (environment.get(key) !== expected) return yield* ownershipError();
        if ((yield* readFile(file, "utf8")) !== registration) return yield* ownershipError();
      }).pipe(Effect.mapError(ownershipError));
    } else {
      const abra = yield* findSupervisor(client, config.home);
      if (!abra) return yield* ownershipError();
      yield* client
        .rpc(configuration)
        .reconcile(
          { session_id: abra.id, action: "status", config_path: config.config_path },
          { location: { directory: config.home } },
        );
    }
    yield* Service.stop({ file, pty: "clear" });
  });
