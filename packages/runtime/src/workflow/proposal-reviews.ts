import { diagnosticText } from "../opencode/diagnostics.ts";
import { Clock, Effect, Option } from "effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { ObligationKey, SessionId, type Fingerprint } from "@abracode/contracts/identities";
import { designAnswerRows } from "@abracode/contracts/workflow/obligation-summary";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { decodeJSON } from "../decode.ts";
import type { Capacity } from "./capacity.ts";
import { removeOwnedField, type Records } from "../storage/store.ts";
import type { Runtime } from "../opencode/runtime.ts";
import { appendDecision, makeControllerDecision } from "./decision-ledger.ts";
import {
  reviewAnswers,
  reviewSatisfied,
  scopeKey,
  scopeAnswered,
  currentReview,
  readerPrompt,
  ReaderReport,
  type ReviewRevision,
} from "./proposal-review-contracts.ts";

const retry = "Retry review";
const proceed = "Continue without review";
const recoveryChoice = [
  {
    question: "How should this plan proceed?",
    recommended: retry,
    reason: "Obtain an independent reading before implementation.",
    alternatives: [proceed],
  },
];
const newSession = () => SessionId.make("ses_proposal_" + Session.ID.create().slice(4));
export function selectReview(
  e: Execution,
  fingerprint: Fingerprint,
  path: string,
  proposal: string,
) {
  const previous = e.proposal_reviews ?? [];
  if (previous.some((review) => review.fingerprint === fingerprint)) return previous;
  const review: ReviewRevision = {
    fingerprint,
    path,
    proposal,
    session: newSession(),
    prompt: SessionMessage.ID.create(),
    planner_notice: SessionMessage.ID.create(),
    attempt: 1,
    status: "pending",
  };
  return [...previous, review];
}

