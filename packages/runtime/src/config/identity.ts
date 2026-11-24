import { join, resolve } from "node:path";
import { Config, Effect, Option } from "effect";

export const identity = {
  name: "AbraCode",
  plugin: "abracode",
  agent: "abra",
  config: "abracode.yaml",
  state: ".abracode",
} as const;
export const modelRoles = ["supervisor", "explore", "apply", "review", "research"] as const;
export type ModelRole = (typeof modelRoles)[number];

export const homeConfig = Config.option(Config.String("ABRACODE_HOME"));
export const configFileConfig = Config.option(Config.String("ABRACODE_CONFIG"));

export const resolveInstallationHome: Effect.Effect<string> = homeConfig.pipe(
  Effect.map((value) => resolve(Option.getOrElse(value, () => process.cwd()))),
  Effect.orDie,
);

export const resolveConfigurationPath = (home: string): Effect.Effect<string> =>
  configFileConfig.pipe(
    Effect.map((value) =>
      resolve(
        home,
        Option.getOrElse(value, () => identity.config),
      ),
    ),
    Effect.orDie,
  );

export const installationHome = () => resolve(process.env.ABRACODE_HOME ?? process.cwd());
export const configurationPath = (home: string) =>
  resolve(home, process.env.ABRACODE_CONFIG ?? identity.config);
export const runtimePaths = (home: string) => ({
  state: join(home, identity.state),
  hostConfig: join(home, identity.state, "config/opencode/opencode.json"),
  service: join(home, identity.state, "state/opencode/service.json"),
});
