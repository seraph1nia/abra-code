import { sha256 } from "../../digest.ts";
import { Clock, Effect, Schema } from "effect";
import {
  IncidentId,
  IssueId,
  ObligationKey,
  RequestId,
  SessionId,
  WebSubmissionId,
} from "@abracode/contracts/identities";
import { Count, NonEmpty, RoleSchema } from "@abracode/contracts/primitives";
import { ValidationInput } from "@abracode/contracts/validation/contracts";
import { BriefingQuery, WorkBriefing } from "@abracode/contracts/visibility/briefing";
import { MessageInputSchema } from "@abracode/contracts/workflow/message-contracts";
import { CrewError } from "../../domain.ts";
import { workBriefing } from "../../visibility/briefing.ts";
import { BatchInputSchema } from "../../work/batch.ts";
import { WorkInputSchema } from "../../work/model.ts";
import { ScopeSchema } from "../../work/scope.ts";
import type { Controller } from "../../workflow/controller.ts";
import { deliveryAction, deliveryOutcome } from "../../visibility/delivery-outcome.ts";
import { WorkReportInputSchema } from "../../reporting/report-contracts.ts";
import { diagnosticText } from "../diagnostics.ts";
import { toolOutputs } from "../tool-contracts.ts";
import { defineTool as define, type DefinedTool } from "../tool-definition.ts";

const issueInput = Schema.Struct({ issue_id: IssueId });

