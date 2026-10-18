import { Schema } from "effect";
import { Count, RoleSchema } from "../contracts.ts";
import {
  IssueId,
  MessageId,
  ObligationKey,
  RequestId,
  SessionId,
  Timestamp,
} from "../identities.ts";
import { EvidenceReferenceSchema } from "./report-contracts.ts";
const MessageEvidence = Schema.Array(
  EvidenceReferenceSchema.check(
    Schema.makeFilter(
      (ref) =>
        new TextEncoder().encode(JSON.stringify(ref)).length <= 2048 ||
        "Evidence reference exceeds 2 KiB",
    ),
  ),
).check(Schema.isMaxLength(16));

export const MessageBody = Schema.NonEmptyString.check(
  Schema.makeFilter((body) => new TextEncoder().encode(body).length <= 8192 || "Maximum 8 KiB"),
);
/** Controller-owned prompt provenance, not a second native inbox. */
const RequestFields = {
  type: Schema.optional(Schema.Literal("request")),
  schema_version: Schema.Literal(1),
  request_id: RequestId,
  prompt_id: MessageId,
  generation: Count,
  sender_session_id: SessionId,
  recipient_session_id: SessionId,
  prompt: Schema.NonEmptyString.check(
    Schema.makeFilter(
      (text) => new TextEncoder().encode(text).length <= 32768 || "Maximum rendered prompt 32 KiB",
    ),
  ),
  body: Schema.optional(MessageBody),
  kind: Schema.optional(Schema.Literals(["instruction", "question", "finding", "handoff"])),
  response: Schema.optional(Schema.Literals(["none", "acknowledgement", "answer"])),
  source: Schema.optional(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("finding"), issue_id: IssueId, request_id: RequestId }),
      Schema.Struct({ type: Schema.Literal("decision"), key: ObligationKey }),
    ]),
  ),
  delivery: Schema.Literals(["queue", "steer"]),
  status: Schema.Literals([
    "pending",
    "admission_uncertain",
    "admitted",
    "acknowledged",
    "answered",
    "cancelled",
    "superseded",
  ]),
  created_at: Timestamp,
  acknowledged_at: Schema.optional(Timestamp),
  reply: Schema.optional(
    Schema.Struct({
      body: MessageBody,
      evidence: MessageEvidence,
      at: Timestamp,
    }),
  ),
};
export const RequestSchema = Schema.Struct(RequestFields).check(
  Schema.makeFilter((m) => {
    if (m.status === "answered" && (!m.reply || m.acknowledged_at === undefined))
      return "Answered requests require retained reply evidence";
    if (m.status === "acknowledged" && m.acknowledged_at === undefined)
      return "Acknowledged requests require a retained acknowledgement";
    if (m.reply && !["answered", "cancelled", "superseded"].includes(m.status))
      return "Reply evidence cannot precede its response state";
    if (
      m.acknowledged_at !== undefined &&
      ["pending", "admission_uncertain", "admitted"].includes(m.status)
    )
      return "Acknowledgement evidence cannot precede its response state";
    return true;
  }),
);
export const MessageIntentSchema = Schema.Struct({
  ...RequestSchema.fields,
  assignment_id: MessageId,
  role: RoleSchema,
}).check(Schema.makeFilter((m) => Schema.is(RequestSchema)(m) || "Invalid request disposition"));
export type MessageIntent = typeof MessageIntentSchema.Type;
const nomination = Schema.Struct({ issue_id: IssueId, role: RoleSchema });
export const FindingSchema = Schema.Struct({
  type: Schema.Literal("finding"),
  schema_version: Schema.Literal(1),
  request_id: RequestId,
  generation: Count,
  sender_session_id: SessionId,
  role: RoleSchema,
  body: MessageBody,
  evidence: MessageEvidence,
  destination: Schema.optional(nomination),
  created_at: Timestamp,
});
export const CommunicationSchema = Schema.Union([MessageIntentSchema, FindingSchema]);
export type Communication = typeof CommunicationSchema.Type;
export const validMessageGenerations = (e: {
  control_generation: number;
  messages?: readonly Communication[];
}) =>
  e.messages?.some((message) => message.generation > e.control_generation)
    ? "Message generations cannot be in the future"
    : true;
