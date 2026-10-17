import * as Id from "../src/identities.ts";
import { resolve, join } from "node:path";
import { AbsolutePath, Agent } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Console, Schedule } from "effect";
import { realpath } from "../src/filesystem.ts";
import { makeClient } from "../src/opencode/client.ts";
import { findSupervisor } from "../src/opencode/supervisor.ts";
import { FileLocks } from "../src/storage/lock.ts";
import { loadConfig } from "../src/config/load.ts";
import { ProcessRunner } from "../src/process.ts";
import { openWorkGraph } from "../src/work/graph.ts";
import { generateHostConfiguration, assertFreshPaths } from "../src/config/host.ts";
import { identity } from "../src/config/identity.ts";
import { CrewError } from "../src/domain.ts";
import { configuration } from "../src/config/protocol.ts";
const program = Effect.gen(function* () {
  if (process.platform !== "linux")
    return yield* new CrewError(
      "PLATFORM",
      "AbraCode currently supports Linux only (Git and util-linux flock required).",
    );
  const home = yield* realpath(process.env.ABRACODE_HOME ?? process.cwd());
  const config = yield* loadConfig(home);
  yield* assertFreshPaths(config);
  const runner = new ProcessRunner();
  for (const bin of [config.commands.openspec]) {
    yield* runner
      .run(bin, ["--version"], home)
      .pipe(
        Effect.mapError(
          (cause) =>
            new CrewError(
              "WORKFLOW_CLI",
              `Workflow CLI unavailable: ${bin}. Run mise run setup or pnpm install --frozen-lockfile --prod=false; check commands overrides in abracode.yaml.`,
              cause,
            ),
        ),
      );
  }
  const state = join(home, ".abracode/state");
  const existingEndpoint = yield* Service.discover({
    file: join(state, "opencode/service.json"),
    version: "2.0.28",
  });
  const hostConfig = existingEndpoint
    ? join(home, ".abracode/config/opencode/opencode.json")
    : yield* generateHostConfiguration(config);
  if (!existingEndpoint) yield* Effect.scoped(openWorkGraph(config));
  const endpoint =
    existingEndpoint ??
    (yield* Service.ensure({
      file: join(state, "opencode/service.json"),
      version: "2.0.28",
      command: [resolve(home, "node_modules/.bin/opencode"), "serve", "--service", "--port", "0"],
      env: {
        XDG_STATE_HOME: state,
        OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
        ABRACODE_HOME: home,
        OPENCODE_CONFIG: hostConfig,
        ABRACODE_CONFIG: config.config_path,
        PATH: `${join(home, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      },
    }));
  const client = yield* makeClient(endpoint);
  const location = { directory: AbsolutePath.make(home) };
  yield* client.location.get({ location });
  yield* client.plugin.list({ location }).pipe(
    Effect.repeat({
      schedule: Schedule.spaced(100),
      until: (plugins) =>
        plugins.data.some((p) => p.id === "abracode" && p.state?.status === "active"),
    }),
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () =>
        Effect.fail(
          new CrewError(
            "PLUGIN_ACTIVATION",
            "AbraCode plugin did not activate; inspect native plugin diagnostics",
          ),
        ),
    }),
  );
  const supervisor = yield* new FileLocks(Id.AbsolutePath.make(join(home, ".abracode/locks"))).with(
    Id.LockKey.make("supervisor-bootstrap"),
    () =>
      Effect.gen(function* () {
        const existing = yield* findSupervisor(client, home);
        return (
          existing ??
          (yield* client.session.create({
            title: "Abra",
            agent: Agent.ID.make(identity.agent),
            location,
            metadata: { abracode_supervisor_home: home },
          }))
        );
      }),
  );
  yield* client
    .rpc(configuration)
    .reconcile(
      { session_id: supervisor.id, action: "status", config_path: config.config_path },
      { location },
    );
  yield* Console.log(`Server: ${endpoint.url}\nAbra: ${supervisor.id}\nAttach: pnpm attach`);
});
await Effect.runPromise(program.pipe(Effect.provide(NodeFileSystem.layer)));
