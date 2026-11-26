import { ConfigurationError } from "../errors.ts";
import { Effect } from "effect";
import { dirname, join, relative, resolve } from "node:path";
import { type Config, CrewError } from "../domain.ts";
import { mkdir, pathExists, realpath } from "../filesystem.ts";
import { runtimePaths, identity } from "./identity.ts";
import { FileSystem } from "effect";
import { provideFileSystem } from "../platform.ts";

export const hostConfiguration = (config: Config) => ({
  $schema: "https://opencode.ai/config.json",
  plugins: [join(config.home, ".opencode/plugins/abracode")],
  default_agent: identity.agent,
});

/** Resolve existing ancestors too: a not-yet-created file can live under a legacy symlink. */
export const assertFreshPaths = (config: Config) =>
  Effect.gen(function* () {
    const legacy = join(config.home, ".opencrew");
    const roots = [legacy];
    if (yield* pathExists(legacy)) roots.push(yield* realpath(legacy));
    for (const selected of [
      config.work_database,
      config.repository_root,
      config.worktree_root,
      ...Object.values(runtimePaths(config.home)),
    ]) {
      let ancestor = selected;
      while (!(yield* pathExists(ancestor)) && dirname(ancestor) !== ancestor)
        ancestor = dirname(ancestor);
      const canonical = resolve(yield* realpath(ancestor), relative(ancestor, selected));
      for (const root of roots)
        if ([selected, canonical].some((path) => path === root || path.startsWith(root + "/")))
          return yield* new ConfigurationError(
            "LEGACY_STATE",
            "AbraCode starts fresh. Choose .abracode paths; stop the legacy service separately. Legacy data was not changed.",
          );
    }
  });

export const generateHostConfiguration = (config: Config) =>
  Effect.gen(function* () {
    yield* assertFreshPaths(config);
    const path = runtimePaths(config.home).hostConfig;
    yield* mkdir(dirname(path), { recursive: true, mode: 0o700 });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const temporary = yield* fs.makeTempFileScoped({
          directory: dirname(path),
          prefix: ".opencode-",
          suffix: ".tmp",
        });
        yield* fs.writeFileString(
          temporary,
          JSON.stringify(hostConfiguration(config), null, 2) + "\n",
        );
        yield* fs.rename(temporary, path);
      }),
    ).pipe(provideFileSystem, Effect.mapError(CrewError.from));
    return path;
  });
