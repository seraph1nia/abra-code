import { Schema } from "effect";
import { WorkerModelSchema, NonEmpty } from "../contracts.ts";
import { ConfigSchema } from "./contracts.ts";
import { type Config, type ManagedExecution, type Role } from "../domain.ts";

export const ConfigurationSnapshotSchema = Schema.Struct({
  digest: NonEmpty,
  supervisor: WorkerModelSchema,
  workers: ConfigSchema.fields.workers,
});
export const captureConfiguration = (config: Config) => ({
  digest: config.config_digest,
  supervisor: structuredClone(config.supervisor_model),
  workers: Object.fromEntries(
    (["explore", "apply", "review", "research"] as const).map((role) => [
      role,
      {
        ...structuredClone(config.workers[role]),
        model: structuredClone(
          config.workers[role]?.model ?? config.models.overrides?.[role] ?? config.models.default,
        ),
      },
    ]),
  ),
});
export const workerProfile = (execution: ManagedExecution, role: Role, config: Config) =>
  execution.configuration_snapshot?.workers[role] ?? config.workers[role];
