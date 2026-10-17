import { Clock, Effect, Schema } from "effect";
import { Count, NonEmpty } from "../contracts.ts";
import { AbsolutePath, Commit, ExecutionId, IssueId, Timestamp } from "../identities.ts";
import { type Execution, type Issue, CrewError } from "../domain.ts";
import { CleanupBlockerSchema } from "../git/retirement-contracts.ts";
import { GeneratedPathsSchema } from "../config/paths.ts";
import { OperationIntentSchema } from "./operation-contracts.ts";
import { ExecutionBusy } from "./operations.ts";
import { type Queries } from "./queries.ts";
import { CleanupPreflightSchema } from "./finishing-contracts.ts";
import { ObligationKey, FormId, Fingerprint } from "../identities.ts";

export const FinishingOutcomeSchema = Schema.Struct({
  consumed: Count,
  automatic_remaining: Count.check(Schema.isLessThanOrEqualTo(2)),
  synchronization: Schema.optional(
    Schema.Struct({
      stage: NonEmpty,
      input: Fingerprint,
      published: Commit,
      intended_commit: Schema.optional(Commit),
    }),
  ),
  preflight: Schema.optional(CleanupPreflightSchema),
  preflight_age_ms: Schema.optional(Count),
  questions: Schema.Array(
    Schema.Struct({
      key: ObligationKey,
      owner: Schema.Literal("user"),
      question: NonEmpty,
      routing: Schema.Literals(["undelivered", "pending", "answered", "deferred", "superseded"]),
      form_id: Schema.optional(FormId),
      age_ms: Count,
      choices: Schema.Array(NonEmpty),
    }),
  ),
});

export const DeliveryOutcomeSchema = Schema.Struct({
  execution_id: ExecutionId,
  generation: Count,
  delivered_commit: Schema.optional(Commit),
  observed_at: Count,
  finishing: Schema.optional(FinishingOutcomeSchema),
  approval: Schema.Struct({
    kind: Schema.Literals(["plan", "merge"]),
    state: Schema.Literals(["recorded", "pending", "rejected", "not_required", "unavailable"]),
    evidence_at: Schema.optional(Timestamp),
  }),
  delivery: Schema.Struct({
    kind: Schema.Literals(["github-pr", "branch", "report"]),
    state: Schema.Literals(["verified", "waiting", "unconfirmed"]),
    evidence_at: Schema.optional(Timestamp),
  }),
  cleanup: Schema.Struct({
    state: Schema.Literals(["retired", "blocked", "in_progress", "not_started", "unavailable"]),
    blocker: Schema.optional(CleanupBlockerSchema),
    worktree: Schema.optional(AbsolutePath),
    generated_paths: GeneratedPathsSchema,
  }),
  closure: Schema.Literals(["open", "closed", "unavailable"]),
  next_action: NonEmpty,
});
export type DeliveryOutcome = typeof DeliveryOutcomeSchema.Type;

