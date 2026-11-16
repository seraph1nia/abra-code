/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned native service discovery, as used by the terminal launcher. */
import { NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Service } from "@opencode/client/effect/service";
import { Console, Effect } from "effect";
import { bootstrapService } from "../opencode/bootstrap.ts";
import { runtimePaths } from "../config/identity.ts";
import { CrewError } from "../domain.ts";
import { workspaceServer } from "../web/server.ts";
import { NativeWebBackend } from "../web/backend.ts";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: pnpm web [--port 4097] [--no-open]\nOpens the single-session AbraCode CopilotKit workspace on localhost.",
  );
} else {
  const program = Effect.gen(function* () {
    let port = 4097;
    let open = true;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--no-open") open = false;
      else if (args[i] === "--port" && /^\d+$/.test(args[i + 1] ?? "")) port = Number(args[++i]);
      else
        return yield* new CrewError("WEB_ARGUMENTS", "Usage: pnpm web [--port 4097] [--no-open]");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return yield* new CrewError("WEB_ARGUMENTS", "Port must be between 1 and 65535.");
    const { home, supervisor } = yield* bootstrapService;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const backend = new NativeWebBackend(
          home,
          supervisor.id,
          Service.discover({ file: runtimePaths(home).service, version: "2.3.0" }).pipe(
            Effect.provide(NodeFileSystem.layer),
          ),
        );
        const web = yield* workspaceServer({ port, backend });
        yield* Console.log(
          `Abra web: ${web.url}\nKeep this terminal open. Ctrl+C stops the frontend; the AbraCode service keeps running.`,
        );
        if (open)
          // The browser is user-owned: an opener that waits for its window must
          // never be killed with a check timeout or when the web proxy exits.
          yield* Effect.callback<void, CrewError>((resume) => {
            const child = spawn("xdg-open", [web.url], {
              cwd: home,
              stdio: "ignore",
              detached: true,
            });
            const failed = () =>
              resume(Effect.fail(new CrewError("WEB_OPEN", "Browser opener unavailable")));
            child.once("error", failed);
            child.once("exit", (code) => (code === 0 ? resume(Effect.void) : failed()));
            child.unref();
          }).pipe(
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => Effect.fail(new CrewError("WEB_OPEN", "Browser opener still running")),
            }),
            Effect.catch(() =>
              Console.log("If no browser window appeared, open the Abra web URL above."),
            ),
          );
        return yield* Effect.never;
      }),
    );
  });
  NodeRuntime.runMain(program.pipe(Effect.provide(NodeFileSystem.layer)));
}
