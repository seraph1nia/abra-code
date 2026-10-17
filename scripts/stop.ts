import { resolve, join } from "node:path";
import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { loadConfig } from "../src/config/load.ts";
import { assertFreshPaths } from "../src/config/host.ts";
import { makeClient } from "../src/opencode/client.ts";
import { findSupervisor } from "../src/opencode/supervisor.ts";
import { configuration } from "../src/config/protocol.ts";
import { CrewError } from "../src/domain.ts";
const home = resolve(process.env.ABRACODE_HOME ?? process.cwd());
await Effect.runPromise(
  Effect.gen(function* () {
    const config = yield* loadConfig(home);
    yield* assertFreshPaths(config);
    const file = join(home, ".abracode/state/opencode/service.json");
    const endpoint = yield* Service.discover({ file, version: "2.0.28" });
    if (endpoint) {
      const client = yield* makeClient(endpoint);
      const abra = yield* findSupervisor(client, config.home);
      if (!abra)
        return yield* new CrewError(
          "SERVICE_OWNERSHIP",
          "Cannot confirm this installation's Abra session; inspect the service registration before stopping it. No service was stopped.",
        );
      yield* client
        .rpc(configuration)
        .reconcile(
          { session_id: abra.id, action: "status", config_path: config.config_path },
          { location: { directory: config.home } },
        );
      yield* Service.stop({ file, pty: "clear" });
    }
    yield* Console.log(
      "AbraCode native service stopped. Execution records and session histories retained.",
    );
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