/** A presentation of committed evidence, never authority to approve or retire. */
export function deliveryOutcome(
  e: Execution,
  status: Issue["status"] | undefined,
  at: number,
): DeliveryOutcome {
  const kind = e.workflow_policy === "research-only" || !e.delivered_commit ? "plan" : "merge";
  const target = kind === "plan" ? e.plan_fingerprint : e.delivered_commit;
  const approval = e.approval_receipts.findLast((a) => a.kind === kind && a.fingerprint === target);
  const required = kind === "plan" ? e.plan_approval_required : e.merge_approval_required;
  const report = e.workflow_policy === "research-only";
  const verified = report
    ? !!e.report_receipt && e.report_receipt.scope_fingerprint === e.scope?.fingerprint
    : !!e.delivery_receipt &&
      !!e.delivered_commit &&
      (e.delivery_receipt.source_commit ?? e.delivery_receipt.commit) === e.delivered_commit;
  const unsafe = !!e.error_or_recovery_reason || e.current_phase === "recovery_required";
  const blocked =
    verified &&
    !unsafe &&
    e.cleanup_blocker?.generation === e.control_generation &&
    e.cleanup_blocker.preservation === (report ? e.report_receipt?.hash : e.delivered_commit)
      ? e.cleanup_blocker
      : undefined;
  const retired = e.retirement?.native === "confirmed";
  const last = e.finishing?.synchronization?.at(-1);
  const preflight =
    e.finishing?.preflight?.generation === e.control_generation ? e.finishing.preflight : undefined;
  const questions = (e.decisions ?? [])
    .filter(
      (d) =>
        d.finishing_target &&
        d.generation === e.control_generation &&
        (d.status === "open" ||
          (d.key === e.finishing?.current_question && d.status === "answered")),
    )
    .map((d) => {
      const route = e.finishing?.routing?.find(
        (r) => r.key === d.key && r.generation === d.generation,
      );
      const target = d.finishing_target!;
      return {
        key: d.key,
        owner: "user" as const,
        question: d.question,
        routing: route?.status ?? ("undelivered" as const),
        form_id: d.form_id,
        age_ms: Math.max(0, at - (route?.observed_at ?? d.opened_at)),
        choices:
          target.kind === "residue"
            ? [
                ...(target.directories.length ? ["generated"] : []),
                ...(target.files.length ? ["include"] : []),
                "preserve",
                "defer",
              ]
            : ["authorize", "defer"],
      };
    });
  return {
    execution_id: e.execution_id,
    generation: e.control_generation,
    delivered_commit: e.delivered_commit,
    observed_at: at,
    finishing: e.finishing
      ? {
          consumed: e.finishing.synchronization?.length ?? 0,
          automatic_remaining: Math.max(0, 2 - (e.finishing.synchronization?.length ?? 0)),
          synchronization: last
            ? {
                stage: last.stage,
                input: last.input,
                published: last.published,
                intended_commit: last.intended_commit,
              }
            : undefined,
          preflight,
          preflight_age_ms: preflight ? Math.max(0, at - preflight.observed_at) : undefined,
          questions,
        }
      : undefined,
    approval: {
      kind,
      state: approval?.authorized_at
        ? "recorded"
        : approval?.rejected_at
          ? "rejected"
          : !required
            ? "not_required"
            : approval
              ? "pending"
              : "unavailable",
      evidence_at: approval?.authorized_at ?? approval?.rejected_at,
    },
    delivery: {
      kind: report ? "report" : e.delivery_policy,
      state: verified ? "verified" : e.delivery_wait ? "waiting" : "unconfirmed",
      evidence_at: verified && !report ? e.delivery_receipt?.at : undefined,
    },
    cleanup: {
      state: retired
        ? "retired"
        : unsafe
          ? "unavailable"
          : blocked
            ? "blocked"
            : e.current_phase === "cleaning"
              ? "in_progress"
              : "not_started",
      blocker: blocked,
      worktree: e.worktree_directory,
      generated_paths: e.effective_policy.generated_paths,
    },
    closure: status === undefined ? "unavailable" : status === "closed" ? "closed" : "open",
    next_action: unsafe
      ? "Inspect abra_work_status and the recovery runbook; preserve resources."
      : e.stop_status || e.current_phase === "interrupted"
        ? "Work is paused or stopping. Observe status; resume only through an explicitly authorized controller action."
        : questions.length
          ? questions.some((q) => q.routing === "undelivered")
            ? "A required finishing form is undelivered. Restore the retained Abra session and collect its exact-action decision; files remain preserved."
            : questions.some((q) => q.routing === "pending")
              ? "Answer the current finishing form in Abra. Matching dispositions resume eligible work automatically; preservation still requires fresh absence inspection."
              : questions.some((q) => q.routing === "deferred")
                ? "Finishing is deferred. Reconsider the current decision in Abra when ready; retained files remain preserved."
                : "The finishing answer is recorded. Preserve selected items outside the worktree when requested; automatic inspection resumes eligible work. Follow-on work requires separate authorization."
          : blocked
            ? "Finishing waits on retained files. Use the current exact-action form or preserve the files elsewhere; automatic inspection continues without another finish request."
            : retired && status === "closed"
              ? "No action required."
              : "Observe abra_work_status again; automatic reconciliation continues eligible authorized work. Pending human forms must still be answered.",
  };
}

