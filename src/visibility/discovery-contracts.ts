import { Schema } from "effect";
import { Count } from "../contracts.ts";
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
export const WorkPageSchema = Schema.Struct({
  entries: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(50)),
  total: Count,
  offset: Count,
  limit: Count,
  next_offset: Schema.optional(Count),
  fleet: Schema.optional(FleetSchema),
  observed_at: Timestamp,
});
