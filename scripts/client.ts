import { spawn } from "node:child_process";
import { join } from "node:path";
import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { realpath } from "../src/filesystem.ts";
import { makeClient } from "../src/opencode/client.ts";
import { findSupervisor } from "../src/opencode/supervisor.ts";
import { runtimePaths, configurationPath } from "../src/config/identity.ts";
import { configuration } from "../src/config/protocol.ts";
import { AbsolutePath } from "../src/identities.ts";
import { CrewError } from "../src/domain.ts";
import { assertFreshPaths } from "../src/config/host.ts";
import { loadConfig } from "../src/config/load.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const home = yield* realpath(process.env.ABRACODE_HOME ?? process.cwd());
    yield* assertFreshPaths(yield* loadConfig(home));
    const state = join(home, ".abracode/state");
    const endpoint = yield* Service.discover({
      file: join(state, "opencode/service.json"),
      version: "2.0.28",
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
        config_path: AbsolutePath.make(configurationPath(home)),
      },
      { location: { directory: AbsolutePath.make(home) } },
    );
    const extra = process.argv.slice(2);
    const args = extra.includes("--pair")
      ? ["pair", ...extra.filter((a) => a !== "--pair")]
      : extra.includes("--auth")
        ? ["auth", "login", "--server", endpoint.url, ...extra.filter((a) => a !== "--auth")]
        : ["--server", endpoint.url, "--session", supervisor.id, home];
    const code = yield* Effect.callback<number, CrewError>((resume) => {
      const child = spawn(join(home, "node_modules/.bin/opencode"), args, {
        stdio: "inherit",
        env: {
          ...process.env,
          XDG_STATE_HOME: state,
          ABRACODE_HOME: home,
          OPENCODE_CONFIG: runtimePaths(home).hostConfig,
          OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
          ABRACODE_CONFIG: configurationPath(home),
          ...(endpoint.auth ? { OPENCODE_PASSWORD: endpoint.auth.password } : {}),
        },
      });
      child.once("error", (cause) => resume(Effect.fail(CrewError.from(cause))));
      child.once("exit", (code) => resume(Effect.succeed(code ?? 1)));
      return Effect.sync(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      });
    });
    yield* Effect.sync(() => {
      process.exitCode = code;
    });
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
