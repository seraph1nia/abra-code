import { Effect, Console } from "effect";
import { loadConfig } from "../src/config/load.ts";
import { installationHome } from "../src/config/identity.ts";
import { presentConfig } from "../src/config/presentation.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const config = yield* loadConfig(installationHome());
    const result = process.argv.includes("--show")
      ? presentConfig(config)
      : {
          valid: true,
          config_path: config.config_path,
          live_readiness: "unverified",
        };
    yield* Console.log(
      process.argv.includes("--json") ? JSON.stringify(result) : JSON.stringify(result, null, 2),
    );
  }).pipe(
    Effect.catch((error) =>
      Console.error(
        JSON.stringify({ valid: false, code: error.code, message: error.message }),
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
    ),
  ),
);
