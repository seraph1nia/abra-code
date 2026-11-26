import { WorkflowError } from "../../errors.ts";
import { nextCheckAt } from "../messaging/outbox.ts";
import { Clock, Effect } from "effect";
import { type Execution, type Project } from "../../domain.ts";
import { type Records } from "../../storage/store.ts";
import { type Delivery, type DeliveryAssessment } from "../../git/delivery.ts";
import { type FeedbackInput, mergeFeedback } from "@abracode/contracts/workflow/feedback-contracts";
import { type SessionId } from "@abracode/contracts/identities";

/** Called under issue operation ownership; observing and classifying never grant mutation authority. */
export class FeedbackService {
  constructor(
    private records: Records,
    private delivery: Delivery,
  ) {}
  refresh = Effect.fn("Feedback.refresh")(
    { self: this },
    function* (e: Execution, p: Project, force = false) {
      if (
        !this.delivery.feedback ||
        !e.delivered_commit ||
        !e.pull_request_reference ||
        e.stop_status ||
        p.delivery !== "github-pr"
      )
        return { execution: e, refreshed: false as const };
      const now = yield* Clock.currentTimeMillis;
      if (!force && e.feedback?.head === e.delivered_commit && e.feedback.next_check_at > now)
        return { execution: e, refreshed: false as const };
      const pr = yield* this.delivery.inspect(p, e);
      if (pr?.state === "MERGED") return { execution: e, refreshed: false as const };
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
        e = {
          ...e,
          feedback: {
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
            next_check_at: nextCheckAt(now, attempts),
            attempts,
          },
        };
      } else {
        const next = mergeFeedback(e.feedback, result.success);
        const last = e.rounds?.at(-1);
        const verified =
          e.verification_receipt &&
          e.review_receipt?.passed &&
          e.verification_receipt.fingerprint === e.review_receipt.fingerprint;
        e = {
          ...e,
          feedback: {
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
                      reason:
                        "Published corrective head passed verification and independent Review",
                      correction: last.id,
                    },
                  }
                : f,
            ),
          },
        };
        if (next.history.length > 4096) {
          const retained = yield* this.records.execution(e.issue_id);
          if (!retained?.feedback)
            return yield* new WorkflowError(
              "FEEDBACK_HISTORY_LIMIT",
              "Feedback history requires inspection",
            );
          e = {
            ...e,
            feedback: {
              ...retained.feedback,
              complete: false,
              inspection_required: true,
              error:
                "Feedback history reached its retained limit; inspect history before continuing",
              observed_at: now,
              next_check_at: now + 300000,
            },
          };
        }
      }
      e = yield* this.records.commitOwned(e, {
        feedback: e.feedback,
        ...(assessment?.forge_observation && { forge_observation: assessment.forge_observation }),
      });
      return { execution: e, refreshed: true as const, assessment };
    },
  );

  disposition = Effect.fn("Feedback.disposition")(
    { self: this },
    function* (e: Execution, input: typeof FeedbackInput.Type, actor: SessionId) {
      if (
        e.stop_status ||
        e.control_generation !== input.generation ||
        e.delivered_commit !== input.expected_head
      )
        return yield* new WorkflowError(
          "FEEDBACK_STALE",
          "Feedback disposition requires the current generation and delivered head",
        );
      const feedback = e.feedback;
      if (!feedback?.complete || feedback.head !== input.expected_head)
        return yield* new WorkflowError(
          "FEEDBACK_UNCONFIRMED",
          "Refresh authoritative feedback before classifying it",
        );
      if (!input.finding_ids.every((id) => feedback.findings.some((f) => f.id === id)))
        return yield* new WorkflowError("FINDING_STALE", "Selected finding revision is missing");
      if (["addressed", "superseded", "unclassified"].includes(input.disposition))
        return yield* new WorkflowError(
          "FEEDBACK_DISPOSITION",
          "Addressed and superseded states require controller evidence",
        );
      const now = yield* Clock.currentTimeMillis;
      e = {
        ...e,
        feedback: {
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
        },
      };
      return yield* this.records.saveOwned(e, ["feedback"]);
    },
  );
}