/** Reconcile one exact review under the controller's existing operation ownership. */
export class ProposalReviews {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private capacity: Capacity,
    private timeoutMs: number,
  ) {}
  private save(e: Execution, review: ReviewRevision) {
    return this.records.commitOwned(e, (current) => {
      if (
        current.plan_fingerprint !== review.fingerprint ||
        current.current_phase !== "awaiting_plan_approval"
      )
        throw new CrewError("STALE_OPERATION", "Proposal review revision changed");
      return {
        ...(review.status !== "pending" &&
          current.capacity_reservation?.session_id === review.session && {
            capacity_reservation: removeOwnedField,
            capacity_observed_idle: true,
          }),
        proposal_reviews: current.proposal_reviews!.map((old) =>
          old.fingerprint === review.fingerprint ? review : old,
        ),
      };
    });
  }
  private observe = Effect.fn("ProposalReviews.observe")(
    { self: this },
    function* (e: Execution, review: ReviewRevision) {
      if (!review.proposal.trim())
        return yield* new CrewError(
          "READER_SOURCE",
          "The selected schema has no readable proposal",
        );
      if (!this.runtime.ensureProposalReader || !this.runtime.readProposalReport)
        return yield* new CrewError(
          "READER_UNAVAILABLE",
          "The native proposal reviewer is unavailable",
        );
      yield* this.runtime.ensureProposalReader(e, review);
      const prompt = readerPrompt(review);
      const admission = () => this.runtime.promptAdmission(review.session, review.prompt, prompt);
      const state = yield* admission();
      const now = yield* Clock.currentTimeMillis;
      const timedOut = review.started_at !== undefined && now - review.started_at > this.timeoutMs;
      const waiting = () =>
        timedOut
          ? this.runtime
              .interrupt(review.session, review.prompt)
              .pipe(
                Effect.andThen(
                  Effect.fail(
                    new CrewError(
                      "READER_TIMEOUT",
                      "The proposal reviewer did not return a report in time",
                    ),
                  ),
                ),
              )
          : Effect.succeed(review);
      if (state === "absent") {
        const sent = yield* this.runtime
          .prompt(review.session, prompt, review.prompt)
          .pipe(Effect.result);
        if (sent._tag === "Failure" && (yield* admission()) === "absent")
          return yield* sent.failure;
        return review;
      }
      if (state === "queued") return yield* waiting();
      const session = yield* this.runtime.session(review.session, review.prompt);
      if (session.busy || session.completion_pending) return yield* waiting();
      const outcome = session.assignment?.outcome;
      if (!outcome) return yield* waiting();
      if (outcome !== "succeeded")
        return yield* new CrewError(
          "READER_FAILED",
          session.error?.message ?? "Reviewer did not finish",
        );
      const output = yield* this.runtime.readProposalReport(review);
      const report = yield* decodeJSON(
        ReaderReport,
        output.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/, "$1"),
        "Proposal review report",
      );
      return { ...review, status: "completed" as const, report };
    },
  );
  private decision = Effect.fn("ProposalReviews.decision")(
    { self: this },
    function* (e: Execution, prefix: string, question: string, recovery: boolean) {
      const prior = reviewAnswers(e, prefix);
      if (prior.at(-1)?.status === "open") return e;
      const decision = makeControllerDecision({
        key: ObligationKey.make(prefix + prior.length),
        generation: e.control_generation,
        question,
        scope: "Independent proposal review",
        openedAt: yield* Clock.currentTimeMillis,
      });
      return yield* this.records.commitOwned(e, (current) => ({
        decisions: appendDecision(current.decisions, {
          ...decision,
          proposal_fingerprint: e.plan_fingerprint,
          ...(recovery && { choices: recoveryChoice }),
        }),
      }));
    },
  );
  supersede = Effect.fn("ProposalReviews.supersede")({ self: this }, function* (e: Execution) {
    const review = currentReview(e);
    if (review?.status !== "pending") return e;
    if (e.capacity_reservation?.session_id === review.session)
      yield* this.runtime.interrupt(review.session, review.prompt).pipe(
        Effect.catchIf(
          (error) => error.code === "SESSION_NOT_FOUND",
          () => Effect.void,
        ),
      );
    return yield* this.records.commitOwned(e, {
      capacity_wait: removeOwnedField,
      capacity_reservation: removeOwnedField,
      capacity_observed_idle: true,
    });
  });
  reconcile = Effect.fn("ProposalReviews.reconcile")(
    { self: this },
    function* (e: Execution, project: Project) {
      let review = currentReview(e);
      if (!e.proposal_review || !review || reviewSatisfied(e)) return e;
      if (review.status === "pending") {
        if (e.capacity_reservation?.session_id !== review.session) {
          const slot = yield* this.capacity.reserve(e, "review", project);
          e = slot.execution;
          if (!slot.admitted) return e;
          e = yield* this.records.commitOwned(e, {
            capacity_reservation: {
              role: "review",
              generation: e.control_generation,
              status: "active",
              session_id: review.session,
              prompt_id: review.prompt,
            },
          });
        }
        if (review.started_at === undefined) {
          review = { ...review, started_at: yield* Clock.currentTimeMillis };
          e = yield* this.save(e, review);
        }
        const result = yield* this.observe(e, review).pipe(Effect.result);
        if (result._tag === "Failure") {
          const error = result.failure;
          review = {
            ...review,
            status: "unavailable",
            reason: diagnosticText(error.message, 2048),
            reuse_session_on_retry: ![
              "INVALID_DATA",
              "READER_FAILED",
              "READER_CONTEXT",
              "READER_TIMEOUT",
            ].includes(error.code),
          };
        } else if (result.success === review) return e;
        else review = result.success;
        e = yield* this.save(e, review);
      }
      if (review.status === "unavailable") {
        const prefix = `reader-${review.fingerprint}-a${review.attempt}-`;
        const answer = reviewAnswers(e, prefix).at(-1);
        const rows = Option.getOrUndefined(designAnswerRows(answer?.answer ?? ""));
        const choice = answer?.status === "answered" && rows?.length === 1 && rows[0]?.answer;
        if (choice === proceed) return yield* this.save(e, { ...review, status: "continued" });
        if (choice === retry)
          return yield* this.save(e, {
            ...review,
            status: "pending",
            attempt: review.attempt + 1,
            reason: undefined,
            started_at: undefined,
            ...(review.reuse_session_on_retry
              ? {}
              : { session: newSession(), prompt: SessionMessage.ID.create() }),
          });
        return yield* this.decision(
          e,
          prefix,
          `Independent review pending for ${review.fingerprint}. ${review.reason}`,
          true,
        );
      }
      if (!review.report) return e;
      const feedback = review.report.findings.filter((f) => f.owner === "planner");
      if (feedback.length && !review.planner_notified && e.explore_session_id) {
        yield* this.runtime.notify(
          e.explore_session_id,
          "Editorial feedback for plan " +
            review.fingerprint +
            "\n" +
            feedback.map((f) => f.question + "\n" + f.evidence).join("\n\n"),
          review.planner_notice,
        );
        review = { ...review, planner_notified: true };
        e = yield* this.save(e, review);
      }
      for (const [index, finding] of review.report!.findings.entries()) {
        const key = scopeKey(review, index);
        if (finding.owner === "human" && !scopeAnswered(e, review, index))
          e = yield* this.decision(
            e,
            key,
            finding.question + "\n\nEvidence: " + finding.evidence,
            false,
          );
      }
      return e;
    },
  );
}
