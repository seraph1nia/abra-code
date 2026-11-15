/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Node filesystem layer, shared with the web launcher. */
import { NodeFileSystem } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { bootstrapService } from "../src/opencode/bootstrap.ts";

await Effect.runPromise(
  bootstrapService.pipe(
    Effect.flatMap(({ endpoint, supervisor }) =>
      Console.log(`Server: ${endpoint.url}\nAbra: ${supervisor.id}\nAttach: pnpm attach`),
    ),
    Effect.provide(NodeFileSystem.layer),
  ),
);
