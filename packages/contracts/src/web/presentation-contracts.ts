import { Schema } from "effect";
import { Count } from "../primitives.ts";
import { IssueId } from "../identities.ts";
import { SessionMessage } from "@opencode/schema/session-message";
import { WorkSummarySchema } from "../visibility/work-summary.ts";
import { DecisionObservationSchema } from "../workflow/obligation-summary.ts";
import {
  MessageIntentSchema,
  MessageReplySchema,
  MessagesPageSchema,
  ResponseRecoverySchema,
  FindingSchema as CommunicationFindingSchema,
} from "../workflow/message-contracts.ts";
import { DeliveryOutcomeSchema } from "../workflow/delivery-contracts.ts";
import { FindingSchema } from "../workflow/feedback-contracts.ts";
import { WorkerInspectionSchema } from "../visibility/worker.ts";
import { ArtifactSummarySchema } from "./wire.ts";

const work = WorkSummarySchema.fields;
const outcome = DeliveryOutcomeSchema.fields;
export const DeliveryCardSchema = Schema.Struct({
  execution_id: outcome.execution_id,
  generation: outcome.generation,
  observed_at: outcome.observed_at,
  approval: outcome.approval,
  delivery: outcome.delivery,
  cleanup: Schema.Struct({ state: outcome.cleanup.fields.state }),
  closure: outcome.closure,
  next_action: outcome.next_action,
});
export const TaskCardSchema = Schema.Struct({
  issue_id: work.issue_id,
  title: Schema.optional(work.title),
  issue_status: Schema.optional(work.issue_status),
  phase: work.phase,
  policy: work.policy,
  generation: work.generation,
  progress: work.progress,
  supervision: work.supervision,
  outcome: Schema.optional(DeliveryCardSchema),
});
const request = MessageIntentSchema.fields;
export const CommunicationCardSchema = Schema.Struct({
  request_id: request.request_id,
  generation: request.generation,
  role: request.role,
  body: request.body,
  status: Schema.optional(request.status),
  response: request.response,
  source: request.source,
  created_at: request.created_at,
  reply: Schema.optional(
    Schema.Struct({ body: MessageReplySchema.fields.body, at: MessageReplySchema.fields.at }),
  ),
  recovery: Schema.optional(ResponseRecoverySchema.fields.status),
  native_state: MessagesPageSchema.fields.entries.value.fields.native_state,
  finding: Schema.optional(CommunicationFindingSchema.fields.type),
});
/** Compact display excerpt; full request/reply evidence stays in the owned paginated read. */
export function communicationSummary({
  record,
  native_state,
}: (typeof MessagesPageSchema.Type.entries)[number]): typeof CommunicationCardSchema.Type {
  return {
    request_id: record.request_id,
    generation: record.generation,
    role: record.role,
    body: record.body?.slice(0, 1500),
    created_at: record.created_at,
    native_state,
    ...(record.type === "finding"
      ? { finding: "finding" as const }
      : {
          status: record.status,
          response: record.response,
          source: record.source,
          recovery: record.response_recovery?.status,
          reply: record.reply
            ? { at: record.reply.at, body: record.reply.body.slice(0, 1500) }
            : undefined,
        }),
  };
}
const finding = FindingSchema.fields;
const worker = WorkerInspectionSchema.fields;
export const SessionCardSchema = Schema.Struct({
  id: worker.id,
  role: worker.role,
  model: worker.model,
  configured_model: worker.configured_model,
  model_source: worker.model_source,
  native_activity: worker.native_activity,
  outcome: worker.outcome,
  observed_at: Schema.optional(worker.observed_at),
  note: worker.note,
});
export const FindingCardSchema = Schema.Struct({
  id: finding.id,
  revision: Schema.optionalKey(finding.revision),
  head: finding.head,
  kind: finding.kind,
  text: finding.text,
  blocking: finding.blocking,
  disposition: finding.disposition,
  evidence_unavailable: finding.evidence_unavailable,
});
export const SurfacePublicationSchema = Schema.Struct({
  surface_id: Schema.String,
  revision: Count.check(Schema.isGreaterThan(0)),
  version: Schema.Literal("1.0"),
});
export const ToolPresentationSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tasks"),
    tasks: Schema.Array(TaskCardSchema).check(Schema.isMaxLength(20)),
    total: Count,
    limited: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("decision"),
    issue_id: Schema.optional(IssueId),
    decision: DecisionObservationSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("communication"),
    issue_id: IssueId,
    entries: Schema.Array(CommunicationCardSchema).check(Schema.isMaxLength(20)),
    total: Count,
    outstanding: Count,
    limited: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("sessions"),
    issue_id: IssueId,
    sessions: Schema.Array(SessionCardSchema).check(Schema.isMaxLength(20)),
    total: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("findings"),
    issue_id: IssueId,
    findings: Schema.Array(FindingCardSchema).check(Schema.isMaxLength(20)),
    total: Count,
    limited: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("artifacts"),
    issue_id: IssueId,
    artifacts: Schema.Array(ArtifactSummarySchema).check(Schema.isMaxLength(20)),
    total: Count,
  }),
  Schema.Struct({ kind: Schema.Literal("surface"), ...SurfacePublicationSchema.fields }),
]);
export type ToolPresentation = typeof ToolPresentationSchema.Type;
export const NativeToolStateSchema = Schema.Union([
  SessionMessage.ToolStateStreaming.fields.status,
  SessionMessage.ToolStateRunning.fields.status,
  SessionMessage.ToolStateCompleted.fields.status,
  SessionMessage.ToolStateError.fields.status,
]);
export const TranscriptToolSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: NativeToolStateSchema,
  input: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  result: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
  limited: Schema.optional(Schema.Boolean),
  presentation: Schema.optional(ToolPresentationSchema),
});
export type TranscriptTool = typeof TranscriptToolSchema.Type;
export const TranscriptPartSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool"), tool_id: Schema.String }),
]);
