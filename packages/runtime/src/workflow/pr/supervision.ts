import { WorkflowError } from "../../errors.ts";
import { removeOwnedField } from "../../storage/store.ts";
import { Clock, Effect } from "effect";
import {
  ErrorCode,
  OperationAction,
  type IssueId,
  type SessionId,
} from "@abracode/contracts/identities";
import { type Execution, type Project } from "../../domain.ts";
import { type Records } from "../../storage/store.ts";
import { type Delivery, type DeliveryAssessment, type PR } from "../../git/delivery.ts";
import { type Runtime } from "../../opencode/runtime.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { type OpenSpec } from "../../openspec/adapter.ts";
import { type Operations } from "../operations.ts";
import { type WorkerSessions } from "../sessions.ts";
import { type Queries } from "../queries.ts";
import { type Corrections } from "../corrections.ts";
import { type ExecutionTransitions } from "../transitions.ts";
import { type CorrectionInputSchema } from "@abracode/contracts/workflow/correction-contracts";
import {
  type ActionInput,
  type FeedbackInput,
  feedbackPending,
} from "@abracode/contracts/workflow/feedback-contracts";
import { type OperationResult } from "../../git/operation-result.ts";
import { FeedbackService } from "./feedback.ts";
import { PRActions } from "./actions.ts";
import { actionPlan } from "./action-policy.ts";
import { automation } from "../../config/policy.ts";

