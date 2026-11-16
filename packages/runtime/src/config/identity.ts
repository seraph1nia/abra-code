import { resolve, join } from "node:path";

export const identity = {
  name: "AbraCode",
  plugin: "abracode",
  agent: "abra",
  config: "abracode.yaml",
  state: ".abracode",
} as const;
export const modelRoles = ["supervisor", "explore", "apply", "review", "research"] as const;
export type ModelRole = (typeof modelRoles)[number];
export const installationHome = () => resolve(process.env.ABRACODE_HOME ?? process.cwd());
export const configurationPath = (home: string) =>
  resolve(home, process.env.ABRACODE_CONFIG ?? identity.config);
export const runtimePaths = (home: string) => ({
  state: join(home, identity.state),
  hostConfig: join(home, identity.state, "config/opencode/opencode.json"),
  service: join(home, identity.state, "state/opencode/service.json"),
});
