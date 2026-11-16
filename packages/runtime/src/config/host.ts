import { Effect } from "effect";
import { dirname, join, relative, resolve } from "node:path";
import { type Config, CrewError } from "../domain.ts";
import { mkdir, writeFile, rename, pathExists, realpath } from "../filesystem.ts";
import { runtimePaths, identity } from "./identity.ts";
import { randomUUID } from "node:crypto";

export const hostConfiguration = (config: Config) => ({
  $schema: "https://opencode.ai/config.json",
  plugins: [join(config.home, ".opencode/plugins/abracode")],
  default_agent: identity.agent,
  agent: {
    "project-lead": {
      description: "Scoped AbraCode project lead",
      mode: "subagent",
      hidden: true,
      prompt:
        "You are a controller-managed project lead. Use only abra_lead_action at the retained registration revision. Propose scoped tasks and report evidence. Never approve, start workers, modify code or deliver work.",
    },
    [identity.agent]: {
      description: "Abra, your AbraCode supervisor",
      mode: "primary",
      model: `${config.supervisor_model.providerID}/${config.supervisor_model.id}`,
      ...(config.supervisor_model.variant ? { variant: config.supervisor_model.variant } : {}),
      prompt: `{file:${join(config.home, ".opencode/agents/abra.md")}}`,
    },
  },
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
          return yield* new CrewError(
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
    const temporary = `${path}.${randomUUID()}.tmp`;
    yield* writeFile(temporary, JSON.stringify(hostConfiguration(config), null, 2) + "\n", {
      mode: 0o600,
    });
    yield* rename(temporary, path);
    return path;
  });