interface Dependencies {
  records: Records;
  work: WorkGraph;
  spec: OpenSpec;
  delivery: Delivery;
  runtime: Runtime;
  operations: Operations;
  sessions: WorkerSessions;
  queries: Queries;
  corrections: Corrections;
  transitions: ExecutionTransitions;
}
/** Owns PR feedback operations and clearance under the controller's existing issue ownership. */
export class PRFeedback {
  readonly feedback: FeedbackService;
  readonly actions: PRActions;
  constructor(private c: Dependencies) {
    this.feedback = new FeedbackService(c.records, c.delivery);
    this.actions = new PRActions(c.records, c.delivery, c.runtime);
  }
  private project(e: Execution) {
    return this.c.queries.effectiveProject(e);
  }
  correct = (input: typeof CorrectionInputSchema.Type) =>
    this.c.operations.owned(input.issue_id, OperationAction.make("correct"), () =>
      Effect.gen({ self: this }, function* () {
        let e = yield* this.c.queries.get(input.issue_id);
        const p = yield* this.project(e);
        if (e.pull_request_reference && (yield* this.c.delivery.inspect(p, e))?.state === "MERGED")
          return yield* new WorkflowError(
            "CORRECTION_MERGED",
            "The pull request has already merged",
          );
        const prior = e.rounds?.at(-1);
        if (
          !e.delivered_commit &&
          prior?.source === "forge" &&
          prior.generation === e.control_generation &&
          prior.prior_delivered_commit === input.expected_head &&
          prior.instructions === input.instructions &&
          input.scope === "in_scope" &&
          JSON.stringify([...new Set(input.finding_ids)].sort()) === JSON.stringify(prior.findings)
        ) {
          if (e.stop_status)
            return yield* new WorkflowError(
              "CONTROL_PAUSED",
              "Resume the reserved correction explicitly",
            );
          if (e.active_role || e.session_intent)
            e = (yield* this.c.sessions.reconcile(e)).execution;
          else if (["planning", "applying"].includes(e.current_phase)) {
            if (e.current_phase === "planning") yield* this.c.spec.create(e);
            e = yield* this.c.sessions.launch(
              e,
              e.current_phase === "planning" ? "explore" : "apply",
            );
          }
          return e;
        }
        yield* this.c.sessions.idle(e);
        if (
          !["awaiting_merge", "blocked"].includes(e.current_phase) ||
          e.delivered_commit !== input.expected_head
        )
          return yield* new WorkflowError(
            "CORRECTION_HEAD",
            "Correction requires the retained current delivered head",
          );
        if (typeof this.c.delivery.findings !== "function")
          return yield* new WorkflowError(
            "FORGE_FINDINGS",
            "Delivery adapter does not support authoritative findings",
          );
        e = (yield* this.feedback.refresh(e, p, true)).execution;
        if (this.c.delivery.feedback && !e.feedback?.complete)
          return yield* new WorkflowError(
            "FEEDBACK_UNCONFIRMED",
            "Correction needs complete authoritative feedback",
          );
        const findings = e.feedback?.findings ?? (yield* this.c.delivery.findings(p, e));
        if (
          !input.finding_ids.every((id) =>
            findings.some((f) => f.id === id && f.head === input.expected_head),
          )
        )
          return yield* new WorkflowError(
            "FINDING_STALE",
            "Selected findings are missing or stale",
          );
        if (
          e.feedback?.actions.some(
            (a) => !["confirmed", "superseded", "rejected"].includes(a.status),
          )
        )
          return yield* new WorkflowError(
            "ACTION_UNCERTAIN",
            "Reconcile unfinished outward actions before changing the delivered head",
          );
        if (
          input.scope === "in_scope" &&
          e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open")
        )
          return yield* new WorkflowError(
            "DECISION_REQUIRED",
            "Resolve retained scope or feedback decisions before admitting a correction",
          );
        const issue = yield* this.c.work.show(e.issue_id);
        const correction = yield* this.c.corrections.prepare(
          e,
          "forge",
          input.finding_ids,
          input.instructions,
          input.scope,
          issue.status === "blocked",
        );
        e = correction.execution;
        const { role } = correction;
        if (!role) return e;
        if (e.pending_issue_status) e = yield* this.c.operations.reflectIssue(e);
        if (role === "explore") yield* this.c.spec.create(e);
        e = yield* this.c.sessions.launch(e, role);
        return e;
      }),
    );
  prAction = (input: typeof ActionInput.Type, actor: SessionId) =>
    this.c.operations.owned(input.issue_id, OperationAction.make("pr-action"), () =>
      Effect.gen({ self: this }, function* () {
        let e = yield* this.c.queries.get(input.issue_id);
        const p = yield* this.project(e);
        yield* this.c.sessions.idle(e);
        e = (yield* this.feedback.refresh(e, p, true)).execution;
        return yield* this.actions.run(e, p, input, actor);
      }),
    );
  feedbackDisposition = (input: typeof FeedbackInput.Type, actor: SessionId) =>
    this.c.operations.owned(input.issue_id, OperationAction.make("feedback"), () =>
      Effect.gen({ self: this }, function* () {
        let e = yield* this.c.queries.get(input.issue_id);
        e = (yield* this.feedback.refresh(e, yield* this.project(e), true)).execution;
        e = yield* this.feedback.disposition(e, input, actor);
        if (["scope_change", "uncertain"].includes(input.disposition)) {
          const opened = yield* this.c.corrections.decision(e, input.reason);
          e = opened.execution;
          const decision = opened.key;
          if (e.feedback) {
            e = {
              ...e,
              feedback: {
                ...e.feedback,
                findings: e.feedback.findings.map((f) =>
                  input.finding_ids.includes(f.id) && f.disposition
                    ? { ...f, disposition: { ...f.disposition, decision } }
                    : f,
                ),
              },
            };
            e = yield* this.c.records.saveOwned(e, ["feedback"]);
          }
        }
        return e;
      }),
    );
  reviewerSuggestions = (id: IssueId) =>
    Effect.gen({ self: this }, function* () {
      const e = yield* this.c.queries.get(id);
      if (typeof this.c.delivery.reviewers !== "function")
        return yield* new WorkflowError("FORGE_REVIEWERS", "Adapter has no reviewer suggestions");
      return yield* this.c.delivery.reviewers(yield* this.project(e), e);
    });
  findings = (id: IssueId) =>
    Effect.gen({ self: this }, function* () {
      const e = yield* this.c.queries.get(id);
      if (typeof this.c.delivery.findings !== "function")
        return yield* new WorkflowError("FORGE_FINDINGS", "Adapter has no findings");
      return yield* this.c.delivery.findings(yield* this.project(e), e);
    });
  poll = Effect.fn("PRFeedback.poll")({ self: this }, function* (e: Execution) {
    let assessment: DeliveryAssessment | undefined;
    if (
      e.delivered_commit &&
      (e.current_phase === "awaiting_merge" || (e.current_phase === "blocked" && e.delivery_block))
    ) {
      const project = yield* this.project(e);
      const result = yield* this.feedback.refresh(e, project);
      e = result.execution;
      const refreshed = result.refreshed;
      if (refreshed) assessment = result.assessment;
      if (e.feedback?.complete === false && e.feedback.inspection_required)
        e = (yield* this.c.corrections.decision(e, e.feedback.error!)).execution;
      if (this.c.delivery.actions && refreshed)
        e = yield* this.actions.automatic(e, project).pipe(
          Effect.catchIf(
            (error) =>
              ["RERUN_BUDGET", "THREAD_CHANGED", "FEEDBACK_UNADDRESSED"].includes(error.code),
            (error) =>
              this.c.corrections
                .decision(e, error.message)
                .pipe(Effect.map((result) => result.execution)),
          ),
        );
      if (
        e.current_phase === "blocked" &&
        e.delivery_block &&
        e.feedback?.complete &&
        !e.feedback.findings.some((f) => f.blocking)
      ) {
        e = yield* this.c.transitions.move(e, "awaiting_merge", {
          delivery_block: removeOwnedField,
          pending_issue_status: "in_progress",
        });
        e = yield* this.c.operations.reflectIssue(e);
      }
    }
    return { execution: e, assessment };
  });
  clearance = Effect.fn("PRFeedback.clearance")(
    { self: this },
    function* (e: Execution, p: Project, pr: PR | undefined, observed?: DeliveryAssessment) {
      let assessment = observed;
      if (!observed) {
        const fresh = yield* this.feedback.refresh(e, p, true);
        e = fresh.execution;
        if (fresh.refreshed) assessment = fresh.assessment;
      }
      const current = assessment?.pr ?? pr;
      if (!this.c.delivery.feedback && !e.feedback) {
        const policy = automation(e.effective_policy);
        if (
          policy.reviewers.request !== "manual" ||
          policy.discussion.replies !== "manual" ||
          policy.discussion.resolve_threads !== "manual" ||
          policy.ci_retry.max_reruns !== 0
        )
          return yield* new WorkflowError(
            "FORGE_FEEDBACK",
            "Configured PR automation requires authoritative feedback support",
          );
        return { execution: e, assessment };
      }
      const plan = current ? actionPlan(e, current, yield* Clock.currentTimeMillis) : undefined;
      if (
        !e.feedback ||
        feedbackPending(e.feedback) ||
        !plan ||
        plan.pending ||
        e.attention?.some(
          (a) =>
            a.code === "pr_feedback" &&
            a.batch?.head === e.delivered_commit &&
            a.generation === e.control_generation &&
            !["handled", "superseded"].includes(a.status),
        )
      ) {
        const first = plan?.required.find((r) => r.blocker || r.action?.status !== "confirmed");
        const blocker: OperationResult = {
          category: "waiting",
          code: ErrorCode.make("FEEDBACK_PENDING"),
          reason:
            first?.blocker?.reason ??
            (first
              ? `Required GitHub ${first.input.kind} action is not confirmed`
              : "PR feedback needs current assessment or action reconciliation"),
          owner: "supervisor",
        };
        return { execution: e, assessment, blocker };
      }
      return { execution: e, assessment };
    },
  );
}
