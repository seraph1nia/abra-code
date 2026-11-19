/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect platform APIs are required by the native adapters and covered by integration tests. */
import * as Id from "../identities.ts";
import { resolve, join } from "node:path";
import { AbsolutePath, Agent } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { Effect } from "effect";
import { realpath } from "../filesystem.ts";
import { makeClient } from "../opencode/client.ts";
import { findSupervisor } from "../opencode/supervisor.ts";
import { FileLocks } from "../storage/lock.ts";
import { loadConfig } from "../config/load.ts";
import { ProcessRunner } from "../process.ts";
import { openWorkGraph } from "../work/graph.ts";
import { generateHostConfiguration, assertFreshPaths } from "../config/host.ts";
import { identity } from "../config/identity.ts";
import { CrewError } from "../domain.ts";
import { configuration } from "../config/protocol.ts";
import { awaitPluginActivation } from "./plugin-activation.ts";
export const bootstrapService = Effect.gen(function* () {
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
    version: "2.3.0",
  });
  const hostConfig = existingEndpoint
    ? join(home, ".abracode/config/opencode/opencode.json")
    : yield* generateHostConfiguration(config);
  if (!existingEndpoint) yield* Effect.scoped(openWorkGraph(config));
  const endpoint =
    existingEndpoint ??
    (yield* Service.ensure({
      file: join(state, "opencode/service.json"),
      version: "2.3.0",
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
