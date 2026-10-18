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
import { CrewError } from "../domain.ts";

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
        new Set(
          r.requests.flatMap((m) =>
            m.request.response_recovery
              ? [m.request.prompt_id, m.request.response_recovery.prompt_id]
              : [m.request.prompt_id],
          ),
        ).size === r.requests.reduce((n, m) => n + (m.request.response_recovery ? 2 : 1), 0) &&
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
export const scanLeads = (records: Records) =>
  Effect.gen(function* () {
    const result: LeadRecord[] = [];
    const errors: CrewError[] = [];
    for (const row of yield* records.store.entries(StoragePrefix.make("lead/"))) {
      const decoded = yield* decode(LeadRecordSchema, row.value, row.key).pipe(Effect.result);
      if (decoded._tag === "Failure") {
        errors.push(decoded.failure);
        continue;
      }
      const record = decoded.success;
      if (row.key !== leadKey(record.id)) {
        errors.push(new CrewError("INVALID_DATA", "Conflicting lead key"));
        continue;
      }
      result.push(record);
    }
    const ids = result.flatMap((r) => [r.session_id, ...r.retired_sessions]);
    const seen = new Set<SessionId>();
    const conflicts = new Set<SessionId>();
    for (const id of ids) {
      if (seen.has(id)) conflicts.add(id);
      seen.add(id);
    }
    if (conflicts.size)
      errors.push(new CrewError("INVALID_DATA", "Conflicting lead session ownership"));
    return {
      records: result.filter(
        (r) => ![r.session_id, ...r.retired_sessions].some((id) => conflicts.has(id)),
      ),
      errors,
    };
  });
/** Authority readers reject the entire scan on any malformed/conflicting record. */
export const readLeads = (records: Records) =>
  scanLeads(records).pipe(
    Effect.flatMap((scan) =>
      scan.errors.length ? Effect.fail(scan.errors[0]!) : Effect.succeed(scan.records),
    ),
  );
export const leadAccounting = (records: Records) =>
  readLeads(records).pipe(
    Effect.map((leads) => ({
      active: leads.filter((l) => l.active || l.stop_pending).length,
      turns: (issue: IssueId) =>
        leads.reduce(
          (n, l) =>
            n +
            l.requests.reduce(
              (used, r) =>
                used + (r.issue_id === issue ? 1 + (r.request.response_recovery ? 1 : 0) : 0),
              0,
            ),
          0,
        ),
    })),
  );
