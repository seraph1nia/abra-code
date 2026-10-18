import { LeadActionSchema, LeadControlSchema } from "../workflow/lead-contracts.ts";
import { deliveryAction, observeDeliveryOutcome } from "../workflow/delivery-outcome.ts";
import { MessageInputSchema, WorkerReplySchema } from "../workflow/message-contracts.ts";
import { createHash } from "node:crypto";
import { type ConfigApplication } from "../config/application.ts";
import { ConfigurationReportSchema, configurationReport } from "../config/declarations.ts";
import { ValidationInput } from "../validation/contracts.ts";
import { FeedbackInput, ActionInput } from "../workflow/feedback-contracts.ts";
import { defineTool as define, type ToolAccess } from "./tool-definition.ts";
import { toolOutputs } from "./tool-contracts.ts";
import {
  ArtifactId,
  IssueId,
  RepositoryId,
  ObligationKey,
  IncidentId,
  SessionId,
  RequestId,
} from "../identities.ts";

import { CorrectionInputSchema } from "../workflow/correction-contracts.ts";
import { ReviewReportSchema } from "../workflow/review-contracts.ts";
import { ScopeSchema } from "../work/scope.ts";
import { BatchInputSchema } from "../work/batch.ts";
import { WorkInputSchema } from "../work/model.ts";
import { WorkReportInputSchema, ReportInputSchema } from "../workflow/report-contracts.ts";
import { NonEmpty, RoleSchema, Count } from "../contracts.ts";
import { QuestionInputSchema, WaitInputSchema } from "../workflow/obligation-contracts.ts";
import { domainEffect } from "../effect.ts";
import { Effect, Schema } from "effect";

