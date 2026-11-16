import { DispatchSourcesSchema, resolveDispatch, workerRoles, type Dispatch } from "./dispatch.ts";
import { Schema } from "effect";
import { WorkerModelSchema, NonEmpty } from "../contracts.ts";
import { ConfigSchema } from "./contracts.ts";
import { type Config, type ManagedExecution, type Role } from "../domain.ts";

export const ConfigurationSnapshotSchema = Schema.Struct({
  digest: NonEmpty,
  supervisor: WorkerModelSchema,
  workers: ConfigSchema.fields.workers,
  dispatch_sources: Schema.optional(DispatchSourcesSchema),
});
export const captureConfiguration = (config: Config, repository?: Dispatch, task?: Dispatch) => {
  const resolved = Object.fromEntries(
    workerRoles.map((role) => [role, resolveDispatch(config, role, repository, task)]),
  ) as Record<Role, ReturnType<typeof resolveDispatch>>;
  return {
    digest: config.config_digest,
    supervisor: structuredClone(config.supervisor_model),
    workers: Object.fromEntries(
      workerRoles.map((role) => [
        role,
        {
          ...structuredClone(config.workers[role]),
          model: structuredClone(resolved[role].model),
        },
      ]),
    ),
    dispatch_sources: Object.fromEntries(
      workerRoles.map((role) => [role, resolved[role].provenance]),
    ) as typeof DispatchSourcesSchema.Type,
  };
};
export const workerProfile = (execution: ManagedExecution, role: Role, config: Config) =>
  execution.configuration_snapshot?.workers[role] ?? config.workers[role];
