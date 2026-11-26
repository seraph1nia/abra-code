import { WorkflowError } from "../../errors.ts";
import { tryDomainValue } from "../../effect.ts";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import {
  StorageKey,
  type IssueId,
  type LeadId,
  type SessionId,
} from "@abracode/contracts/identities";
import { requestHistoryError } from "@abracode/contracts/workflow/message-contracts";
import { decode } from "../../decode.ts";
import { CrewError } from "../../domain.ts";
import { type Records } from "../../storage/store.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { LeadRecordSchema, leadKey, readLeads, type LeadRecord } from "./contracts.ts";

const principalRevision = StorageKey.make("observation/lead-revision");
export class LeadStore {
  private principals?: { revision?: string; sessions: Map<SessionId, LeadRecord> };

  constructor(
    private records: Records,
    private work: WorkGraph,
  ) {}
  commit<A>(fn: () => Effect.Effect<A, CrewError>) {
    return this.records.coordinateCommit(fn);
  }

  save(record: LeadRecord) {
    return this.commit(() =>
      Effect.gen({ self: this }, function* () {
        const r = yield* decode(LeadRecordSchema, record, "Lead registration");
        const prior = yield* this.records.store.get(leadKey(r.id));
        if (prior !== undefined) {
          const old = yield* decode(LeadRecordSchema, prior, "Retained lead registration");
          const byId = new Map(r.requests.map((item) => [item.request.request_id, item.request]));
          for (const item of old.requests) {
            const current = byId.get(item.request.request_id);
            if (!current)
              return yield* new WorkflowError(
                "MESSAGE_HISTORY",
                "Retained lead request cannot be removed",
              );
            const error = requestHistoryError(item.request, current);
            if (error) return yield* new WorkflowError("MESSAGE_HISTORY", error);
          }
        }
        // The enclosing coordination lock orders this fence with the following write.
        // A lost write acknowledgement invalidates other native plugin instances too.
        yield* this.records.store.set(principalRevision, randomUUID());
        yield* this.records.store.set(leadKey(r.id), r);
      }),
    );
  }

  readById = (id: LeadId) =>
    this.records.store
      .get(leadKey(id))
      .pipe(
        Effect.flatMap((raw) =>
          raw === undefined
            ? Effect.undefined
            : decode(LeadRecordSchema, raw, "Retained lead registration"),
        ),
      );

  updateLead = (
    id: LeadId,
    fallback: LeadRecord,
    transform: (current: LeadRecord) => LeadRecord | undefined,
  ) =>
    this.commit(() =>
      Effect.gen({ self: this }, function* () {
        const current = yield* this.readById(id);
        if (!current) return fallback;
        const next = yield* tryDomainValue(transform, current);
        if (!next) return current;
        yield* this.save(next);
        return next;
      }),
    );

  principal = (session: SessionId) =>
    this.records.coordination.with(
      () =>
        Effect.gen({ self: this }, function* () {
          const revision = yield* decode(
            Schema.UndefinedOr(Schema.String),
            yield* this.records.store.get(principalRevision),
            principalRevision,
          );
          if (this.principals && this.principals.revision === revision)
            return this.principals.sessions.get(session);
          const sessions = new Map<SessionId, LeadRecord>();
          for (const lead of yield* readLeads(this.records)) {
            sessions.set(lead.session_id, lead);
            for (const retired of lead.retired_sessions) sessions.set(retired, lead);
          }
          this.principals = { revision, sessions };
          return sessions.get(session);
        }),
      { shared: true },
    );

  current(session: SessionId, revision: number) {
    return Effect.gen({ self: this }, function* () {
      const l = yield* this.principal(session);
      if (
        !l ||
        l.session_id !== session ||
        l.revision !== revision ||
        !l.enabled ||
        !l.provisioned ||
        l.stop_pending
      )
        return yield* new WorkflowError(
          "LEAD_STALE",
          "Enabled current project-lead principal required",
        );
      return l;
    });
  }

  scoped(l: LeadRecord, issue: IssueId) {
    return Effect.gen({ self: this }, function* () {
      const task = yield* this.work.show(issue);
      if (!l.repositories.includes(task.repository_id))
        return yield* new WorkflowError(
          "LEAD_SCOPE",
          "Issue is outside the registered project scope",
        );
      return task;
    });
  }
}
