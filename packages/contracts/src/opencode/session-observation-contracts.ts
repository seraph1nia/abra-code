import { Schema } from "effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import * as Id from "../identities.ts";
import { WorkerModelSchema, WorkerErrorSchema } from "../primitives.ts";
const message = Schema.Struct({
  id: Id.MessageId,
  type: Schema.Union([
    SessionMessage.AgentSelected.fields.type,
    SessionMessage.ModelSelected.fields.type,
    SessionMessage.LocationSwitched.fields.type,
    SessionMessage.User.fields.type,
    SessionMessage.Synthetic.fields.type,
    SessionMessage.System.fields.type,
    SessionMessage.Skill.fields.type,
    SessionMessage.Shell.fields.type,
    SessionMessage.Assistant.fields.type,
    SessionMessage.CompactionRunning.fields.type,
    SessionMessage.Idle.fields.type,
  ]),
  at: Schema.Finite,
  text: Schema.optional(Schema.String),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Id.ToolName,
        status: Schema.Union([
          SessionMessage.ToolStateStreaming.fields.status,
          SessionMessage.ToolStateRunning.fields.status,
          SessionMessage.ToolStateCompleted.fields.status,
          SessionMessage.ToolStateError.fields.status,
        ]),
        error: Schema.optional(WorkerErrorSchema),
      }),
    ),
  ),
});
export const SessionObservationSchema = Schema.Struct({
  agent: Schema.optional(Id.AgentId),
  id: Id.SessionId,
  directory: Schema.optional(Id.AbsolutePath),
  outcome: Session.Info.fields.outcome,
  busy: Schema.optional(Schema.Boolean),
  executing: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model: Schema.optional(WorkerModelSchema),
  error: Schema.optional(WorkerErrorSchema),
  error_at: Schema.optional(Schema.Finite),
  diagnostic_error: Schema.optional(Schema.String),
  recent_messages: Schema.optional(Schema.Array(message)),
  activity: Schema.optional(
    Schema.Struct({ identity: Id.ActivityId, at: Schema.Finite, summary: Schema.String }),
  ),
  available_tools: Schema.optional(
    Schema.Struct({ model: WorkerModelSchema, names: Schema.Array(Id.ToolName), at: Id.Timestamp }),
  ),
});
