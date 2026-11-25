import { Effect } from "effect";
import { Session } from "@opencode/client/effect";
import { LockKey, type SessionId, timestamp } from "@abracode/contracts/identities";
import { decode } from "../decode.ts";
import { ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { BatchResultSchema } from "../work/batch.ts";
import {
  LeadControlSchema,
  readLeads,
  type LeadControl,
  type LeadRecord,
} from "./lead-contracts.ts";
import { leadJson, createLeadRequest, type LeadControlDeps } from "./leads-control.ts";
export function registerLead(
  deps: LeadControlDeps,
  parent: SessionId,
  input: Extract<LeadControl, { action: "register" }>,
  allLeads: readonly LeadRecord[],
  existing: LeadRecord | undefined,
) {
  return Effect.gen(function* () {
    let l = existing;
    const repositories = [...input.repositories].sort();
    const sameSpec = (record: LeadRecord) =>
      record.parent_session_id === parent &&
      record.enabled === input.enabled &&
      JSON.stringify(record.repositories) === JSON.stringify(repositories) &&
      JSON.stringify(record.model) === JSON.stringify(input.model);
    if (l && l.revision === input.expected_revision && sameSpec(l))
      return yield* leadJson(yield* deps.reconcileOne(l));
    if (l && l.revision !== input.expected_revision) {
      ensure(
        l.revision === input.expected_revision + 1 && sameSpec(l),
        "LEAD_REVISION",
        "Registration changed; inspect current revision",
      );
    } else {
      ensure(
        l ? l.parent_session_id === parent : input.expected_revision === 0,
        "LEAD_REVISION",
        "Current expected registration revision required",
      );
      yield* Effect.forEach(
        repositories,
        (repo) =>
          deps.records
            .project(repo)
            .pipe(
              Effect.tap((p) =>
                Effect.sync(() => ensure(p, "LEAD_SCOPE", "Registered repositories required")),
              ),
            ),
        { concurrency: 4 },
      );
      const changed =
        l &&
        (JSON.stringify(l.repositories) !== JSON.stringify(repositories) ||
          JSON.stringify(l.model) !== JSON.stringify(input.model));
      ensure(
        !changed || (!l!.enabled && !l!.active && !l!.stop_pending),
        "LEAD_ACTIVE",
        "Disable and confirm stop before changing scope or model",
      );
      ensure(
        !l || l.retired_sessions.length < 32 || !changed,
        "LEAD_LIMIT",
        "Lead session revision limit reached",
      );
      ensure(l || allLeads.length < 32, "LEAD_LIMIT", "Registration limit reached");
      const old = l;
      l = {
        schema_version: 1,
        id: input.id,
        revision: (old?.revision ?? 0) + 1,
        repositories,
        routing_since:
          !old || changed || (!old.enabled && input.enabled)
            ? yield* timestamp
            : (old.routing_since ?? (yield* timestamp)),
        parent_session_id: parent,
        session_id: changed || !old ? Session.ID.create() : old.session_id,
        retired_sessions: changed
          ? [...old!.retired_sessions, old!.session_id]
          : (old?.retired_sessions ?? []),
        model: input.model,
        enabled: input.enabled,
        provisioned: changed ? false : (old?.provisioned ?? false),
        active: old?.active ?? false,
        stop_pending: !changed && !!old?.provisioned && !input.enabled,
        requests:
          old?.requests.map((r) => ({
            ...r,
            request: ["answered", "cancelled", "superseded"].includes(r.request.status)
              ? r.request
              : { ...r.request, status: "superseded" as const },
          })) ?? [],
        proposals: old?.proposals ?? [],
      };
      yield* deps.commit(() => deps.save(l!));
    }
    return yield* leadJson(yield* deps.reconcileOne(l!));
  });
}

export function controlLead(deps: LeadControlDeps, parent: SessionId, raw: LeadControl) {
  return domainEffect(
    Effect.gen(function* () {
      const input = yield* decode(LeadControlSchema, raw, "Lead control");
      const initialLeads = yield* deps.root(parent);
      if (input.action === "status")
        return yield* leadJson(initialLeads.filter((l) => !input.id || l.id === input.id));
      return yield* deps.locks.with(LockKey.make(`lead-${input.id}`), () =>
        domainEffect(
          Effect.gen(function* () {
            const allLeads = yield* readLeads(deps.records);
            let l = allLeads.find((r) => r.id === input.id);
            if (input.action === "register")
              return yield* registerLead(deps, parent, input, allLeads, l);
            ensure(
              l &&
                l.parent_session_id === parent &&
                l.enabled &&
                l.revision === input.revision &&
                !l.stop_pending,
              "LEAD_REVISION",
              "Current enabled lead required",
            );
            if (input.action === "message")
              return yield* leadJson(
                yield* createLeadRequest(deps, l, input.issue_id, input.request_id, input.body),
              );
            const p = l.proposals.find((item) => item.request_id === input.request_id);
            ensure(
              p && p.revision === l.revision,
              "LEAD_PROPOSAL",
              "Current retained proposal required",
            );
            if (!p.accepted) {
              const accepted = yield* deps
                .createBatch(p.batch, parent)
                .pipe(
                  Effect.flatMap((r) => decode(BatchResultSchema, r, "Accepted lead proposal")),
                );
              const session = l.session_id;
              l = yield* deps.commit(() =>
                Effect.gen(function* () {
                  const current = yield* deps.current(session, input.revision);
                  const next = {
                    ...current,
                    proposals: current.proposals.map((r) =>
                      r.request_id === p.request_id && r.revision === p.revision
                        ? { ...r, accepted }
                        : r,
                    ),
                  };
                  yield* deps.save(next);
                  return next;
                }),
              );
            }
            return yield* leadJson(
              l.proposals.find((item) => item.request_id === input.request_id),
            );
          }),
        ),
      );
    }),
  );
}