export function workTools(c: Controller): DefinedTool[] {
  return [
    define({
      name: "work_briefing",
      diagnostic: true,
      description:
        "Read a bounded current snapshot for focus or catch-up. Includes human decisions, outcomes, ongoing work, queue and linked GitHub evidence. Set include_open_github only for an explicitly wider inbox.",
      input: BriefingQuery,
      output: WorkBriefing,
      run: (query) => workBriefing(c, query),
    }),
    define({
      name: "selection_answer",
      description:
        "Answer an admitted developer selection directly. Bind the answer to its request_id and issue_id so the developer can reopen it from their question.",
      input: Schema.Struct({
        request_id: WebSubmissionId,
        issue_id: IssueId,
        answer: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
      }),
      output: Schema.String,
      run: (a, s) => c.answerSelection(s, a.request_id, a.issue_id, a.answer),
    }),
    define({
      name: "work_message",
      description:
        "Send a retained correlated request to an existing current worker. Queue or steer without changing scope, permissions or approvals. Reuse request_id after response loss.",
      input: MessageInputSchema,
      output: toolOutputs.work_message,
      run: (a, s) => c.workMessage(a, s),
    }),
    define({
      name: "work_messages",
      description:
        "Inspect bounded retained requests, replies, findings and native admission observations without mutating work.",
      diagnostic: true,
      input: Schema.Struct({
        issue_id: IssueId,
        offset: Schema.optional(Count),
        limit: Schema.optional(
          Count.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)),
        ),
      }),
      output: toolOutputs.work_messages,
      run: (a) => c.queries.messages(a.issue_id, a.offset, a.limit),
    }),
    define({
      name: "work_validation",
      output: toolOutputs.work_validation,
      description:
        "Inspect selected no-mistakes preflight or explicitly approve setup, a bound gate response, abort, or guarded custody adoption. Never selects blanket yes or native fallback.",
      input: ValidationInput,
      run: (a, s) => c.validation(a, s),
    }),
    define({
      name: "work_report",
      diagnostic: (a) => a.action !== "generate",
      output: toolOutputs.work_report,
      description:
        "Read retained Markdown (default), inspect visual artifacts, or explicitly generate a trusted portable snapshot with action generate and stable request_id. Generation is not diagnostic/read authority.",
      input: WorkReportInputSchema,
      run: (a, s, call) =>
        a.action === "generate"
          ? c.visualReport(
              s,
              a.issue_id,
              {
                request_id: a.request_id,
                title: a.title,
                diagrams: a.diagrams,
                format: a.format,
                surface: a.surface,
              },
              { session_id: s, message_id: call.messageID, tool_call_id: call.id },
            )
          : a.action === "artifacts"
            ? c.get(a.issue_id).pipe(Effect.map((e) => e.visual_reports ?? []))
            : c.queries.report(a.issue_id),
    }),
    define({
      name: "work_scope",
      output: toolOutputs.work_scope,
      description:
        "Explicitly revise a research/lightweight contract before delivery; invalidates approval/check/review and requires the configured new scope approval.",
      input: Schema.Struct({ issue_id: IssueId, scope: ScopeSchema }),
      run: (a) => c.reviseScope(a.issue_id, a.scope),
    }),
    define({
      name: "work_attention",
      diagnostic: true,
      output: toolOutputs.work_attention,
      description:
        "Inspect a retained incident through status, then record handled/user_needed or explicitly retry an unavailable admission. This grants no lifecycle authority.",
      input: Schema.Struct({
        issue_id: IssueId,
        incident_id: IncidentId,
        generation: Count,
        action: Schema.Literals(["handled", "user_needed", "retry"]),
        reason: NonEmpty.check(Schema.isMaxLength(8192)),
      }),
      run: (a) =>
        c.attentionDisposition(a.issue_id, a.incident_id, a.generation, a.action, a.reason),
    }),
    define({
      name: "work_wait_disposition",
      diagnostic: true,
      output: toolOutputs.work_wait_disposition,
      description:
        "Explicitly supersede a declared wait after inspection, retaining the reason. Does not authorize a lifecycle checkpoint.",
      input: Schema.Struct({
        issue_id: IssueId,
        key: ObligationKey,
        generation: Count,
        evidence: NonEmpty.check(Schema.isMaxLength(8192)),
      }),
      run: (a) => c.waitDisposition(a.issue_id, a.key, a.generation, a.evidence),
    }),
    define({
      name: "work_decision",
      diagnostic: true,
      output: toolOutputs.work_decision,
      description:
        "Answer a Supervisor-owned decision, collect a user answer through a native form, or cancel/supersede an obligation. Inspect decisions through work_status.",
      input: Schema.Struct({
        issue_id: IssueId,
        key: ObligationKey,
        generation: Count,
        action: Schema.Literals(["answer", "collect", "cancel", "supersede", "reconsider"]),
        answer: Schema.optional(NonEmpty.check(Schema.isMaxLength(8192))),
      }),
      run: (a, s) => c.decision(a.issue_id, a.key, a.generation, s, a.action, a.answer),
    }),
    define({
      name: "work_create",
      output: toolOutputs.work_create,
      recoveryHint: "Inspect work_list; reuse the same request_id after repair.",
      description:
        "Turn a requested goal into a central issue for a registered repository, with optional priority and dependencies. Return the issue and readiness; use work_start to begin Explore when requested. Reuse request_id on retries; use a new key for intentionally separate requests.",
      input: WorkInputSchema,
      run: (a, s) => c.createWork(a, s),
    }),
    define({
      name: "work_create_batch",
      output: toolOutputs.work_create_batch,
      description:
        "Atomically record 1–32 keyed tasks with local/existing dependencies. Reuse request_id and identical keyed definitions after response loss. This creates no execution or approval authority.",
      input: BatchInputSchema,
      run: (a, s) => c.createWorkBatch(a, s),
    }),
    define({
      name: "work_list",
      diagnostic: true,
      output: toolOutputs.work_list,
      description:
        "List issues, executions, bounded supervision counts and record diagnostics. include_records exports original plugin records for coordinated backup without changing them.",
      input: Schema.Struct({ include_records: Schema.optional(Schema.Boolean) }),
      run: (a) => c.queries.workList(a.include_records),
    }),
    define({
      name: "work_ready",
      diagnostic: true,
      output: toolOutputs.work_ready,
      description: "Return ready work and dependency, policy, registration and capacity blockers.",
      input: Schema.Struct({}),
      run: () => c.ready(),
    }),
    define({
      name: "work_start",
      output: toolOutputs.work_start,
      description:
        "Atomically claim ready work and start/recover its native worktree and Explore session.",
      input: issueInput,
      run: (a, s) => c.start(a.issue_id, s),
    }),
    define({
      name: "work_diagnostics",
      diagnostic: true,
      output: toolOutputs.work_diagnostics,
      description:
        "Read the assigned worker sessions for an issue: native provider errors/status, actual and configured models, bounded recent messages and failed tool summaries. Available to the Supervisor without filesystem log access; no arbitrary session or log paths.",
      input: Schema.Struct({ issue_id: IssueId, role: Schema.optional(RoleSchema) }),
      run: (a) => c.diagnostics(a.issue_id, a.role),
    }),
    define({
      name: "work_status",
      diagnostic: true,
      output: toolOutputs.work_status,
      description:
        "Inspect issue status/history, Git, OpenSpec and native worker session progress.",
      input: issueInput,
      run: (a) =>
        Effect.gen(function* () {
          const retained = yield* c.queries.observeTask(a.issue_id, true);
          if (retained.execution_unavailable)
            return yield* new CrewError("OBSERVATION_UNAVAILABLE", retained.execution_unavailable);
          const e = retained.execution;
          if (!e)
            return yield* new CrewError("EXECUTION_MISSING", `Missing execution for ${a.issue_id}`);
          return {
            execution: e,
            retained_source: retained.source,
            execution_contract: c.queries.executionContract(e),
            supervision: yield* c.queries.supervision(e, [], retained.issue.status === "closed"),
            outcome: deliveryOutcome(e, retained.issue.status, yield* Clock.currentTimeMillis),
            issue: retained.issue,
            history: retained.history!,
            openspec:
              e.workflow_policy !== "full-openspec"
                ? null
                : e.archive_path
                  ? { archive: e.archive_path }
                  : e.worktree_directory
                    ? yield* c.queries
                        .specStatus(e)
                        .pipe(
                          Effect.catch((error) => Effect.sync(() => ({ error: error.message }))),
                        )
                    : null,
            git:
              e.worktree_directory && e.current_phase !== "completed"
                ? yield* c.queries
                    .dirty(e.worktree_directory)
                    .pipe(Effect.catch((error) => Effect.sync(() => ({ error: error.message }))))
                : null,
            sessions: yield* Effect.forEach(
              [
                e.explore_session_id,
                e.apply_session_id,
                e.review_session_id,
                e.research_session_id,
              ].filter((id): id is SessionId => !!id),
              (id) =>
                c.queries.session(id).pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => ({
                      id,
                      diagnostic_error: diagnosticText(error.message),
                    })),
                  ),
                ),
              { concurrency: "unbounded" },
            ),
          };
        }),
    }),
    define({
      name: "work_control",
      output: toolOutputs.work_control,
      description:
        "Pause, interrupt, resume, retry, steer or validate and advance a workflow checkpoint.",
      input: Schema.Struct({
        issue_id: IssueId,
        action: Schema.Literals([
          "pause",
          "interrupt",
          "resume",
          "retry",
          "steer",
          "advance",
          "replan",
          "recover_planning",
        ]),
        text: Schema.optional(NonEmpty),
        request_id: Schema.optional(RequestId),
      }),
      run: (a, session, context) =>
        Effect.gen(function* () {
          const generation =
            a.action === "steer" ? (yield* c.queries.get(a.issue_id)).control_generation : 0;
          return yield* c.control(a.issue_id, a.action, a.text, {
            sender: session,
            id:
              a.request_id ??
              RequestId.make(
                sha256(JSON.stringify([session, context.messageID, context.id, generation])),
              ),
          });
        }),
    }),
    define({
      name: "work_approve",
      output: toolOutputs.work_approve,
      description:
        "Request a native human approval form or collect its answered decision. Merge collection reports the receipt independently; eligible delivery continues through reconciliation. operation_in_progress means this request did not run or queue.",
      input: Schema.Struct({ issue_id: IssueId, kind: Schema.Literals(["plan", "merge"]) }),
      run: (a, s) =>
        deliveryAction(c.queries, a.issue_id, "approve", c.approve(a.issue_id, a.kind, s)),
    }),
    define({
      name: "work_finish",
      output: toolOutputs.work_finish,
      description:
        "Verify authorized delivery and report delivery, cleanup and closure separately. Ordinary retained files return a cleanup blocker; operation_in_progress means this request did not run or queue.",
      input: issueInput,
      run: (a) => deliveryAction(c.queries, a.issue_id, "finish", c.finish(a.issue_id)),
    }),
    define({
      name: "work_reconcile",
      output: toolOutputs.work_reconcile,
      description:
        "Reconcile issues, native sessions/worktree inventory, OpenSpec and delivery after interruption.",
      input: Schema.Struct({ issue_id: Schema.optional(IssueId) }),
      run: (a) => c.reconcile(a.issue_id),
    }),
  ];
}
