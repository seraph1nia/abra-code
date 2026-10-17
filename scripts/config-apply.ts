import { Effect, Console } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Service } from "@opencode/client/effect/service";
import { loadConfig } from "../src/config/load.ts";
import { installationHome, runtimePaths } from "../src/config/identity.ts";
import { makeClient } from "../src/opencode/client.ts";
import { findSupervisor } from "../src/opencode/supervisor.ts";
import { AbsolutePath } from "../src/identities.ts";
import { configuration } from "../src/config/protocol.ts";
import { CrewError } from "../src/domain.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const config = yield* loadConfig(installationHome());
    const endpoint = yield* Service.discover({
      file: runtimePaths(config.home).service,
      version: "2.0.28",
    });
    if (!endpoint)
      return yield* new CrewError(
        "SERVICE_REQUIRED",
        "Run pnpm service:start first; config:apply requires the native service",
      );
    const client = yield* makeClient(endpoint);
    const session = yield* findSupervisor(client, AbsolutePath.make(config.home));
    if (!session)
      return yield* new CrewError(
        "ABRA_REQUIRED",
        "Abra was not bootstrapped; run pnpm service:start",
      );
    const page = process.argv.indexOf("--page");
    const selectedPage = page < 0 ? 0 : Number(process.argv[page + 1]);
    if (!Number.isSafeInteger(selectedPage) || selectedPage < 0)
      return yield* new CrewError("PAGE", "--page requires a nonnegative integer");
    const result = yield* client.rpc(configuration).reconcile(
      {
        session_id: session.id,
        page: selectedPage,
        config_path: config.config_path,
        action: process.argv.includes("--status") ? "status" : "apply",
      },
      { location: { directory: AbsolutePath.make(config.home) } },
    );
    yield* Console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? undefined : 2),
    );
    if (result.outcomes.some((o) => o.status === "apply-failed" || o.status === "declared/pending"))
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
