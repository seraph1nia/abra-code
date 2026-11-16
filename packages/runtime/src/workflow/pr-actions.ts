import { Clock, Effect } from "effect";
import { FormId, Fingerprint, type SessionId } from "../identities.ts";
import { ensure, type Execution, type Project, type CrewError } from "../domain.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { digest } from "../digest.ts";
import { type ActionInput } from "./feedback-contracts.ts";
import { actionFindings, type CurrentAction } from "./action-contracts.ts";
import { type ActionOutcome } from "../git/action-contracts.ts";
import { prepareAction } from "./action-policy.ts";
import { normalizeAction, confirmedAction, preparedInput, targetKey } from "./action-state.ts";
import { actionPlan } from "./action-plan.ts";
import { domainEffect } from "../effect.ts";

const staleCodes = new Set(["FINDING_STALE", "THREAD_CHANGED"]);
const permanentCodes = new Set([
  "REVIEWER_PERMISSION",
  "REVIEWER_SELF",
  "REVIEWER_TARGET",
  "THREAD_PERMISSION",
  "ACTION_AMBIGUOUS",
  "PR_HEAD",
  "PR_CLOSED",
  "ACTIONS_HEAD",
  "RERUN_ELIGIBILITY",
]);

/** Durable send admission follows read-only validation. Unknown effects are only observed. */
export class PRActions {
  constructor(
    private records: Records,
    private delivery: Delivery,
    private runtime: Runtime,
  ) {}
  prepare = prepareAction;
  private save(e: Execution, action: CurrentAction) {
    ensure(e.feedback, "FEEDBACK_REQUIRED", "Action needs retained feedback");
    e.feedback = {
      ...e.feedback,
      actions: [...e.feedback.actions.filter((a) => a.id !== action.id), action],
    };
    return this.records.saveOwned(e, ["feedback"]);
  }
  private result(
    e: Execution,
    action: CurrentAction,
    outcome: ActionOutcome,
    now: number,
    submitted = false,
  ) {
    return this.save(
      e,
      outcome.kind === "confirmed"
        ? confirmedAction(action, outcome.receipt, now)
        : {
            ...action,
            status: submitted ? "running" : action.status,
            updated_at: now,
            result: outcome.detail,
            submission: submitted ? { stage: "accepted", at: now } : action.submission,
          },
    );
  }
  private failedPreparation(e: Execution, action: CurrentAction, error: CrewError, now: number) {
    return this.save(e, {
      ...action,
      updated_at: now,
      status: staleCodes.has(error.code) ? "superseded" : "prepared",
      result: error.message.slice(0, 8192),
      preflight: {
        code: error.code,
        reason: error.message.slice(0, 8192),
        retryable: !permanentCodes.has(error.code) && !staleCodes.has(error.code),
        next_check_at: now + 30000,
      },
    });
  }
  run = Effect.fn("PRActions.run")(
    function* (
      this: PRActions,
      e: Execution,
      p: Project,
      input: typeof ActionInput.Type,
      actor?: SessionId,
      automatic = false,
    ) {
      const adapter = this.delivery.actions;
      ensure(adapter, "FORGE_ACTION", "Delivery adapter has no guarded PR actions");
      ensure(
        !e.stop_status &&
          input.generation === e.control_generation &&
          input.expected_head === e.delivered_commit,
        "ACTION_STALE",
        "Action needs the current unpaused delivered generation/head",
      );
      const retained = input.action_id
        ? e.feedback?.actions.find((a) => a.id === input.action_id)
        : undefined;
      if (input.action_id)
        ensure(
          retained && retained.head === input.expected_head && retained.kind === input.kind,
          "ACTION_STALE",
          "Retained action does not match current head or kind",
        );
      let action = retained
        ? normalizeAction(retained, e)
        : this.prepare(e, input, automatic, yield* Clock.currentTimeMillis);
      if (input.action_id) {
        ensure(
          (!input.finding_id || actionFindings(action).some((f) => f.id === input.finding_id)) &&
            (!input.body || (action.kind === "reply" && action.target.body === input.body)) &&
            (!input.users ||
              (action.kind === "reviewers" &&
                digest([...new Set(input.users)].sort()) === digest(action.target.users))) &&
            (!input.teams ||
              (action.kind === "reviewers" &&
                digest([...new Set(input.teams)].sort()) === digest(action.target.teams))),
          "ACTION_REBIND",
          "Reconciliation cannot change prepared targets or content",
        );
      }
      yield* this.save(e, action);
      if (["confirmed", "superseded", "rejected"].includes(action.status)) return e;
      if (action.submission.stage !== "unsubmitted") {
        const observed = yield* Effect.result(adapter.reconcile(p, e, action));
        if (observed._tag === "Success")
          yield* this.result(e, action, observed.success, yield* Clock.currentTimeMillis);
        else
          yield* this.save(e, {
            ...action,
            status: "uncertain",
            updated_at: yield* Clock.currentTimeMillis,
            result: observed.failure.message.slice(0, 8192),
          });
        return e;
      }
      const prior = e
        .feedback!.actions.map((a) => normalizeAction(a, e))
        .find(
          (a) =>
            a.id !== action.id &&
            a.submission.stage !== "unsubmitted" &&
            targetKey(a) === targetKey(action),
        );
      if (prior) {
        yield* this.save(e, {
          ...action,
          status: "superseded",
          updated_at: yield* Clock.currentTimeMillis,
          result: `Equivalent target already admitted as ${prior.id}`,
        });
        return e;
      }
      if (
        automatic &&
        action.preflight &&
        (!action.preflight.retryable ||
          action.preflight.next_check_at > (yield* Clock.currentTimeMillis))
      )
        return e;
      if (action.authority === "manual" && action.authorized_at === undefined) {
        ensure(actor, "ACTION_APPROVAL", "Manual action requires a central human approval form");
        const form = action.form_id ?? FormId.make(`frm_pr_action_${action.id.slice(0, 32)}`);
        const session = action.session_id ?? actor;
        action = { ...action, form_id: form, session_id: session };
        yield* this.save(e, action);
        yield* this.runtime.requestApproval(
          session,
          form,
          `GitHub ${action.kind}: ${action.pr}\\nHead: ${action.head}\\n${JSON.stringify(action.target)}`,
          Fingerprint.make(action.id),
        );
        const decision = yield* this.runtime.approval(session, form);
        if (decision === "pending") return e;
        if (decision === "rejected") {
          yield* this.save(e, { ...action, status: "rejected", result: "Human rejected action" });
          return e;
        }
        action = { ...action, authorized_at: yield* Clock.currentTimeMillis };
        yield* this.save(e, action);
      }
      const validationAt = yield* Clock.currentTimeMillis;
      const validated = yield* Effect.result(
        domainEffect(
          Effect.sync(() =>
            prepareAction(
              e,
              preparedInput(action, e),
              action.authority === "execution-policy",
              validationAt,
            ),
          ),
        ),
      );
      if (validated._tag === "Failure") {
        yield* this.failedPreparation(e, action, validated.failure, yield* Clock.currentTimeMillis);
        return e;
      }
      const prepared = yield* Effect.result(adapter.prepare(p, e, action));
      const now = yield* Clock.currentTimeMillis;
      if (prepared._tag === "Failure") {
        yield* this.failedPreparation(e, action, prepared.failure, now);
        return e;
      }
      if (prepared.success.kind === "confirmed") {
        yield* this.save(e, confirmedAction(action, prepared.success.receipt, now));
        return e;
      }
      if (prepared.success.kind === "awaiting") {
        yield* this.save(e, {
          ...action,
          result: prepared.success.detail,
          preflight: undefined,
          updated_at: now,
        });
        return e;
      }
      // The coordinated update rechecks current generation and pause immediately before admission.
      const admitted = {
        ...action,
        status: "running" as const,
        generation: input.generation,
        submission: { stage: "admitted" as const, at: now },
        preflight: undefined,
        updated_at: now,
      };
      const saved = yield* this.records.update(e.issue_id, (current) => {
        ensure(
          !current.stop_status &&
            current.control_generation === input.generation &&
            current.operation?.id === e.operation?.id &&
            current.delivered_commit === input.expected_head,
          "ACTION_STALE",
          "Write admission was superseded",
        );
        ensure(current.feedback, "FEEDBACK_REQUIRED", "Action history is missing");
        return {
          ...current,
          feedback: {
            ...current.feedback,
            actions: [...current.feedback.actions.filter((a) => a.id !== admitted.id), admitted],
          },
        };
      });
      synchronizeExecution(e, saved);
      action = admitted;
      const sent = yield* Effect.result(
        adapter.submit(p, e, { ...prepared.success.write, action }),
      );
      if (sent._tag === "Success")
        yield* this.result(e, action, sent.success, yield* Clock.currentTimeMillis, true);
      else
        yield* this.save(e, {
          ...action,
          status: "uncertain",
          updated_at: yield* Clock.currentTimeMillis,
          result: sent.failure.message.slice(0, 8192),
        });
      return e;
    }.bind(this),
    domainEffect,
  );
  automatic = Effect.fn("PRActions.automatic")(
    function* (this: PRActions, e: Execution, p: Project) {
      if (!e.feedback?.complete || !e.delivered_commit || e.stop_status || !this.delivery.actions)
        return;
      for (const a of e.feedback.actions.filter(
        (a) =>
          a.head === e.delivered_commit &&
          (["running", "uncertain"].includes(a.status) ||
            (a.status === "prepared" &&
              (a.authority === "execution-policy" || a.authorized_at !== undefined))),
      )) {
        yield* this.run(
          e,
          p,
          {
            issue_id: e.issue_id,
            generation: e.control_generation,
            expected_head: e.delivered_commit,
            kind: a.kind,
            action_id: a.id,
          },
          undefined,
          true,
        );
      }
      const attempted = new Set<string>();
      // Ready -> reviewers and reply -> resolution are finite prerequisite chains.
      for (let pass = 0; pass < 3; pass++) {
        const pr = yield* this.delivery.inspect(p, e);
        if (pr?.state !== "OPEN") return;
        const plan = actionPlan(e, pr, yield* Clock.currentTimeMillis);
        for (const stale of plan.stale)
          yield* this.save(e, {
            ...stale,
            status: "superseded",
            result: "Unsubmitted target no longer required by current evidence",
          });
        const due = plan.required.filter(
          (r) =>
            r.action &&
            !r.blocker &&
            !["confirmed", "rejected", "superseded"].includes(r.action.status) &&
            !attempted.has(r.action.id),
        );
        if (!due.length) return plan;
        for (const required of due) {
          attempted.add(required.action!.id);
          yield* this.run(e, p, required.input, undefined, true);
        }
      }
    }.bind(this),
    domainEffect,
  );
}
