import { Effect } from "effect";
import { type IssueId, type LeadId, type SessionId } from "@abracode/contracts/identities";
import { requestHistoryError } from "@abracode/contracts/workflow/message-contracts";
import { decode } from "../decode.ts";
import { ensure, CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { LeadRecordSchema, leadKey, readLeads, type LeadRecord } from "./lead-contracts.ts";

export class LeadStore {
  constructor(
    private records: Records,
    private work: WorkGraph,
  ) {}
  commit<A>(fn: () => Effect.Effect<A, CrewError>) {
    return this.records.coordinateCommit(() => domainEffect(fn()));
  }

  save(record: LeadRecord) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const r = yield* decode(LeadRecordSchema, record, "Lead registration");
        const prior = yield* this.records.store.get(leadKey(r.id));
        if (prior !== undefined) {
          const old = yield* decode(LeadRecordSchema, prior, "Retained lead registration");
          const byId = new Map(r.requests.map((item) => [item.request.request_id, item.request]));
          for (const item of old.requests) {
            const current = byId.get(item.request.request_id);
            ensure(current, "MESSAGE_HISTORY", "Retained lead request cannot be removed");
            const error = requestHistoryError(item.request, current);
            ensure(!error, "MESSAGE_HISTORY", error ?? "Invalid lead request history");
          }
        }
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
        const next = transform(current);
        if (!next) return current;
        yield* this.save(next);
        return next;
      }),
    );

  principal = (session: SessionId) =>
    readLeads(this.records).pipe(
      Effect.map((ls) =>
        ls.find((l) => l.session_id === session || l.retired_sessions.includes(session)),
      ),
    );

  current(session: SessionId, revision: number) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const l = yield* this.principal(session);
        ensure(
          l &&
            l.session_id === session &&
            l.revision === revision &&
            l.enabled &&
            l.provisioned &&
            !l.stop_pending,
          "LEAD_STALE",
          "Enabled current project-lead principal required",
        );
        return l;
      }),
    );
  }

  scoped(l: LeadRecord, issue: IssueId) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const task = yield* this.work.show(issue);
        ensure(
          l.repositories.includes(task.repository_id),
          "LEAD_SCOPE",
          "Issue is outside the registered project scope",
        );
        return task;
      }),
    );
  }
}
