import { Effect, Schema } from "effect";
import { Count, WorkerModelSchema } from "../contracts.ts";
import {
  MessageId,
  IssueId,
  LeadId,
  ObligationKey,
  RepositoryId,
  RequestId,
  SessionId,
  StorageKey,
  StoragePrefix,
} from "../identities.ts";
import { type Records } from "../storage/store.ts";
import { decode } from "../decode.ts";
import { BatchInputSchema, BatchResultSchema } from "../work/batch.ts";
import { MessageBody, RequestSchema } from "./message-contracts.ts";

const repositories = Schema.Array(RepositoryId).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(16),
  Schema.makeFilter((ids) => new Set(ids).size === ids.length || "Duplicate repository scope"),
);
export const LeadRequestSchema = Schema.Struct({
  issue_id: IssueId,
  request: RequestSchema,
  notice_id: Schema.optional(MessageId),
  notified: Schema.optional(Schema.Boolean),
});
export const LeadRecordSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  id: LeadId,
  revision: Count,
  repositories,
  parent_session_id: SessionId,
  session_id: SessionId,
  retired_sessions: Schema.Array(SessionId).check(Schema.isMaxLength(32)),
  model: WorkerModelSchema,
  enabled: Schema.Boolean,
  provisioned: Schema.Boolean,
  active: Schema.Boolean,
  stop_pending: Schema.Boolean,
  requests: Schema.Array(LeadRequestSchema).check(Schema.isMaxLength(128)),
  proposals: Schema.Array(
    Schema.Struct({
      request_id: RequestId,
      revision: Count,
      batch: BatchInputSchema,
      accepted: Schema.optional(BatchResultSchema),
      notice_id: MessageId,
      notified: Schema.optional(Schema.Boolean),
    }),
  ).check(Schema.isMaxLength(32)),
}).check(
  Schema.makeFilter(
    (r) =>
      (new Set([r.session_id, ...r.retired_sessions]).size === r.retired_sessions.length + 1 &&
        new Set(r.requests.map((m) => m.request.request_id)).size === r.requests.length &&
        new Set(r.requests.map((m) => m.request.prompt_id)).size === r.requests.length &&
        r.revision >= 1 &&
        ![r.session_id, ...r.retired_sessions].includes(r.parent_session_id) &&
        r.requests.every(
          (m) =>
            m.request.generation <= r.revision &&
            m.request.sender_session_id === r.parent_session_id &&
            [r.session_id, ...r.retired_sessions].includes(m.request.recipient_session_id) &&
            (m.request.generation !== r.revision ||
              m.request.recipient_session_id === r.session_id),
        )) ||
      "Conflicting lead identity",
  ),
);
export type LeadRecord = typeof LeadRecordSchema.Type;
export const LeadControlSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("register"),
    id: LeadId,
    expected_revision: Count,
    repositories,
    model: WorkerModelSchema,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("status"), id: Schema.optional(LeadId) }),
  Schema.Struct({
    action: Schema.Literal("message"),
    id: LeadId,
    revision: Count,
    issue_id: IssueId,
    request_id: RequestId,
    body: MessageBody,
  }),
  Schema.Struct({
    action: Schema.Literal("accept"),
    id: LeadId,
    revision: Count,
    request_id: RequestId,
  }),
]);
export type LeadControl = typeof LeadControlSchema.Type;
export const LeadActionSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("status"),
    revision: Count,
    issue_id: Schema.optional(IssueId),
  }),
  Schema.Struct({
    action: Schema.Literal("reply"),
    revision: Count,
    request_id: RequestId,
    body: MessageBody,
  }),
  Schema.Struct({ action: Schema.Literal("propose"), revision: Count, batch: BatchInputSchema }),
  Schema.Struct({
    action: Schema.Literal("answer"),
    revision: Count,
    issue_id: IssueId,
    generation: Count,
    key: ObligationKey,
    body: MessageBody,
  }),
  Schema.Struct({
    action: Schema.Literal("forward"),
    revision: Count,
    issue_id: IssueId,
    source_issue_id: IssueId,
    finding_id: RequestId,
    request_id: RequestId,
  }),
]);
export type LeadAction = typeof LeadActionSchema.Type;
export const leadKey = (id: LeadId) => StorageKey.make(`lead/${id}`);
/** Malformed registrations fail closed: never turn a known restricted session into Abra. */
export const readLeads = (records: Records) =>
  Effect.gen(function* () {
    const result: LeadRecord[] = [];
    for (const row of yield* records.store.entries(StoragePrefix.make("lead/"))) {
      const record = yield* decode(LeadRecordSchema, row.value, row.key);
      if (row.key !== leadKey(record.id))
        return yield* decode(Schema.Never, row.value, "Conflicting lead key");
      result.push(record);
    }
    const ids = result.flatMap((r) => [r.session_id, ...r.retired_sessions]);
    if (new Set(ids).size !== ids.length)
      return yield* decode(Schema.Never, ids, "Conflicting lead session ownership");
    return result;
  });
export const leadAccounting = (records: Records) =>
  readLeads(records).pipe(
    Effect.map((leads) => ({
      active: leads.filter((l) => l.active || l.stop_pending).length,
      turns: (issue: IssueId) =>
        leads.reduce((n, l) => n + l.requests.filter((r) => r.issue_id === issue).length, 0),
    })),
  );
