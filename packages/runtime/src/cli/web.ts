/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 FileSystem and ChildProcess APIs. */
import { Service } from "@opencode/client/effect/service";
import { Console, Effect, FileSystem } from "effect";
import { ChildProcess } from "effect/process";
import { runtimePaths } from "../config/identity.ts";
import { CrewError } from "../domain.ts";
import { bootstrapService } from "../opencode/bootstrap.ts";
import { NativeWebBackend } from "../web/backend.ts";
import { workspaceServer } from "../web/server.ts";

export interface WebOptions {
  readonly port: number;
  readonly open: boolean;
}

const browserOpener = (): string | undefined =>
  process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;

export const runWeb = (options: WebOptions) =>
  Effect.gen(function* () {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
      return yield* new CrewError("WEB_ARGUMENTS", "Port must be between 1 and 65535.");
    const fs = yield* FileSystem.FileSystem;
    const { home, supervisor } = yield* bootstrapService;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const backend = new NativeWebBackend(
          home,
          supervisor.id,
          Service.discover({ file: runtimePaths(home).service, version: "2.3.0" }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          ),
        );
        const web = yield* workspaceServer({ port: options.port, backend });
        yield* Console.log(
          `Abra web: ${web.url}\nKeep this terminal open. Ctrl+C stops the frontend; the AbraCode service keeps running.`,
        );
        if (options.open) {
          const opener = browserOpener();
          if (opener) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const child = yield* ChildProcess.make(opener, [web.url], {
                  cwd: home,
                  detached: false,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                });
                const code = yield* child.exitCode;
                if (Number(code) !== 0)
                  return yield* new CrewError("WEB_OPEN", "Browser opener unavailable");
              }),
            ).pipe(
              Effect.timeoutOrElse({
                duration: "5 seconds",
                orElse: () =>
                  Effect.fail(new CrewError("WEB_OPEN", "Browser opener still running")),
              }),
              Effect.catch(() =>
                Console.log("If no browser window appeared, open the Abra web URL above."),
              ),
            );
          } else {
            yield* Console.log("If no browser window appeared, open the Abra web URL above.");
          }
        }
        return yield* Effect.never;
      }),
    );
  });