export const OperationInProgressSchema = Schema.Struct({
  category: Schema.Literal("operation_in_progress"),
  issue_id: IssueId,
  requested_action: Schema.Literals(["approve", "finish"]),
  performed: Schema.Literal(false),
  observed_at: Count,
  operation: Schema.optional(OperationIntentSchema),
  outcome: Schema.optional(DeliveryOutcomeSchema),
  next_action: NonEmpty,
});

type Reads = Pick<Queries, "execution" | "issue">;
export const observeDeliveryOutcome = (reads: Reads, e: Execution) =>
  Effect.gen(function* () {
    const issue = yield* reads.issue(e.issue_id).pipe(Effect.orElseSucceed(() => undefined));
    return deliveryOutcome(e, issue?.status, yield* Clock.currentTimeMillis);
  });

/** The action stays controller-owned; only acquisition contention is an unexecuted observation. */
export function deliveryAction<A extends Execution | { execution: Execution }>(
  reads: Reads,
  id: IssueId,
  action: "approve" | "finish",
  body: Effect.Effect<A, CrewError>,
) {
  return body.pipe(
    Effect.flatMap((result) =>
      observeDeliveryOutcome(reads, "execution" in result ? result.execution : result).pipe(
        Effect.map((outcome) => ({ ...result, outcome })),
      ),
    ),
    Effect.catchIf(
      (error) => error instanceof ExecutionBusy && error.issue_id === id,
      () =>
        Effect.gen(function* () {
          const e = yield* reads.execution(id).pipe(
            Effect.timeout("2 seconds"),
            Effect.orElseSucceed(() => undefined),
          );
          const outcome = e
            ? yield* observeDeliveryOutcome(reads, e).pipe(
                Effect.timeout("2 seconds"),
                Effect.orElseSucceed(() => undefined),
              )
            : undefined;
          return {
            category: "operation_in_progress" as const,
            issue_id: id,
            requested_action: action,
            performed: false as const,
            observed_at: yield* Clock.currentTimeMillis,
            operation: e?.operation,
            outcome,
            next_action:
              "Observe abra_work_status again. This request did not run or queue. Recollect approval only if its matching receipt is still missing; an external delivery result may still be unconfirmed.",
          };
        }),
    ),
  );
}

/** Safe plain text for native views; paths remain quoted data, including control characters. */
export function deliveryOutcomeLines(outcome: DeliveryOutcome): string[] {
  const c = outcome.cleanup;
  return [
    `Approval (${outcome.approval.kind}): ${outcome.approval.state}`,
    `Delivery (${outcome.delivery.kind}): ${outcome.delivery.state}`,
    `Cleanup: ${c.state} · Issue: ${outcome.closure}`,
    `Observed: ${new Date(outcome.observed_at).toISOString()} (receipt evidence may be older)`,
    ...(outcome.finishing
      ? [
          `Synchronization allowance: ${outcome.finishing.consumed} consumed · ${outcome.finishing.automatic_remaining} automatic remaining`,
          ...(outcome.finishing.synchronization
            ? [
                `Synchronization: ${outcome.finishing.synchronization.stage} · last publication ${outcome.finishing.synchronization.published}`,
              ]
            : []),
          outcome.finishing.preflight
            ? `Cleanup preflight: ${outcome.finishing.preflight.status} · evidence age ${outcome.finishing.preflight_age_ms} ms (observation only)`
            : "Cleanup preflight: unobserved",
          ...outcome.finishing.questions.map(
            (q) =>
              `Finishing question (${q.owner}, ${q.routing}, age ${q.age_ms} ms): ${q.question} · Choices: ${q.choices.join(", ")}`,
          ),
        ]
      : []),
    ...(c.blocker
      ? [
          `Owned worktree: ${JSON.stringify(c.worktree)}`,
          ...c.blocker.paths.map((p) => `${p.category} ${p.kind}: ${JSON.stringify(p.path)}`),
          c.blocker.truncated
            ? "Path sample truncated; inspect the owned worktree for the full inventory."
            : "Path inventory complete as of its observation.",
          `Files observed: ${new Date(c.blocker.observed_at).toISOString()}`,
          `Captured generated directories: ${JSON.stringify(c.generated_paths)}`,
        ]
      : []),
    outcome.next_action,
  ];
}
