import { Schema } from "effect";
import { Count } from "../primitives.ts";
import { RepositoryId, Timestamp } from "../identities.ts";
import { WorkSummarySchema } from "./work-summary.ts";
import { FleetSchema } from "./fleet.ts";

export const WorkDiscoveryQuery = Schema.Struct({
  repository_id: Schema.optional(RepositoryId),
  state: Schema.optional(Schema.Literals(["active", "closed", "all"])),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  offset: Schema.optional(Count),
  limit: Schema.optional(Count.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(50))),
});
export type WorkDiscovery = typeof WorkDiscoveryQuery.Type;
export const CapacityUsageSchema = Schema.Struct({
  workers: Count,
  worker_limit: Count,
  retained: Count,
  retained_limit: Count,
});
export const WorkPageSchema = Schema.Struct({
  capacity: Schema.optionalKey(CapacityUsageSchema),
  project_capacity: Schema.optionalKey(CapacityUsageSchema),
  entries: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(50)),
  total: Count,
  offset: Count,
  limit: Count,
  next_offset: Schema.optional(Count),
  fleet: Schema.optional(FleetSchema),
  fleet_observation: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(["current", "stale", "unavailable"]),
      work_revision: Schema.optional(Schema.String),
      observed_at: Schema.optional(Timestamp),
    }),
  ),
  work_revision: Schema.optional(Schema.String),
  observed_at: Timestamp,
});
