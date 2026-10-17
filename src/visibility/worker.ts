import { Schema } from "effect";
import { SessionId } from "../identities.ts";
import { RoleSchema, WorkerModelSchema } from "../contracts.ts";
import { SessionObservationSchema } from "../opencode/tool-contracts.ts";
export const WorkerInspectionSchema = Schema.Struct({
  id: SessionId,
  role: RoleSchema,
  model: Schema.optional(WorkerModelSchema),
  configured_model: Schema.optional(WorkerModelSchema),
  outcome: SessionObservationSchema.fields.outcome,
  busy: Schema.Boolean,
  recent_messages: SessionObservationSchema.fields.recent_messages,
  note: Schema.String,
});
export type WorkerInspection = typeof WorkerInspectionSchema.Type;
