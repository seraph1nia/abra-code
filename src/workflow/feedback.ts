import { Clock, Effect } from "effect";
import { ensure, type Execution, type Project } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Delivery, type DeliveryAssessment } from "../git/delivery.ts";
import { domainEffect } from "../effect.ts";
import {
  type FeedbackInput,
  mergeFeedback,
  actionable,
  type Feedback,
} from "./feedback-contracts.ts";
import { type SessionId } from "../identities.ts";

/** Called under issue operation ownership; observing and classifying never grant mutation authority. */
export class FeedbackService {
  constructor(
    private records: Records,
    private delivery: Delivery,
  ) {}
  refresh = Effect.fn("Feedback.refresh")(
    function* (this: FeedbackService, e: Execution, p: Project, force = false) {
      if (
        !this.delivery.feedback ||
        !e.delivered_commit ||
        !e.pull_request_reference ||
        e.stop_status ||
        p.delivery !== "github-pr"
      )
        return;
      const now = yield* Clock.currentTimeMillis;
      if (!force && e.feedback?.head === e.delivered_commit && e.feedback.next_check_at > now)
        return;
      const pr = yield* this.delivery.inspect(p, e);
      if (pr?.state === "MERGED") return;
      let assessment: DeliveryAssessment | undefined;
      const result = yield* Effect.result(
        this.delivery.assessment
          ? this.delivery.assessment(p, e).pipe(
              Effect.tap((a) =>
                Effect.sync(() => {
                  assessment = a;
                }),
              ),
              Effect.map((a) => a.feedback),
            )
          : this.delivery.feedback(p, e),
      );
      if (result._tag === "Failure") {
        if (["PR_HEAD", "FORGE_IDENTITY", "PR_IDENTITY"].includes(result.failure.code))
          return yield* result.failure;
        const attempts = Math.min((e.feedback?.attempts ?? 0) + 1, 8);
        e.feedback = {
          ...(e.feedback ?? {
            schema_version: 1,
            head: e.delivered_commit,
            pr: e.pull_request_reference,
            target: e.target_branch ?? p.target_branch,
            digest: "unobserved",
            findings: [],
            history: [],
            actions: [],
          }),
          complete: false,
          error: result.failure.message.slice(0, 8192),
          observed_at: now,
          next_check_at: now + Math.min(300000, 30000 * 2 ** (attempts - 1)),
          attempts,
        };
      } else {
        const next = mergeFeedback(e.feedback, result.success);
        const last = e.rounds?.at(-1);
        const verified =
          e.verification_receipt &&
          e.review_receipt?.passed &&
          e.verification_receipt.fingerprint === e.review_receipt.fingerprint;
        e.feedback = {
          ...next,
          findings: next.findings.map((f) =>
            next.complete &&
            next.head === e.delivered_commit &&
            last?.findings.includes(f.id) &&
            verified &&
            last.prior_delivered_commit !== e.delivered_commit
              ? {
                  ...f,
                  disposition: {
                    status: "addressed" as const,
                    head: e.delivered_commit!,
                    at: now,
                    actor: "controller",
                    reason: "Published corrective head passed verification and independent Review",
                    correction: last.id,
                  },
                }
              : f,
          ),
        };
        if (e.feedback.history.length > 4096) {
          const retained = yield* this.records.execution(e.issue_id);
          ensure(
            retained?.feedback,
            "FEEDBACK_HISTORY_LIMIT",
            "Feedback history requires inspection",
          );
          e.feedback = {
            ...retained.feedback,
            complete: false,
            inspection_required: true,
            error: "Feedback history reached its retained limit; inspect history before continuing",
            observed_at: now,
            next_check_at: now + 300000,
          };
        }
      }
      yield* this.records.saveOwned(e, ["feedback", "forge_observation"]);
      return assessment ?? true;
    }.bind(this),
    domainEffect,
  );

  disposition = Effect.fn("Feedback.disposition")(
    function* (
      this: FeedbackService,
      e: Execution,
      input: typeof FeedbackInput.Type,
      actor: SessionId,
    ) {
      ensure(
        !e.stop_status &&
          e.control_generation === input.generation &&
          e.delivered_commit === input.expected_head,
        "FEEDBACK_STALE",
        "Feedback disposition requires the current generation and delivered head",
      );
      const feedback = e.feedback;
      ensure(
        feedback?.complete && feedback.head === input.expected_head,
        "FEEDBACK_UNCONFIRMED",
        "Refresh authoritative feedback before classifying it",
      );
      ensure(
        input.finding_ids.every((id) => feedback.findings.some((f) => f.id === id)),
        "FINDING_STALE",
        "Selected finding revision is missing",
      );
      ensure(
        !["addressed", "superseded", "unclassified"].includes(input.disposition),
        "FEEDBACK_DISPOSITION",
        "Addressed and superseded states require controller evidence",
      );
      const now = yield* Clock.currentTimeMillis;
      e.feedback = {
        ...feedback,
        findings: feedback.findings.map((f) =>
          input.finding_ids.includes(f.id)
            ? {
                ...f,
                disposition: {
                  status: input.disposition,
                  head: input.expected_head,
                  at: now,
                  actor,
                  reason: input.reason,
                },
              }
            : f,
        ),
      };
      yield* this.records.saveOwned(e, ["feedback", "forge_observation"]);
      return e;
    }.bind(this),
    domainEffect,
  );
}

export function pendingFindings(feedback: Feedback | undefined) {
  return feedback?.complete
    ? feedback.findings
        .filter(
          (f) =>
            actionable(f, feedback.head) &&
            (!f.disposition ||
              f.disposition.head !== feedback.head ||
              f.disposition.status === "unclassified"),
        )
        .slice(0, 64)
    : [];
}
