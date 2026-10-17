import { Executable } from "../src/identities.ts";
import { Effect, Console } from "effect";
import { ProcessRunner } from "../src/process.ts";
import { loadConfig } from "../src/config/load.ts";
import { NodeFileSystem } from "@effect/platform-node";
import { AbsolutePath } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { makeClient } from "../src/opencode/client.ts";
import { visibility } from "../src/visibility/protocol.ts";
import { join } from "node:path";
import { modelRoles } from "../src/config/identity.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const config = yield* loadConfig(process.env.ABRACODE_HOME ?? process.cwd());
    const runner = new ProcessRunner();
    const browser = join(config.home, "node_modules/.bin/agent-browser");
    yield* Console.log(
      `Capacity: ${config.max_workers} active workers; ${config.max_executions ?? config.max_workers} retained executions`,
    );
    const endpoint = yield* Service.discover({
      file: join(config.home, ".abracode/state/opencode/service.json"),
      version: "2.0.28",
    }).pipe(Effect.provide(NodeFileSystem.layer));
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
            ).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (!ready) process.exitCode = 1;
                }),
              ),
            );
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
    for (const [bin, args] of [
      [join(config.home, "node_modules/.bin/opencode"), ["--version"]],
      [browser, ["--version"]],
      [config.commands.openspec, ["--version"]],
      ["git", ["--version"]],
      ["flock", ["--version"]],
      [config.commands.forge, ["--version"]],
    ] as const) {
      yield* runner
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
                Effect.sync(() => {
                  if (
                    bin !== config.commands.forge ||
                    config.repositories.some((r) => (r.delivery ?? "github-pr") === "github-pr")
                  )
                    process.exitCode = 1;
                }),
              ),
            ),
          ),
        );
    }
    yield* Console.log(
      "Browser setup (explicit, as the service user): pnpm browser:install, or set AGENT_BROWSER_EXECUTABLE_PATH to compatible system Chromium. Linux libraries must be installed separately; see docs/operations.md. Chrome is needed only for browser work. No browser was launched or repaired by this check.",
    );
  }),
);
