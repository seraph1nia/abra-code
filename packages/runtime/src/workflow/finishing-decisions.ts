import { createHash } from "node:crypto";
import { Clock, Effect } from "effect";
import { ObligationKey, type IssueId, type SessionId } from "@abracode/contracts/identities";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { type FinishingTarget } from "./finishing-contracts.ts";
import { type Decision } from "./obligation-contracts.ts";
import { assertDecisionCapacity, makeControllerDecision } from "./decision-ledger.ts";
import { MAX_OUTBOX_ATTEMPTS, nextAttemptCount, nextCheckAt } from "./durable-outbox.ts";

/** Fresh absence resolves only the residue questions inspected by the owning operation. */
export const supersedeResidueDecisions = Effect.fn("FinishingDispositions.supersedeResidue")(
  function* (records: Records, e: Execution, keys: readonly ObligationKey[]) {
    const now = yield* Clock.currentTimeMillis;
    const saved = yield* records.update(e.issue_id, (current) => {
      if (
        current.control_generation !== e.control_generation ||
        current.operation?.id !== e.operation?.id
      )
        throw new CrewError("STALE_OPERATION", "Residue inspection ownership changed");
      const resolved = new Set(
        current.decisions
          ?.filter(
            (d) =>
              d.generation === e.control_generation &&
              d.status === "open" &&
              d.finishing_target?.kind === "residue" &&
              keys.includes(d.key),
          )
          .map((d) => d.key),
      );
      return {
        ...current,
        decisions: current.decisions?.map((d) =>
          resolved.has(d.key) && d.generation === e.control_generation
            ? { ...d, status: "superseded" as const, resolved_at: now }
            : d,
        ),
        finishing: current.finishing
          ? {
              ...current.finishing,
              current_question: current.decisions?.some(
                (d) =>
                  d.key === current.finishing?.current_question &&
                  d.generation === e.control_generation &&
                  d.status === "open" &&
                  !resolved.has(d.key),
              )
                ? current.finishing.current_question
                : undefined,
              routing: current.finishing.routing?.map((r) =>
                r.generation === e.control_generation && resolved.has(r.key)
                  ? { ...r, status: "superseded" as const, observed_at: now }
                  : r,
              ),
            }
          : undefined,
      };
    });
    synchronizeExecution(e, saved);
  },
  domainEffect,
);

/** Open or refocus a finishing disposition question and enqueue its durable routing state. */
export const openFinishingDecision = Effect.fn("FinishingDispositions.openFinishing")(function* (
  records: Records,
  e: Execution,
  target: FinishingTarget,
  question: string,
) {
  const digest = createHash("sha256")
    .update(
      target.kind === "planning_baseline_adoption" ? canonicalJSON(target) : JSON.stringify(target),
    )
    .digest("hex")
    .slice(0, 40);
  const key = ObligationKey.make(`finishing-${digest}`);
  const now = yield* Clock.currentTimeMillis;
  const saved = yield* records.update(e.issue_id, (current) => {
    if (
      current.control_generation !== e.control_generation ||
      current.operation?.id !== e.operation?.id
    )
      throw new CrewError("STALE_OPERATION", "Finishing decision ownership changed");
    if (current.decisions?.some((d) => d.key === key && d.generation === target.generation))
      return current.finishing?.current_question === key
        ? undefined
        : {
            ...current,
            finishing: { ...current.finishing, schema_version: 1, current_question: key },
          };
    assertDecisionCapacity(current.decisions);
    const superseded = (current.decisions ?? []).map((d) =>
      d.status === "open" &&
      d.generation === target.generation &&
      d.finishing_target?.kind === target.kind
        ? { ...d, status: "superseded" as const, resolved_at: now }
        : d,
    );
    return {
      ...current,
      decisions: [
        ...superseded,
        makeControllerDecision({
          key,
          generation: target.generation,
          scope:
            target.kind === "planning_baseline_adoption"
              ? "Prospective planning baseline adoption"
              : "Finishing existing work",
          question,
          openedAt: now,
          finishingTarget: target,
        }),
      ],
      finishing: {
        ...current.finishing,
        schema_version: 1,
        current_question: key,
        routing: [
          ...(current.finishing?.routing ?? []),
          {
            schema_version: 1,
            generation: target.generation,
            key,
            status: "undelivered",
            attempts: 0,
            next_check_at: now,
            observed_at: now,
          },
        ],
      },
    };
  });
  synchronizeExecution(e, saved);
  return key;
}, domainEffect);

