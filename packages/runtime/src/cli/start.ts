import { Console, Effect } from "effect";
import { bootstrapService } from "../opencode/bootstrap.ts";

export const runServe = bootstrapService.pipe(
  Effect.flatMap(({ endpoint, supervisor }) =>
    Console.log(`Server: ${endpoint.url}\nAbra: ${supervisor.id}\nAttach: pnpm attach`),
  ),
);
