import { SelectionSourceSchema } from "../config/dispatch.ts";
import { SupervisionSummarySchema } from "./supervision.ts";
import { Schema } from "effect";
import { SessionId, Timestamp } from "../identities.ts";
import { RoleSchema, WorkerModelSchema } from "../contracts.ts";
import { SessionObservationSchema } from "../opencode/tool-contracts.ts";
export const WorkerInspectionSchema = Schema.Struct({
  id: SessionId,
  role: RoleSchema,
  model: Schema.optional(WorkerModelSchema),
  configured_model: Schema.optional(WorkerModelSchema),
  model_source: Schema.optional(SelectionSourceSchema),
  outcome: SessionObservationSchema.fields.outcome,
  busy: Schema.Boolean,
  executing: SessionObservationSchema.fields.executing,
  native_activity: SupervisionSummarySchema.fields.native_activity,
  observed_at: Timestamp,
  recent_messages: SessionObservationSchema.fields.recent_messages,
  note: Schema.String,
});
export type WorkerInspection = typeof WorkerInspectionSchema.Type;
