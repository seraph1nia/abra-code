/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect platform APIs are required by the native adapters and covered by integration tests. */
import { NodeFileSystem } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { loadConfig } from "../config/load.ts";
import { assertFreshPaths } from "../config/host.ts";
import { realpath } from "../filesystem.ts";
import { stopService } from "../opencode/stop.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const home = yield* realpath(process.env.ABRACODE_HOME ?? process.cwd());
    const config = yield* loadConfig(home);
    yield* assertFreshPaths(config);
    yield* stopService(config);
    yield* Console.log(
      "AbraCode native service stopped. Execution records and session histories retained.",
    );
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
