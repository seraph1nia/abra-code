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
import { DecisionSchema } from "./obligation-contracts.ts";
import { AttentionSchema } from "./attention-contracts.ts";
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
const RequestPrompt = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (text) => new TextEncoder().encode(text).length <= 32768 || "Maximum rendered prompt 32 KiB",
  ),
);
/** A single reserved response-only turn; presence permanently consumes the attempt. */
export const ResponseRecoverySchema = Schema.Struct({
  prompt_id: MessageId,
  prompt: RequestPrompt,
  created_at: Timestamp,
  completion_id: MessageId,
  completed_at: Timestamp,
  status: Schema.Literals(["pending", "admission_uncertain", "admitted", "suppressed"]),
});
/** Controller-owned prompt provenance, not a second native inbox. */
const RequestFields = {
  type: Schema.optional(Schema.Literal("request")),
  schema_version: Schema.Literal(1),
  request_id: RequestId,
  prompt_id: MessageId,
  generation: Count,
  sender_session_id: SessionId,
  recipient_session_id: SessionId,
  prompt: RequestPrompt,
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
  response_recovery: Schema.optional(ResponseRecoverySchema),
  /** Lead requests can precede an execution, so their notice receipt stays on the request. */
  response_escalation: Schema.optional(
    Schema.Struct({
      body: MessageBody,
      created_at: Timestamp,
      notice_id: MessageId,
      notified: Schema.optional(Schema.Boolean),
    }),
  ),
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
    if (m.response_recovery && (!m.response || m.response === "none"))
      return "Response recovery requires an explicit response obligation";
    if (m.response_recovery?.prompt_id === m.prompt_id)
      return "Response recovery must retain a distinct native identity";
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
}).check(
  Schema.makeFilter((m) => Schema.is(RequestSchema)(m) || "Invalid request disposition"),
  Schema.makeFilter(
    (m) =>
      m.response_recovery?.prompt_id !== m.assignment_id ||
      "Response recovery cannot reuse the assignment identity",
  ),
);
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
export const requestPromptIDs = (request: typeof RequestSchema.Type) =>
  request.response_recovery
    ? [request.prompt_id, request.response_recovery.prompt_id]
    : [request.prompt_id];
export const requiresResponse = (m: typeof RequestSchema.Type) =>
  !["cancelled", "superseded"].includes(m.status) &&
  ((m.response === "answer" && m.status !== "answered") ||
    (m.response === "acknowledgement" && !["acknowledged", "answered"].includes(m.status)));
export const needsDisposition = (m: MessageIntent) =>
  !["cancelled", "superseded", "answered"].includes(m.status) &&
  (m.status !== "acknowledged" || m.response === "answer");
export const MessageIntentsSchema = Schema.Array(CommunicationSchema).check(
  Schema.isMaxLength(256),
  Schema.makeFilter((messages) => {
    const prompts = messageRequests(messages).flatMap((m) =>
      m.response_recovery ? [m.prompt_id, m.response_recovery.prompt_id] : [m.prompt_id],
    );
    return (
      (new Set(messages.map((m) => m.request_id)).size === messages.length &&
        new Set(prompts).size === prompts.length) ||
      "Duplicate message identity"
    );
  }),
);

/** Shared historical contract; native effects and current authority stay with callers. */
export function requestHistoryError(
  old: typeof RequestSchema.Type,
  current: typeof RequestSchema.Type,
) {
  const {
    status: previous,
    acknowledged_at: acknowledged,
    reply,
    response_recovery: recovery,
    response_escalation: escalation,
    ...identity
  } = old;
  const {
    status,
    acknowledged_at: nextAcknowledged,
    reply: nextReply,
    response_recovery: nextRecovery,
    response_escalation: nextEscalation,
    ...replacement
  } = current;
  if (
    (acknowledged && acknowledged !== nextAcknowledged) ||
    (reply && JSON.stringify(reply) !== JSON.stringify(nextReply))
  )
    return "Reply cannot be rebound";
  if (escalation) {
    if (!nextEscalation) return "Response escalation cannot be removed";
    const { notified, ...intent } = escalation;
    const { notified: nextNotified, ...replacement } = nextEscalation;
    if (JSON.stringify(intent) !== JSON.stringify(replacement) || (notified && !nextNotified))
      return "Response escalation receipt cannot be rebound";
  } else if (nextEscalation && !requiresResponse(old) && recovery?.status !== "admission_uncertain")
    return "Response escalation requires an unresolved obligation";
  if (
    ![...new Set([...Object.keys(identity), ...Object.keys(replacement)])].every(
      (key) =>
        JSON.stringify(Reflect.get(identity, key)) ===
        JSON.stringify(Reflect.get(replacement, key)),
    )
  )
    return "Retained message cannot be rebound";
  if (recovery) {
    if (!nextRecovery) return "Response recovery reservation cannot be removed";
    const { status: before, ...intent } = recovery;
    const { status: after, ...nextIntent } = nextRecovery;
    if (JSON.stringify(intent) !== JSON.stringify(nextIntent))
      return "Response recovery intent cannot be rebound";
    const order = ["pending", "admission_uncertain", "admitted"];
    const refusedResolved =
      before === "admission_uncertain" &&
      after === "suppressed" &&
      ["answered", "acknowledged"].includes(old.status) &&
      !requiresResponse(old);
    if (
      before !== after &&
      (before === "suppressed" ||
        (after === "suppressed"
          ? before !== "pending" && !refusedResolved
          : order.indexOf(after) < order.indexOf(before)))
    )
      return "Response recovery disposition cannot be reversed";
  } else if (
    nextRecovery &&
    (!requiresResponse(old) ||
      !["admitted", "acknowledged"].includes(previous) ||
      nextRecovery.status !== "pending")
  )
    return "Response recovery requires an admitted unresolved request";
  const order = ["pending", "admission_uncertain", "admitted", "acknowledged", "answered"];
  if (
    status !== previous &&
    (["cancelled", "superseded"].includes(previous) ||
      (order.includes(status) && order.indexOf(status) < order.indexOf(previous)))
  )
    return "Message disposition cannot be reversed";
}

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
    const error = requestHistoryError(old, current);
    if (error) return error;
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
      recovery_native: Schema.optional(
        Schema.Literals(["queued", "consumed", "absent", "unavailable"]),
      ),
      native_state: Schema.optional(
        Schema.Literals(["running", "queued", "idle", "unknown", "unavailable"]),
      ),
      native_outcome: Schema.optional(Schema.Literals(["succeeded", "failed", "interrupted"])),
      decision: Schema.optional(DecisionSchema),
      escalation: Schema.optional(
        Schema.Struct({
          id: AttentionSchema.fields.id,
          status: AttentionSchema.fields.status,
          evidence: AttentionSchema.fields.evidence,
          disposition: AttentionSchema.fields.disposition,
        }),
      ),
    }),
  ).check(Schema.isMaxLength(50)),
  total: Count,
  outstanding: Count,
  offset: Count,
  limit: Count,
  next_offset: Schema.optional(Count),
  observed_at: Timestamp,
});
