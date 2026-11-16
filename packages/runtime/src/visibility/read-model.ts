import { BindingReadQuery, selectBindingRows } from "@abracode/contracts/web/bindings";
import { executionBlocker } from "../workflow/readiness.ts";
import { executionContract } from "./execution-contract.ts";
import { type Config } from "../domain.ts";
import { historicalWorkers } from "../workflow/worker-assignment.ts";
import { deliveryOutcome } from "../workflow/delivery-outcome.ts";
import { actionable } from "../workflow/feedback-contracts.ts";
import { RelativePath, IssueId, Timestamp, timestamp } from "../identities.ts";

import { Clock, Effect, Schema } from "effect";
import { domainEffect } from "../effect.ts";
import {
  CrewError,
  identifier,
  type Execution,
  type Issue,
  type ReadinessBlocker,
} from "../domain.ts";

import { diagnosticText } from "../opencode/diagnostics.ts";
import { type Queries, type ReadBundle } from "../workflow/queries.ts";
import { type Controller } from "../workflow/controller.ts";
import { changeDocument } from "./documents.ts";
import { type DiffScope, type WorkDetail, type WorkItem, type WorkSnapshot } from "./protocol.ts";
import { fleetCounts, fleetRepositories } from "./fleet.ts";
import { taskAttention } from "./attention.ts";
import { supervisionSummary } from "./supervision.ts";
import { messageRequests, requiresResponse } from "../workflow/message-contracts.ts";
import { WorkDiscoveryQuery, type WorkDiscovery } from "./discovery-contracts.ts";
import { decode } from "../decode.ts";
function communication(e?: Execution): NonNullable<WorkItem["communication"]> {
  return {
    total: e?.messages?.length ?? 0,
    outstanding: messageRequests(e?.messages).filter(requiresResponse).length,
  };
}
function sessions(e?: Execution): WorkItem["sessions"] {
  const current = (["explore", "apply", "review", "research"] as const).flatMap((role) => {
    const id = e?.[`${role}_session_id`];
    return id ? [{ id, role }] : [];
  });
  return [
    ...new Map([...(e ? historicalWorkers(e) : []), ...current].map((s) => [s.id, s])).values(),
  ];
}
function supervision(mode: Config["supervision_mode"], e?: Execution) {
  return {
    execution_contract: e ? executionContract(e, mode) : undefined,
    generation: e?.control_generation,
    delivered_head: e?.delivered_commit,
    implementation_head: e?.implementation_head,
    external_summary: e?.external_validation
      ? {
          custody: e.external_validation.custody,
          status: e.external_validation.status,
          run: e.external_validation.launch?.run_id,
          gate: e.external_validation.observation?.gate?.step,
          runs: (e.external_history?.length ?? 0) + 1,
          observed_at: e.external_validation.observed_at,
        }
      : undefined,
    feedback_summary: e?.feedback
      ? {
          complete: e.feedback.complete,
          observed_at: e.feedback.observed_at,
          next_check_at: e.feedback.next_check_at,
          finding_count: e.feedback.findings.length,
          unhandled_count: e.feedback.findings.filter((f) => actionable(f, e.feedback!.head))
            .length,
          action_count: e.feedback.actions.length,
          uncertain_count: e.feedback.actions.filter((a) =>
            ["running", "uncertain"].includes(a.status),
          ).length,
          unsubmitted_count: e.feedback.actions.filter(
            (a) =>
              a.schema_version === 2 &&
              a.submission.stage === "unsubmitted" &&
              a.status === "prepared",
          ).length,
          reruns: e.feedback.actions.filter((a) => a.kind === "rerun").length,
          error: e.feedback.error,
        }
      : undefined,
    scope_history: e?.scope_history?.slice(-20).map((s) => ({
      revision: s.revision,
      goal: diagnosticText(s.contract.goal, 512),
      fingerprint: s.fingerprint,
    })),
    operation: e?.operation,
    delivery_wait: e?.delivery_wait,
    capacity_wait: e?.capacity_wait,
    command_wait: e?.command_wait
      ? {
          command: diagnosticText(e.command_wait.command, 512),
          deadline_at: e.command_wait.deadline_at,
        }
      : undefined,
    attention: e?.attention?.slice(-20),
    attention_turns: e?.attention_turns,
    decisions: e?.decisions?.filter((d) => d.status === "open").slice(0, 20),
    decision_count: e?.decisions?.length,
    waits: e?.waits?.filter((w) => !["cleared", "superseded"].includes(w.status)).slice(0, 20),
    wait_count: e?.waits?.length,
    progress: e?.progress
      ? { ...e.progress, summary: diagnosticText(e.progress.summary, 1500) }
      : undefined,
    policy_summary: e?.effective_policy
      ? {
          quality: e.effective_policy.quality,
          publication: e.effective_policy.publication,
          reviewers: e.effective_policy.reviewers,
          discussion: e.effective_policy.discussion,
          ci_retry: e.effective_policy.ci_retry,
          validation: e.effective_policy.validation,
          plan_approval: e.effective_policy.plan_approval,
          merge_approval: e.effective_policy.merge_approval,
          merge_method: e.effective_policy.merge_method,
          ci_policy: e.effective_policy.ci_policy,
          repair_rounds: e.effective_policy.repair_rounds,
          diagnostic_turns: e.effective_policy.diagnostic_turns,
        }
      : undefined,
    rounds: e?.rounds?.slice(-20).map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      source: r.source,
      starting_head: r.starting_head,
      archive_path: r.archive_path,
      instructions: diagnosticText(r.instructions, 512),
      finding_count: r.findings.length,
    })),
    report_available: !!e?.report_receipt,
  };
}

