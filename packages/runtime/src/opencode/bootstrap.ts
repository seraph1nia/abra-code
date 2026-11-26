import * as Id from "@abracode/contracts/identities";
import { resolve, join } from "node:path";
import { AbsolutePath, Agent } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { Config, Effect } from "effect";
import { realpath } from "../filesystem.ts";
import { makeClient, OPENCODE_VERSION } from "./client.ts";
import { findSupervisor } from "./supervisor.ts";
import { FileLocks } from "../storage/lock.ts";
import { loadConfig } from "../config/load.ts";
import { ProcessRunner } from "../process.ts";
import { openWorkGraph } from "../work/graph.ts";
import { generateHostConfiguration, assertFreshPaths } from "../config/host.ts";
import { identity, runtimePaths, resolveInstallationHome } from "../config/identity.ts";
import { CrewError } from "../domain.ts";
import { configuration } from "../config/protocol.ts";
import { awaitPluginActivation } from "./plugin-activation.ts";
export const bootstrapService = Effect.gen(function* () {
  if (process.platform !== "linux" && process.platform !== "darwin")
    return yield* new CrewError(
      "PLATFORM",
      "AbraCode requires Linux or macOS, Git and the fs-ext native binding.",
    );
  const home = yield* realpath(yield* resolveInstallationHome);
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
    file: runtimePaths(home).service,
    version: OPENCODE_VERSION,
  });
  const hostConfig = existingEndpoint
    ? runtimePaths(home).hostConfig
    : yield* generateHostConfiguration(config);
  if (!existingEndpoint) yield* Effect.scoped(openWorkGraph(config));
  const endpoint =
    existingEndpoint ??
    (yield* Service.ensure({
      file: runtimePaths(home).service,
      version: OPENCODE_VERSION,
      command: [resolve(home, "node_modules/.bin/opencode"), "serve", "--service", "--port", "0"],
      env: {
        XDG_STATE_HOME: state,
        OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
        ABRACODE_HOME: home,
        OPENCODE_CONFIG: hostConfig,
        ABRACODE_CONFIG: config.config_path,
        PATH: `${join(home, "node_modules/.bin")}:${yield* Config.String("PATH").pipe(Config.withDefault(""))}`,
      },
    }));
  const client = yield* makeClient(endpoint);
  const location = { directory: AbsolutePath.make(home) };
  yield* client.location.get({ location });
  yield* awaitPluginActivation(client, home);
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
            model: config.supervisor_model,
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
  return { home, endpoint, supervisor };
});
