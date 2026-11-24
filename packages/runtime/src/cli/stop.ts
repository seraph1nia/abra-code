import { Console, Effect } from "effect";
import { assertFreshPaths } from "../config/host.ts";
import { resolveInstallationHome } from "../config/identity.ts";
import { loadConfig } from "../config/load.ts";
import { realpath } from "../filesystem.ts";
import { stopService } from "../opencode/stop.ts";

export const runStop = Effect.gen(function* () {
  const home = yield* realpath(yield* resolveInstallationHome);
  const config = yield* loadConfig(home);
  yield* assertFreshPaths(config);
  yield* stopService(config);
  yield* Console.log(
    "AbraCode native service stopped. Execution records and session histories retained.",
  );
});