/** Shared captured fields; admission readiness is supplied only by its owning query. */
function retainedWork(
  mode: Config["supervision_mode"],
  issue: Issue,
  execution?: Execution,
  readiness: Pick<
    WorkItem,
    "eligible" | "blockers" | "blocker_details" | "eligibility_observed"
  > = { eligible: false, blockers: [], blocker_details: [] },
  closedAt?: Timestamp,
): WorkItem {
  return {
    issue_id: issue.id,
    title: issue.title,
    repository_id: issue.repository_id,
    priority: issue.priority,
    issue_status: issue.status,
    policy: issue.workflow_policy,
    scope: execution?.scope,
    report: execution?.report_receipt,
    ...supervision(mode, execution),
    phase: execution?.current_phase,
    active_role: issue.status === "closed" ? undefined : execution?.active_role,
    supervisor_session_id: execution?.supervisor_session_id,
    blocker_details: (readiness.blocker_details ?? []).map((b) => ({
      ...b,
      message: diagnosticText(b.message),
    })),
    sessions: sessions(execution),
    eligible: readiness.eligible,
    blockers: readiness.blockers.map((text) => diagnosticText(text)),
    error:
      issue.status !== "closed" && execution?.error_or_recovery_reason
        ? diagnosticText(execution.error_or_recovery_reason)
        : undefined,
    eligibility_observed: readiness.eligibility_observed,
    closed_at: closedAt,
  };
}
function bindRetainedWork(
  item: WorkItem,
  execution: Execution | undefined,
  issue: Issue | undefined,
  at: number,
): WorkItem {
  return {
    ...item,
    outcome: execution ? deliveryOutcome(execution, issue?.status, at) : undefined,
    dependencies: issue?.dependencies.slice(0, 256),
    dependency_count: issue?.dependencies.length,
    communication: communication(execution),
  };
}