export const messageRequests = (messages: readonly Communication[] = []) =>
  messages.filter((m): m is MessageIntent => m.type !== "finding");
export const requiresResponse = (m: MessageIntent) =>
  !["cancelled", "superseded"].includes(m.status) &&
  ((m.response === "answer" && m.status !== "answered") ||
    (m.response === "acknowledgement" && !["acknowledged", "answered"].includes(m.status)));
export const needsDisposition = (m: MessageIntent) =>
  !["cancelled", "superseded", "answered"].includes(m.status) &&
  (m.status !== "acknowledged" || m.response === "answer");
export const MessageIntentsSchema = Schema.Array(CommunicationSchema).check(
  Schema.isMaxLength(256),
  Schema.makeFilter(
    (messages) =>
      (new Set(messages.map((m) => m.request_id)).size === messages.length &&
        new Set(messageRequests(messages).map((m) => m.prompt_id)).size ===
          messageRequests(messages).length) ||
      "Duplicate message identity",
  ),
);

export function messageHistoryError(
  prior: readonly Communication[],
  next: readonly Communication[],
) {
  const indexed = new Map(next.map((message) => [message.request_id, message]));
  for (const old of prior) {
    const current = indexed.get(old.request_id);
    if (!current) return "Retained message cannot be removed";
    if (old.type === "finding" || current.type === "finding") {
      if (JSON.stringify(old) !== JSON.stringify(current)) return "Finding cannot be rebound";
      continue;
    }
    const { status: previous, acknowledged_at: acknowledged, reply, ...identity } = old;
    const { status, acknowledged_at: nextAcknowledged, reply: nextReply, ...replacement } = current;
    if (
      (acknowledged && acknowledged !== nextAcknowledged) ||
      (reply && JSON.stringify(reply) !== JSON.stringify(nextReply))
    )
      return "Reply cannot be rebound";
    if (
      ![...new Set([...Object.keys(identity), ...Object.keys(replacement)])].every(
        (key) =>
          JSON.stringify(Reflect.get(identity, key)) ===
          JSON.stringify(Reflect.get(replacement, key)),
      )
    )
      return "Retained message cannot be rebound";
    const order = ["pending", "admission_uncertain", "admitted", "acknowledged", "answered"];
    if (
      status !== previous &&
      (["cancelled", "superseded"].includes(previous) ||
        (order.includes(status) && order.indexOf(status) < order.indexOf(previous)))
    )
      return "Message disposition cannot be reversed";
  }
}

export const MessageSendSchema = Schema.Struct({
  issue_id: IssueId,
  request_id: RequestId,
  role: RoleSchema,
  session_id: Schema.optional(SessionId),
  body: MessageBody,
  kind: MessageIntentSchema.fields.kind,
  delivery: Schema.optional(MessageIntentSchema.fields.delivery),
  response: MessageIntentSchema.fields.response,
  source: MessageIntentSchema.fields.source,
});
export const MessageInputSchema = MessageSendSchema;
export const WorkerReplySchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("acknowledge"),
    request_id: RequestId,
    generation: Count,
  }),
  Schema.Struct({
    action: Schema.Literal("answer"),
    request_id: RequestId,
    generation: Count,
    body: MessageBody,
    evidence: Schema.optional(MessageEvidence),
  }),
  Schema.Struct({
    action: Schema.Literal("finding"),
    request_id: RequestId,
    generation: Count,
    body: MessageBody,
    evidence: Schema.optional(MessageEvidence),
    destination: Schema.optional(nomination),
  }),
]);
export const MessagesPageSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      record: CommunicationSchema,
      native: Schema.optional(Schema.Literals(["queued", "consumed", "absent", "unavailable"])),
    }),
  ).check(Schema.isMaxLength(50)),
  total: Count,
  outstanding: Count,
  offset: Count,
  limit: Count,
  next_offset: Schema.optional(Count),
  observed_at: Timestamp,
});