/** Reopen the current resolved finishing decision while retaining its form history. */
export const reconsiderFinishingDecision = Effect.fn("FinishingDispositions.reconsider")(function* (
  records: Records,
  e: Execution,
  d: Decision,
  key: ObligationKey,
  generation: number,
) {
  if (
    !d.finishing_target ||
    !["answered", "cancelled"].includes(d.status) ||
    e.finishing?.current_question !== key ||
    e.current_phase === "completed"
  )
    return yield* new CrewError(
      "DECISION_RECONSIDER",
      "Only the current resolved finishing decision can be reconsidered",
    );
  if ((d.finishing_history?.length ?? 0) >= 64)
    return yield* new CrewError("DECISION_LIMIT", "Finishing form history is full");
  const now = yield* Clock.currentTimeMillis;
  const saved = yield* records.update(e.issue_id, (current) => {
    if (current.control_generation !== generation || current.finishing?.current_question !== key)
      throw new CrewError("DECISION_STALE", "Finishing target changed");
    const previous = current.decisions!.find(
      (item) => item.key === key && item.generation === generation,
    )!;
    return {
      ...current,
      decisions: current.decisions!.map((item) =>
        item === previous
          ? {
              ...item,
              status: "open",
              answer: undefined,
              finishing_answer: undefined,
              resolved_at: undefined,
              form_id: undefined,
              form_session: undefined,
              finishing_history: [
                ...(item.finishing_history ?? []),
                ...(item.form_id && item.form_session
                  ? [
                      {
                        form_id: item.form_id,
                        form_session: item.form_session,
                        target: item.finishing_target!,
                        answer: item.finishing_answer,
                        resolved_at: item.resolved_at ?? now,
                      },
                    ]
                  : []),
              ],
            }
          : item,
      ),
      finishing: {
        ...current.finishing,
        schema_version: 1,
        routing: current.finishing.routing?.map((r) =>
          r.key === key && r.generation === generation
            ? {
                ...r,
                status: "undelivered",
                attempts: 0,
                next_check_at: now,
                observed_at: now,
                form_id: undefined,
                session_id: undefined,
              }
            : r,
        ),
      },
    };
  });
  return saved.decisions!.find((item) => item.key === key && item.generation === generation)!;
}, domainEffect);

/** Collect pending user-owned decisions and apply bounded outbox retry backoff for finishing routes. */
export const collectPendingDecisions = Effect.fn("FinishingDispositions.collectPending")(function* (
  records: Records,
  resolveCollect: (
    id: IssueId,
    key: ObligationKey,
    generation: number,
    session: SessionId,
  ) => Effect.Effect<Decision, CrewError>,
  e: Execution,
) {
  for (const d of e.decisions ?? []) {
    const now = yield* Clock.currentTimeMillis;
    const route = e.finishing?.routing?.find(
      (r) => r.key === d.key && r.generation === d.generation,
    );
    const session =
      d.form_session ??
      (d.finishing_target ? (e.supervisor_session_id ?? (yield* records.supervisor)) : undefined);
    if (
      d.status === "open" &&
      d.generation === e.control_generation &&
      d.owner === "user" &&
      (d.form_session || d.finishing_target) &&
      (!route ||
        (route.next_check_at <= now &&
          (route.status === "pending" || route.attempts < MAX_OUTBOX_ATTEMPTS)))
    ) {
      const result = session
        ? yield* Effect.result(resolveCollect(e.issue_id, d.key, d.generation, session))
        : undefined;
      if (d.finishing_target) {
        const saved = yield* records.update(e.issue_id, (current) => {
          if (current.control_generation !== e.control_generation) return;
          const decision = current.decisions?.find(
            (item) => item.key === d.key && item.generation === d.generation,
          );
          if (!decision || decision.status !== "open") return;
          const route = current.finishing?.routing?.find(
            (r) => r.key === d.key && r.generation === d.generation,
          );
          if (
            !route ||
            (result?._tag === "Success" &&
              route.status === "pending" &&
              route.form_id === decision.form_id &&
              route.session_id === decision.form_session &&
              !route.reason)
          )
            return;
          return {
            ...current,
            finishing: {
              ...current.finishing,
              schema_version: 1,
              routing: current.finishing?.routing?.map((r) =>
                r.key === d.key && r.generation === d.generation
                  ? {
                      ...r,
                      attempts:
                        result?._tag === "Success" ? r.attempts : nextAttemptCount(r.attempts),
                      observed_at: now,
                      status: result?._tag === "Success" ? "pending" : "undelivered",
                      next_check_at:
                        result?._tag === "Success" ? now : nextCheckAt(now, r.attempts + 1),
                      form_id: decision.form_id,
                      session_id: decision.form_session,
                      reason:
                        result?._tag === "Failure"
                          ? result.failure.message.slice(0, 8192)
                          : !session
                            ? "Retained Abra session unavailable"
                            : undefined,
                    }
                  : r,
              ),
            },
          };
        });
        synchronizeExecution(e, saved);
      } else if (result?._tag === "Failure") return yield* result.failure;
    }
  }
  return (yield* records.execution(e.issue_id))!;
}, domainEffect);
