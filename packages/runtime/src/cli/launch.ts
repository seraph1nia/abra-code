import { Effect, Option } from "effect";
import { CrewError } from "../domain.ts";
import { runClient } from "./client.ts";
import { runServe } from "./start.ts";

export const runLaunch = Effect.gen(function* () {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return yield* new CrewError(
      "TERMINAL_REQUIRED",
      "pnpm start opens Abra interactively. Use pnpm service:start for background/bootstrap use.",
    );
  yield* runServe;
  yield* runClient({ pair: false, auth: false, url: Option.none(), extra: [] });
});
