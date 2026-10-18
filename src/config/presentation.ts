import { type Config } from "../domain.ts";
import { modelRoles } from "./identity.ts";

/** Only a selected safe view is displayed; argv, environment and endpoint secrets stay private. */
export const presentConfig = (config: Config) => ({
  version: config.version,
  config_path: config.config_path,
  config_digest: config.config_digest,
  home: config.home,
  paths: {
    database: config.work_database,
    worktrees: config.worktree_root,
    repositories: config.repository_root,
  },
  default_workflow: config.default_workflow,
  auto_schedule: config.auto_schedule,
  supervision: {
    mode: config.supervision_mode ?? "legacy",
    optional_diagnostics: config.supervision_mode !== "manual",
    optional_repairs: config.supervision_mode !== "manual",
    notifications:
      config.supervision_mode === "unattended" ? "retained-human-decisions" : "attended",
    budgets: "Existing per-execution diagnostic/repair budgets; mode grants none",
  },
  capacity: { workers: config.max_workers, executions: config.max_executions },
  models: Object.fromEntries(
    modelRoles.map((role) => [
      role,
      {
        name: role === "supervisor" ? "Abra" : role,
        selection: config.models.overrides?.[role] ?? config.models.default,
        source: config.models.overrides?.[role] ? `models.overrides.${role}` : "models.default",
      },
    ]),
  ),
  profiles: Object.entries(config.profiles ?? {}).map(([id, profile]) => ({ id, ...profile })),
  repositories: config.repositories.map((repo) => ({
    id: repo.id,
    remote: repo.remote,
    path: repo.path,
    dispatch: repo.dispatch,
    target_branch: repo.target_branch ?? "remote default",
    verification_commands: repo.verification?.length ?? 0,
    status: "declared; live registration not inspected",
  })),
  live_readiness:
    "unverified; static validation does not authenticate providers or inspect repositories",
});