import { ProjectInputFields } from "../config/contracts.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { CrewError } from "../domain.ts";
import { type Controller } from "../workflow/controller.ts";
import { type Onboarding } from "../config/onboard.ts";
import { ProjectSetup } from "../config/setup.ts";
import { diagnosticText } from "./diagnostics.ts";
import { workerFor } from "./guards.ts";
const issueInput = Schema.Struct({ issue_id: IssueId });
export function registerTools(
  ctx: Context,
  c: Controller,
  onboard: Onboarding,
  central: boolean,
  setup: ProjectSetup,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> = (effect) => effect,
  configuration?: ConfigApplication,
) {
  return domainEffect(
    Effect.gen(function* () {
      const definitions = [
        define({
          name: "lead_control",
          description:
            "Abra-only registration, revision, scoped requests and acceptance of project-lead proposals. Inspect status before changing a registration.",
          input: LeadControlSchema,
          output: Schema.Json,
          run: (a, s) => c.lead().control(s, a),
        }),
        define({
          name: "lead_action",
          description:
            "Registered project-lead scoped status, proposals, correlated replies, supervisor-owned answers and retained finding forwarding. No execution or approval authority.",
          lead: true,
          input: LeadActionSchema,
          output: Schema.Json,
          run: (a, s) => c.lead().action(s, a),
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
          name: "worker_reply",
          description:
            "Acknowledge or answer a controller request, or submit keyed findings for Abra to route. Findings grant no authority.",
          worker: true,
          input: WorkerReplySchema,
          output: toolOutputs.worker_reply,
          run: (a, s) => c.workerReply(s, a),
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
          name: "config",
          diagnostic: (a) => a.action === "status",
          description:
            "Inspect declaration outcomes or explicitly apply the current YAML repository settings. Does not change active execution settings or initialize projects.",
          input: Schema.Struct({
            action: Schema.Literals(["status", "apply"]),
            page: Schema.optional(Count),
          }),
          output: ConfigurationReportSchema,
          run: (a) =>
            configuration
              ? a.action === "apply"
                ? configuration
                    .apply()
                    .pipe(
                      Effect.map((outcomes) =>
                        configurationReport(outcomes, a.page, configuration.dispatch()),
                      ),
                    )
                : configuration
                    .status()
                    .pipe(
                      Effect.map((outcomes) =>
                        configurationReport(outcomes, a.page, configuration.dispatch()),
                      ),
                    )
              : Effect.fail(
                  new CrewError("CONFIG_UNAVAILABLE", "Configuration application is unavailable"),
                ),
        }),
        define({
          name: "work_reviewers",
          output: toolOutputs.work_reviewers,
          description:
            "Suggest eligible reviewers using supported CODEOWNERS patterns and bounded recent authorship. Suggestions never request a review.",
          input: issueInput,
          run: (a) => c.reviewerSuggestions(a.issue_id),
        }),
        define({
          name: "work_feedback_status",
          diagnostic: true,
          output: toolOutputs.work_feedback_status,
          description:
            "Read retained observations, exact revisions, dispositions, action receipts and paged history without polling or mutating GitHub.",
          input: Schema.Struct({ issue_id: IssueId, page: Schema.optional(Count) }),
          run: (a) => c.queries.feedback(a.issue_id, a.page),
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
          name: "work_pr_action",
          output: toolOutputs.work_pr_action,
          description:
            "Prepare or reconcile a concrete draft-ready, reviewer, reply, thread-resolution or CI-rerun action. Manual authority requires its bound human form; observers/workers cannot send.",
          input: ActionInput,
          run: (a, s) => c.prAction(a, s),
        }),
        define({
          name: "work_feedback",
          diagnostic: true,
          output: toolOutputs.work_feedback,
          description:
            "Classify exact current-head finding revisions; comments grant no scope or merge authority.",
          input: FeedbackInput,
          run: (a, s) => c.feedbackDisposition(a, s),
        }),
        define({
          name: "work_findings",
          diagnostic: true,
          output: toolOutputs.work_findings,
          description:
            "Read bounded authoritative findings bound to the delivered PR head. Comments are evidence, never authority.",
          input: issueInput,
          run: (a) => c.findings(a.issue_id),
        }),
        define({
          name: "work_correct",
          diagnostic: true,
          output: toolOutputs.work_correct,
          description:
            "Classify selected current-head forge findings against approved scope; enabled finite repair policy may admit a round. Uncertain/scope-changing findings create a decision.",
          input: CorrectionInputSchema,
          run: (a) => c.correct(a),
        }),
        define({
          name: "research_report",
          output: toolOutputs.research_report,
          description:
            "Submit the assigned immutable research report for controller publication outside the worktree.",
          input: ReportInputSchema,
          worker: true,
          run: (a, s) => c.researchReport(s, a),
        }),
        define({
          name: "work_report",
          diagnostic: (a) => a.action !== "generate",
          output: toolOutputs.work_report,
          description:
            "Read retained Markdown (default), inspect visual artifacts, or explicitly generate a trusted portable snapshot with action generate and stable request_id. Generation is not diagnostic/read authority.",
          input: WorkReportInputSchema,
          run: (a, s) =>
            a.action === "generate"
              ? c.visualReport(s, a.issue_id, {
                  request_id: a.request_id,
                  title: a.title,
                  diagrams: a.diagrams,
                })
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
          name: "worker_question",
          output: toolOutputs.worker_question,
          description:
            "Open a durable keyed scope question. Answers never authorize plan, merge or delivery.",
          input: QuestionInputSchema,
          worker: true,
          run: (a, s) => c.workerQuestion(s, a),
        }),
        define({
          name: "worker_progress",
          output: toolOutputs.worker_progress,
          description: "Report meaningful progress for the current assigned generation.",
          input: Schema.Struct({
            generation: Count,
            summary: NonEmpty.check(Schema.isMaxLength(8192)),
          }),
          worker: true,
          run: (a, s) => c.workerProgress(s, a.generation, a.summary),
        }),
        define({
          name: "worker_wait",
          output: toolOutputs.worker_wait,
          description:
            "Declare a bounded dependency, decision or controller-owned command wait with its clearing evidence.",
          input: WaitInputSchema,
          worker: true,
          run: (a, s) => c.workerWait(s, a),
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
          name: "project_onboard",
          output: toolOutputs.project_onboard,
          description:
            "Onboard a remote URL without a local checkout, or an existing checkout path. Inspect instructions and checks; register even if setup is pending. Never ask the user to clone a remote first.",
          input: Schema.Struct({
            ...ProjectInputFields,
            action: Schema.optional(Schema.Literals(["inspect", "register"])),
            initialize_openspec: Schema.optional(Schema.Boolean),
          }),
          run: (a, s) =>
            domainEffect(
              Effect.gen(function* () {
                if (a.action !== "register") return yield* onboard.inspect(a);
                const report = yield* onboard.register(a, a.initialize_openspec === true);
                if (
                  report.project.managed &&
                  !report.project.openspec &&
                  a.initialize_openspec === true
                )
                  return {
                    ...report,
                    setup: yield* setup.run(a.id, "prepare", s, true),
                  };
                return report;
              }),
            ),
        }),
        define({
          name: "project_list",
          diagnostic: true,
          output: toolOutputs.project_list,
          description: "List explicitly registered repositories.",
          input: Schema.Struct({}),
          run: () =>
            domainEffect(
              Effect.gen(function* () {
                return yield* Effect.forEach(
                  yield* c.queries.projects(),
                  (p) =>
                    domainEffect(
                      Effect.gen(function* () {
                        return {
                          ...p,
                          effective_capacity: {
                            active_workers: p.max_workers,
                            retained_executions: p.max_executions,
                          },
                          setup_blockers: [
                            ...(!p.openspec
                              ? ["OpenSpec configuration is missing; use abra_project_setup"]
                              : []),
                            ...(!p.verification.length
                              ? ["Verification commands are missing"]
                              : []),
                          ],
                          setup: yield* c.queries.setup(p.id),
                        };
                      }),
                    ),
                  { concurrency: "unbounded" },
                );
              }),
            ),
        }),
        define({
          name: "project_setup",
          output: toolOutputs.project_setup,
          description:
            "Prepare an explicitly authorized OpenSpec setup in a native worktree, deliver its branch/PR, request human merge approval, or verify delivery and retire resources. Does not alter issues.",
          input: Schema.Struct({
            id: RepositoryId,
            action: Schema.Literals(["prepare", "deliver", "approve", "finish"]),
            initialize_openspec: Schema.optional(Schema.Boolean),
          }),
          run: (a, s) => setup.run(a.id, a.action, s, a.initialize_openspec === true),
        }),
        define({
          name: "work_create",
          output: toolOutputs.work_create,
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
          run: (a) =>
            domainEffect(
              Effect.gen(function* () {
                return {
                  supervision: yield* c.queries.supervisionAggregate(),
                  issues: yield* c.queries.issues(),
                  executions: yield* c.queries.executions(),
                  record_diagnostics: yield* c.queries.recordDiagnostics(),
                  records: a.include_records ? yield* c.queries.recordsExport() : undefined,
                };
              }),
            ),
        }),
        define({
          name: "work_ready",
          diagnostic: true,
          output: toolOutputs.work_ready,
          description:
            "Return ready work and dependency, policy, registration and capacity blockers.",
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
            domainEffect(
              Effect.gen(function* () {
                const e = yield* c.get(a.issue_id);
                return {
                  execution: e,
                  supervision: yield* c.queries.supervision(e),
                  outcome: yield* observeDeliveryOutcome(c.queries, e),
                  issue: yield* c.queries.issue(a.issue_id),
                  history: yield* c.queries.history(a.issue_id),
                  openspec:
                    e.workflow_policy !== "full-openspec"
                      ? null
                      : e.archive_path
                        ? { archive: e.archive_path }
                        : e.worktree_directory
                          ? yield* c.queries.specStatus(e).pipe(
                              Effect.catch((error) =>
                                domainEffect(
                                  Effect.sync(() => {
                                    return { error: error.message };
                                  }),
                                ),
                              ),
                            )
                          : null,
                  git:
                    e.worktree_directory && e.current_phase !== "completed"
                      ? yield* c.queries.dirty(e.worktree_directory).pipe(
                          Effect.catch((error) =>
                            domainEffect(
                              Effect.sync(() => {
                                return { error: error.message };
                              }),
                            ),
                          ),
                        )
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
                          domainEffect(
                            Effect.sync(() => {
                              return {
                                id,
                                diagnostic_error: diagnosticText(error.message),
                              };
                            }),
                          ),
                        ),
                      ),
                    { concurrency: "unbounded" },
                  ),
                };
              }),
            ),
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
                    createHash("sha256")
                      .update(JSON.stringify([session, context.messageID, context.id, generation]))
                      .digest("hex"),
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
        define({
          name: "spec",
          output: toolOutputs.spec,
          description:
            "Read the assigned OpenSpec change status or instructions. Does not modify workflow state.",
          input: Schema.Struct({
            action: Schema.Literals(["status", "instructions", "apply"]),
            artifact: Schema.optional(ArtifactId),
          }).check(
            Schema.makeFilter(
              (a) =>
                a.action !== "instructions" || !!a.artifact || "Instructions require an artifact",
            ),
          ),
          worker: true,
          run: (a, s) =>
            domainEffect(
              Effect.gen(function* () {
                const e = yield* workerFor(c, s);
                if (!e)
                  return yield* new CrewError(
                    "WORKER_REQUIRED",
                    "Assigned worker session required",
                  );
                return yield* a.action === "status"
                  ? c.queries.specStatus(e)
                  : a.action === "apply"
                    ? c.queries.specApply(e)
                    : c.queries.specInstructions(e, a.artifact!);
              }),
            ),
        }),
        define({
          name: "review_report",
          output: toolOutputs.review_report,
          description:
            "Record independent Review for current verified content. Full OpenSpec requires spec_verification with completeness/correctness/coherence evidence and unresolved conflicts. Conflicts require a scope decision, never automatic plan edits.",
          input: ReviewReportSchema,
          worker: true,
          run: (a, s) =>
            c.reviewReport(s, a.passed, a.findings, a.scope_status, a.spec_verification),
        }),
      ];
      yield* ctx.tool.transform((editor) => {
        editor.namespace({
          name: "abra",
          description: "Durable issue/OpenSpec/OpenCode orchestration",
        });
        const authorize = (
          access: ToolAccess,
          context: import("@opencode/schema/tool").Tool.Context,
        ) =>
          domainEffect(
            Effect.gen(function* () {
              const lead = yield* c.lead().principal(context.sessionID);
              if (lead || context.agent === "project-lead") {
                if (
                  !central ||
                  !access.lead ||
                  !lead ||
                  !lead.enabled ||
                  lead.stop_pending ||
                  lead.session_id !== context.sessionID ||
                  context.agent !== "project-lead"
                )
                  return yield* new CrewError(
                    "LEAD_FORBIDDEN",
                    "Project leads use only their scoped management endpoint",
                  );
                return;
              }
              if (access.lead)
                return yield* new CrewError("LEAD_REQUIRED", "Registered lead session required");
              if (access.worker) return;
              if (!central)
                return yield* new CrewError(
                  "SUPERVISOR_LOCATION",
                  "Management tools only run in central checkout",
                );
              if (yield* workerFor(c, context.sessionID))
                return yield* new CrewError(
                  "WORKER_FORBIDDEN",
                  "Workers cannot manage or approve executions",
                );
              if (context.agent !== "abra")
                return yield* new CrewError("ABRA_REQUIRED", "Talk to Abra to manage work");
              yield* c.guardAttention(context.sessionID, context.messageID, access.diagnostic);
              yield* c.recordSupervisor(context.sessionID);
            }),
          );
        for (const d of definitions.filter((d) => central || d.worker))
          d.register(editor, authorize, provide);
      });
    }),
  );
}
