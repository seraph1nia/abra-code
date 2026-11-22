import { DispatchSourcesSchema, resolveDispatch, workerRoles, type Dispatch } from "./dispatch.ts";
import { Schema } from "effect";
import { WorkerModelSchema, NonEmpty } from "../contracts.ts";
import { ConfigSchema } from "./contracts.ts";
import { type Config, type ManagedExecution, type Role } from "../domain.ts";
import { CapturedProfile } from "@abracode/agents/contracts";

export const ConfigurationSnapshotSchema = Schema.Struct({
  memory_reads: Schema.optional(Schema.Literal(true)),
  digest: NonEmpty,
  supervisor: WorkerModelSchema,
  workers: ConfigSchema.fields.workers,
  dispatch_sources: Schema.optional(DispatchSourcesSchema),
  agent_selection_version: Schema.optional(Schema.Literal(1)),
  definitions: Schema.optional(Schema.Record(Schema.String, CapturedProfile)),
});
export const captureConfiguration = (config: Config, repository?: Dispatch, task?: Dispatch) => {
  const resolved = Object.fromEntries(
    workerRoles.map((role) => [role, resolveDispatch(config, role, repository, task)]),
  ) as Record<Role, ReturnType<typeof resolveDispatch>>;
  return {
    ...(config.memory?.enabled ? { memory_reads: true as const } : {}),
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
export const workerProfile = (
  execution: ManagedExecution,
  role: Role,
  _config: Pick<Config, "workers">,
) => {
  const selected =
    execution.configuration_snapshot?.workers[role] ??
    (execution.worker_model ? { model: execution.worker_model } : undefined);
  const definition = execution.configuration_snapshot?.definitions?.[role];
  if (execution.configuration_snapshot?.agent_selection_version === 1 && definition)
    return { ...selected, agent: selected?.agent ?? definition.id };
  // Missing snapshots are historical selection, never an implicit package default.
  return selected;
};
