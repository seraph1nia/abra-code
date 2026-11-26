import { join } from "node:path";
import { CommandExit } from "./exit.ts";
import { AbsolutePath } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { Console, Effect } from "effect";
import { modelRoles, resolveInstallationHome, runtimePaths } from "../config/identity.ts";
import { loadConfig } from "../config/load.ts";
import { scopedTemporaryDirectory } from "../filesystem.ts";
import { Executable, LockKey } from "@abracode/contracts/identities";
import { checkMemoryVersionEffect } from "../memory/provider.ts";
import { makeClient, OPENCODE_VERSION } from "../opencode/client.ts";
import { ProcessRunner } from "../process.ts";
import { FileLocks } from "../storage/lock.ts";
import { visibility } from "../visibility/protocol.ts";

export const runDoctor = Effect.gen(function* () {
  const config = yield* loadConfig(yield* resolveInstallationHome);
  const runner = new ProcessRunner();
  let failed = false;
  const recordFailure = Effect.sync(() => {
    failed = true;
  });
  if (config.memory?.enabled) {
    const executable = config.memory.executable;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scopedTemporaryDirectory("abra-memory-doctor-");
        yield* checkMemoryVersionEffect(executable, root);
        yield* Console.log("Basic Memory 1.0.0 available for local stdio.");
      }),
    ).pipe(
      Effect.catch((error) => Console.error(error.message).pipe(Effect.andThen(recordFailure))),
    );
  }
  const browser = join(config.home, "node_modules/.bin/agent-browser");
  yield* Console.log(
    `Capacity: ${config.max_workers} active workers; ${config.max_executions ?? config.max_workers} execution slots`,
  );
  const endpoint = yield* Service.discover({
    file: runtimePaths(config.home).service,
    version: OPENCODE_VERSION,
  });
  if (endpoint) {
    const client = yield* makeClient(endpoint);
    yield* client.model.list({ location: { directory: AbsolutePath.make(config.home) } }).pipe(
      Effect.timeout("5 seconds"),
      Effect.flatMap((inventory) =>
        Effect.forEach(modelRoles, (role) => {
          const selected = config.models.overrides?.[role] ?? config.models.default;
          const model = inventory.data.find(
            (m) => m.providerID === selected.providerID && m.id === selected.id,
          );
          const ready =
            model?.enabled &&
            (!selected.variant ||
              selected.variant === "default" ||
              model.variants.some((v) => v.id === selected.variant));
          return Console.log(
            `${role === "supervisor" ? "Abra" : role}: ${ready ? "native model/variant available" : "configured model/variant unavailable"}; provider authentication unverified until a request succeeds`,
          ).pipe(Effect.andThen(ready ? Effect.void : recordFailure));
        }),
      ),
      Effect.catch(() =>
        Console.log(
          "Live model inventory unavailable; provider/model/variant readiness unverified.",
        ),
      ),
    );
    yield* client
      .rpc(visibility)
      .snapshot({}, { location: { directory: AbsolutePath.make(config.home) } })
      .pipe(
        Effect.timeout("5 seconds"),
        Effect.flatMap((snapshot) =>
          Console.log({ record_diagnostics: snapshot.record_diagnostics ?? [] }),
        ),
        Effect.catch((error) =>
          Console.error(
            `Record inspection unavailable: ${error instanceof Error ? error.message : "Native inspection failed"}`,
          ),
        ),
      );
  } else
    yield* Console.log(
      "Record inspection and live provider/model/variant readiness unverified: service is not running; no records were rewritten.",
    );
  yield* Effect.scoped(
    Effect.gen(function* () {
      const root = yield* scopedTemporaryDirectory("abracode-doctor-lock-");
      yield* new FileLocks(root).with(LockKey.make("doctor"), () =>
        Console.log("fs-ext: native kernel locking available"),
      );
    }),
  ).pipe(
    Effect.catch((error) =>
      Console.error(`fs-ext: ${error.message}`).pipe(Effect.andThen(recordFailure)),
    ),
  );
  const checks = [
    [join(config.home, "node_modules/.bin/opencode"), ["--version"]],
    [browser, ["--version"]],
    [config.commands.openspec, ["--version"]],
    ["git", ["--version"]],
    [config.commands.forge, ["--version"]],
  ] as const;
  yield* Effect.forEach(
    checks,
    ([bin, args]) =>
      runner
        .run(Executable.make(bin), [...args], config.home, undefined, {
          deadline_ms: 5000,
          max_output_bytes: 8192,
        })
        .pipe(
          Effect.flatMap((output) => Console.log(`${bin}: ${output.split("\n")[0]}`)),
          Effect.catch((error) =>
            Console.error(
              `${bin}: ${error.message}${bin === browser ? "\nRestore the central install with pnpm install --frozen-lockfile --prod=false; ensure agent-browser is allowed in pnpm-workspace.yaml allowBuilds, then run pnpm rebuild agent-browser. No global CLI fallback is used." : ""}`,
            ).pipe(
              Effect.andThen(
                bin !== config.commands.forge ||
                  config.repositories.some((r) => (r.delivery ?? "github-pr") === "github-pr")
                  ? recordFailure
                  : Effect.void,
              ),
            ),
          ),
        ),
    { concurrency: "unbounded" },
  );
  yield* Console.log(
    "Browser setup (explicit, as the service user): pnpm browser:install, or set AGENT_BROWSER_EXECUTABLE_PATH to compatible system Chromium. Linux libraries must be installed separately; see docs/operations.md. Chrome is needed only for browser work. No browser was launched or repaired by this check.",
  );
  if (failed) return yield* new CommandExit({ status: 1 });
});