/** Read-only projection. Lifecycle actions remain exclusively in the controller tools. */
export class Visibility {
  private c: Queries;
  constructor(controller: Pick<Controller, "queries">) {
    this.c = controller.queries;
  }
  feedback = (issue: IssueId, page = 0) => this.c.feedback(issue, page);
  find = (input: WorkDiscovery = {}) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const query = yield* decode(WorkDiscoveryQuery, input, "Work discovery");
        const bundle = yield* this.c.observe(query);
        const page = bundle.page!;
        const ids = page.entries.map((issue) => issue.id);
        const snapshot = yield* this.snapshot(undefined, bundle, ids, { leads: false });
        const byID = new Map(snapshot.work.map((work) => [work.issue_id, work]));
        return {
          entries: ids.flatMap((id) => {
            const work = byID.get(id);
            return work ? [work] : [];
          }),
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          next_offset: page.next_offset,
          fleet: snapshot.fleet,
          observed_at: snapshot.at,
        };
      }),
    );
  binding = (input: typeof BindingReadQuery.Type) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const query = yield* decode(BindingReadQuery, input, "Work binding read");
        const explicit = [...new Set(query.issue_ids)];
        const population = query.include_population ? yield* this.c.bindingPopulation() : undefined;
        const requested = [...new Set([...explicit, ...(population?.ids ?? [])])].slice(0, 100);
        const results = yield* Effect.forEach(
          requested,
          (id) =>
            this.c.observeTask(id).pipe(
              Effect.map((task) => ({
                issue_id: id,
                status: task.execution_unavailable
                  ? ("unavailable" as const)
                  : ("available" as const),
                task,
              })),
              Effect.catch((error) =>
                Effect.succeed({
                  issue_id: id,
                  status:
                    error.code === "ISSUE_MISSING"
                      ? ("missing" as const)
                      : ("unavailable" as const),
                  task: undefined,
                }),
              ),
            ),
          { concurrency: 4 },
        );
        const work = results.flatMap(({ task }) =>
          task
            ? [
                bindRetainedWork(
                  retainedWork(
                    this.c.settings.supervisionMode,
                    task.issue,
                    task.execution,
                    undefined,
                    task.closed_at,
                  ),
                  task.execution,
                  task.issue,
                  Date.parse(task.source.captured_at),
                ),
              ]
            : [],
        );
        const selected = selectBindingRows(
          { ids: explicit, unfiltered: !!query.include_population },
          work,
          population?.total,
        );
        const unavailable = results.some((entry) => entry.status !== "available");
        return {
          work: selected.rows,
          coverage: {
            ...selected.coverage,
            unavailable_ids: [
              ...new Set([
                ...selected.coverage.unavailable_ids,
                ...results
                  .filter(
                    (entry) => explicit.includes(entry.issue_id) && entry.status !== "available",
                  )
                  .map((entry) => entry.issue_id),
              ]),
            ],
            status: unavailable ? ("unavailable" as const) : selected.coverage.status,
          },
          results: results
            .filter((entry) => explicit.includes(entry.issue_id))
            .map(({ issue_id, status }) => ({ issue_id, status })),
          observed_at: yield* timestamp,
          ...(population ? { work_revision: population.work_revision } : {}),
        };
      }),
    );
  snapshot: (
    closedPage?: number,
    bundle?: ReadBundle,
    selected?: readonly IssueId[],
    options?: { leads?: boolean },
  ) => Effect.Effect<WorkSnapshot, CrewError> = Effect.fn("Visibility.snapshot")(
    function* (
      this: Visibility,
      closedPage?: number,
      bundle?: ReadBundle,
      selected?: readonly IssueId[],
      options?: { leads?: boolean },
    ) {
      const observation = bundle ?? (yield* this.c.observe());
      const { executions, issues, diagnostics } = observation;
      const ready = yield* this.c.ready(observation);
      const work: WorkItem[] = ready.map((r) =>
        retainedWork(
          this.c.settings.supervisionMode,
          r.issue,
          r.execution ?? executions.find((e) => e.issue_id === r.issue.id),
          r,
        ),
      );
      const executionsByID = new Map(executions.map((e) => [e.issue_id, e]));
      const conflicts = issues.filter(
        (i) =>
          i.status === "closed" &&
          executionsByID.has(i.id) &&
          executionsByID.get(i.id)!.current_phase !== "completed",
      );
      const conflictIDs = new Set(conflicts.map((i) => i.id));
      const closed = issues
        .filter((i) => i.status === "closed" && !conflictIDs.has(i.id))
        .sort((a, b) => {
          const date = (id: IssueId) => executionsByID.get(id)?.updated_at ?? "";
          return date(b.id).localeCompare(date(a.id)) || a.id.localeCompare(b.id);
        });
      const page = Math.max(
        0,
        Math.min(Math.floor(closedPage ?? 0), Math.max(0, Math.ceil(closed.length / 50) - 1)),
      );
      const selectedClosed = selected
        ? closed.filter((issue) => selected.includes(issue.id))
        : closed.slice(page * 50, (page + 1) * 50);
      for (const issue of [...conflicts, ...selectedClosed]) {
        const e = executions.find((e) => e.issue_id === issue.id);
        work.push(
          retainedWork(
            this.c.settings.supervisionMode,
            issue,
            e,
            undefined,
            observation.closures[issue.id],
          ),
        );
      }
      for (const e of executions.filter(
        (e) => e.current_phase !== "completed" && !work.some((w) => w.issue_id === e.issue_id),
      ))
        work.push({
          issue_id: e.issue_id,
          title: e.issue_id,
          repository_id: e.repository_id,
          priority: 4,
          issue_status: "unavailable",
          ...supervision(this.c.settings.supervisionMode, e),
          policy: e.workflow_policy,
          scope: e.scope,
          report: e.report_receipt,
          phase: e.current_phase,
          active_role: e.active_role,
          sessions: sessions(e),
          supervisor_session_id: e.supervisor_session_id,
          eligible: false,
          blockers: ["Active execution has no open WorkGraph issue; inspect recovery"],
        });
      for (const diagnostic of diagnostics.filter((d) => d.key.startsWith("execution/"))) {
        const id = diagnostic.key.slice("execution/".length);
        if (!Schema.is(IssueId)(id)) continue;
        const item = work.find((w) => w.issue_id === id);
        if (item) {
          Object.assign(item, {
            phase: "recovery_required",
            error: diagnostic.message,
            eligible: false,
            blockers: [...item.blockers, diagnostic.message],
          });
        } else
          work.push({
            issue_id: id,
            title: id,
            priority: 4,
            issue_status: "unavailable",
            phase: "recovery_required",
            sessions: [],
            eligible: false,
            blockers: [diagnostic.message],
            error: diagnostic.message,
          });
      }
      const aggregate = yield* this.c.supervisionAggregate(observation, ready);
      const leads = options?.leads === false ? undefined : yield* this.c.leadOverview(observation);
      const observedAt = yield* Clock.currentTimeMillis;
      for (const item of work) {
        const execution = executions.find((e) => e.issue_id === item.issue_id);
        const issue = issues.find((i) => i.id === item.issue_id);
        Object.assign(item, bindRetainedWork(item, execution, issue, observedAt), {
          supervision:
            aggregate.tasks.find((task) => task.issue_id === item.issue_id) ??
            supervisionSummary({
              execution,
              blockers: item.blocker_details ?? [],
              closed: issue?.status === "closed",
              observed_at: Timestamp.make(new Date(observedAt).toISOString()),
            }),
        });
      }
      const day = observation.day;
      const completedToday = observation.completions.filter(
        (row) => !conflictIDs.has(row.issue_id),
      ).length;
      // History pagination controls rows, never fleet totals. Closed rows outside
      // the page need no session, OpenSpec or per-ticket history inspection.
      const loaded = new Set(work.map((w) => w.issue_id));
      const fleetWork: WorkItem[] = [
        ...work,
        ...closed
          .filter((i) => !loaded.has(i.id))
          .map((i) => ({
            issue_id: i.id,
            title: i.title,
            repository_id: i.repository_id,
            priority: i.priority,
            issue_status: i.status,
            ...supervision(this.c.settings.supervisionMode, executionsByID.get(i.id)),
            communication: communication(executionsByID.get(i.id)),
            sessions: [],
            eligible: false,
            blockers: [],
          })),
      ];
      const nativeTasks = executions.filter(
        (e) => e.active_role && e[`${e.active_role}_session_id`] && e.current_phase !== "completed",
      );
      const attention = fleetWork.flatMap((work) => {
        const execution = executionsByID.get(work.issue_id);
        return taskAttention(
          execution
            ? {
                ...work,
                phase: execution.current_phase,
                decisions: execution.decisions,
                waits: execution.waits,
                attention: execution.attention,
                outcome: deliveryOutcome(
                  execution,
                  work.issue_status === "unavailable" ? undefined : work.issue_status,
                  observedAt,
                ),
              }
            : work,
        );
      });
      const fleet = {
        ...day,
        counts: fleetCounts(fleetWork),
        total: fleetWork.length,
        native_total: nativeTasks.length,
        native_observed: nativeTasks.filter((e) =>
          aggregate.tasks.some(
            (t) =>
              t.issue_id === e.issue_id &&
              !["unobserved", "unavailable", "unknown"].includes(t.native_activity),
          ),
        ).length,
        completed_today: completedToday,
        repositories: fleetRepositories(fleetWork),
        attention: attention.slice(0, 100),
        attention_total: attention.length,
        attention_truncated: attention.length > 100,
      };
      work.sort(
        (a, b) =>
          Number(!a.phase) - Number(!b.phase) ||
          a.priority - b.priority ||
          a.issue_id.localeCompare(b.issue_id),
      );
      return {
        fleet,
        leads: leads?.leads,
        management: leads?.attention,
        lead_diagnostics: leads?.diagnostics,
        supervision: aggregate,
        home: this.c.settings.home,
        record_diagnostics: diagnostics,
        work,
        closed_total: closed.length,
        closed_page: page,
        at: yield* timestamp,
        work_revision: observation.source.work_revision,
      };
    }.bind(this),
    domainEffect,
  );
  report = (issueID: IssueId) =>
    this.c.report(issueID).pipe(Effect.map((content) => ({ content })));
  diff = (issueID: IssueId, scope: DiffScope, file?: RelativePath) =>
    this.c.diff(issueID, scope, file);
  document = (issueID: IssueId, path: RelativePath) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const e = yield* this.c.get(issueID);
        return { path, content: yield* this.c.planDocument(e, path) };
      }),
    );
  detail: (issueID: IssueId) => Effect.Effect<WorkDetail, CrewError> = Effect.fn(
    "Visibility.detail",
  )(
    function* (this: Visibility, issueID: IssueId) {
      identifier(issueID);
      const task = yield* this.c.observeTask(issueID);
      const { issue, execution: e } = task;
      const blocker_details: ReadinessBlocker[] = [];
      const block = (code: ReadinessBlocker["code"], message: string) =>
        blocker_details.push({ code, message: diagnosticText(message) });
      const dependencies = task.dependencies.filter((dependency) => dependency.status !== "closed");
      if (dependencies.length)
        block(
          "dependency",
          `Dependency blockers: ${dependencies.map((d) => `${d.id} (${d.title ?? "Title unavailable"}, ${d.status})`).join(", ")}`,
        );
      else if (issue.status !== "closed" && (issue.status !== "open" || issue.assignee))
        block("status", `Issue status/dependencies prevent readiness (${issue.status})`);
      if (e && issue.status !== "closed") {
        block("execution", executionBlocker(e));
        for (const reason of e.capacity_wait?.reasons ?? []) block("capacity", reason);
      }
      if (task.execution_unavailable) block("execution", task.execution_unavailable);
      const work: WorkItem = {
        ...bindRetainedWork(
          retainedWork(
            this.c.settings.supervisionMode,
            issue,
            e,
            {
              eligible: false,
              eligibility_observed: issue.status === "closed" ? undefined : false,
              blockers: blocker_details.map((blocker) => blocker.message),
              blocker_details,
            },
            task.closed_at,
          ),
          e,
          issue,
          yield* Clock.currentTimeMillis,
        ),
        supervision: task.execution_unavailable
          ? {
              primary: "recovery_required",
              native_activity: "unavailable",
              observed_at: task.source.captured_at,
            }
          : yield* this.c.supervision(e, blocker_details, issue.status === "closed"),
        ...(task.execution_unavailable
          ? { phase: "recovery_required" as const, error: task.execution_unavailable }
          : {}),
      };
      const result: {
        -readonly [K in keyof WorkDetail]: WorkDetail[K];
      } & {
        errors: string[];
      } = {
        work,
        description: issue.description ?? "",
        change: e?.openspec_change,
        archive: e?.archive_path,
        artifacts: [],
        errors: task.execution_unavailable ? [task.execution_unavailable] : [],
      };
      if (e && e.workflow_policy !== "full-openspec") {
        result.change = undefined;
        result.proposal = e.scope
          ? `# ${e.workflow_policy === "research-only" ? "Research contract" : "Lightweight scope"}\n\n${e.scope.contract.goal}\n\n## Acceptance\n${e.scope.contract.acceptance.map((s) => `- ${s}`).join("\n")}\n\n## Constraints\n${e.scope.contract.constraints.map((s) => `- ${s}`).join("\n")}`
          : "Scope clarification required. Inspect the retained decision or revise with abra_work_scope.";
        return result;
      }
      if (!e) return result;
      if (e.archive_path || e.current_phase === "completed") {
        const archive = yield* this.c.planDocuments(e).pipe(Effect.result);
        if (archive._tag === "Failure") result.errors.push(diagnosticText(archive.failure.message));
        else {
          result.documents = archive.success.paths;
          result.planning = archive.success.observation;
        }
        return result;
      }
      if (!e.worktree_directory) return result;
      yield* domainEffect(
        Effect.gen({ self: this }, function* () {
          const status = yield* this.c.specStatus(e);
          result.artifacts = status.artifacts.map((a) => ({
            id: a.id,
            status: a.status,
            path: a.outputPath,
          }));
          const artifact = status.artifacts.find((a) => a.id === "proposal" && a.status === "done");
          if (artifact)
            result.proposal = yield* changeDocument(e, artifact.outputPath, "Proposal").pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  result.errors.push(diagnosticText(error.message));
                  return undefined;
                }),
              ),
            );
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            result.errors.push(diagnosticText(error.message));
          }),
        ),
      );
      yield* domainEffect(
        Effect.gen({ self: this }, function* () {
          const apply = yield* this.c.specApply(e);
          if (apply.taskTrackingConfigured) result.progress = apply.progress;
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            result.errors.push(diagnosticText(error.message));
          }),
        ),
      );
      const documents = yield* this.c.planDocuments(e).pipe(Effect.result);
      if (documents._tag === "Failure")
        result.errors.push(diagnosticText(documents.failure.message));
      else {
        result.documents = documents.success.paths;
        result.planning = documents.success.observation;
      }
      return result;
    }.bind(this),
    domainEffect,
  );
}
