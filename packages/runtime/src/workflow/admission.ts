import { WorkflowError } from "../errors.ts";
import { Context } from "effect";
import { Agents } from "@abracode/agents";
import { indexEffect } from "../work/inbox-index.ts";
import { removeOwnedField } from "../storage/store.ts";
import type { Records } from "../storage/store.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { Git } from "../git/repository.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { Reports } from "../reporting/reports.ts";
import type { Queries } from "./queries.ts";
import type { Coordination } from "./coordination.ts";
import type { Operations } from "./operations.ts";
import type { Capacity } from "./capacity.ts";
import type { ExecutionTransitions } from "./transitions.ts";
import type { WorkerSessions } from "./sessions.ts";
import type { Workspaces } from "../git/workspaces.ts";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { CrewError, type Config, type Execution } from "../domain.ts";
import {
  BranchName,
  ChangeName,
  ExecutionId,
  IssueId,
  OperationAction,
  SessionId,
} from "@abracode/contracts/identities";
import { WorkIntake, type WorkInput } from "../work/intake.ts";
import { BatchInputSchema, type BatchInput } from "../work/batch.ts";
import { decode } from "../decode.ts";
import { createConfiguredExecution } from "./execution.ts";
import { initialRole } from "./worker-assignment.ts";
interface Dependencies {
  readonly catalog: typeof Agents.Service;
  readonly config: Config;
  readonly records: Records;
  readonly work: WorkGraph;
  readonly spec: OpenSpec;
  readonly git: Git;
  readonly runtime: Runtime;
  readonly reports: Reports;
  readonly queries: Queries;
  readonly coordination: Coordination;
  readonly operations: Operations;
  readonly capacity: Capacity;
  readonly transitions: ExecutionTransitions;
  readonly sessions: WorkerSessions;
  readonly workspaces: Workspaces;
}

/** Owns validated intake, claim/capacity admission and resumable provisioning. */
export class WorkAdmission {
  private readonly intake: WorkIntake;
  constructor(private c: Dependencies) {
    this.intake = new WorkIntake(c.work, c.records, c.config.default_workflow, c.config);
  }
  private get = (id: IssueId) => this.c.queries.get(id);
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private launch = (...args: Parameters<Dependencies["sessions"]["launch"]>) =>
    this.c.sessions.launch(...args);
  private locked<A>(action: () => Effect.Effect<A, CrewError>) {
    return this.c.records.withActiveIndex(action);
  }
  private prepareReportReference = Effect.fn("WorkAdmission.prepareReportReference")(
    { self: this },
    function* (input: WorkInput) {
      if (input.report_reference) {
        const reference = input.report_reference;
        const research = yield* this.get(reference.issue_id);
        if (
          research.workflow_policy !== "research-only" ||
          research.current_phase !== "completed" ||
          research.report_receipt?.report_id !== reference.report_id ||
          research.report_receipt.hash !== reference.hash
        )
          return yield* new WorkflowError(
            "REPORT_REFERENCE",
            "Follow-on work requires the exact completed research report",
          );
        if ((input.workflow_policy ?? this.c.config.default_workflow) === "research-only")
          return yield* new WorkflowError(
            "REPORT_FOLLOW_ON",
            "Choose an implementation policy for a research follow-on",
          );
        yield* this.c.reports.verify(research);
        input = {
          ...input,
          dependencies: [...new Set([...(input.dependencies ?? []), research.issue_id])],
        };
      }
      return input;
    },
  );
  createWork = Effect.fn("WorkAdmission.createWork")(
    { self: this },
    function* (
      input: WorkInput,
      supervisor: SessionId,
      source?: import("../work/inbox-index.ts").SourceLink,
    ) {
      const request = yield* this.intake.prepareIntake(
        yield* this.prepareReportReference(input),
        supervisor,
      );
      const external = yield* this.c.queries.readinessContext();
      return yield* this.locked(() =>
        Effect.gen({ self: this }, function* () {
          yield* this.intake.validateProject(request);
          const issue = yield* this.c.work.create(request, source);
          const readiness = (yield* this.c.queries.readinessFor([issue.id], external)).get(
            issue.id,
          );
          return { issue, readiness };
        }),
      );
    },
  );
  createWorkBatch = Effect.fn("WorkAdmission.createWorkBatch")(
    { self: this },
    function* (input: BatchInput, supervisor: SessionId) {
      input = yield* decode(BatchInputSchema, input, "Work batch");
      const tasks: Array<BatchInput["tasks"][number]> = [];
      for (const task of input.tasks) {
        const { client_key, dependencies, ...fields } = task;
        const prepared = yield* this.prepareReportReference({
          ...fields,
          dependencies: (dependencies ?? []).flatMap((d) =>
            d.type === "existing" ? [d.issue_id] : [],
          ),
        });
        const { request_id: _id, dependencies: existing, ...definition } = prepared;
        tasks.push({
          ...definition,
          client_key,
          dependencies: [
            ...(dependencies ?? []).filter((d) => d.type === "local"),
            ...(existing ?? []).map((issue_id) => ({ type: "existing" as const, issue_id })),
          ],
        });
      }
      const external = yield* this.c.queries.readinessContext();
      return yield* this.locked(() =>
        Effect.gen({ self: this }, function* () {
          const result = yield* this.intake.createBatch({ ...input, tasks }, supervisor);
          const readiness = yield* this.c.queries.readinessFor(
            result.tasks.map((task) => task.issue.id),
            external,
          );
          return {
            ...result,
            tasks: result.tasks.map((task) => ({
              ...task,
              readiness: readiness.get(task.issue.id),
            })),
          };
        }),
      );
    },
  );
  start = Effect.fn("WorkAdmission.start")(
    { self: this },
    function* (id: IssueId, supervisor?: SessionId) {
      const existing = yield* this.c.records.execution(id);
      if (existing) return { action: "reconcile", execution: existing } as const;
      const external = yield* this.c.queries.readinessContext();
      let e = yield* this.c.records.withActiveIndex(() =>
        Effect.gen({ self: this }, function* () {
          const candidate = (yield* this.c.queries.readinessFor([id], external)).get(id);
          if (!candidate?.eligible)
            return yield* new WorkflowError(
              "NOT_READY",
              JSON.stringify(candidate?.blockers ?? ["Issue not found/open"]),
            );
          const project = yield* this.c.records.project(candidate.repository_id!);
          if (!project)
            return yield* new WorkflowError(
              "PROJECT_MISSING",
              "Repository is no longer registered",
            );
          let e = yield* createConfiguredExecution(
            project,
            {
              issue_id: id,
              repository_id: project.id,
              execution_id: ExecutionId.make(`abra-${randomUUID()}`),
              intent: {
                title: candidate.issue.title,
                description: candidate.issue.thought_source
                  ? candidate.issue.description +
                    "\n\nAccepted notebook excerpt (source material)\n" +
                    candidate.issue.thought_source.excerpt
                  : candidate.issue.description,
              },
              quality_profile: candidate.issue.quality_profile,
              openspec_schema: candidate.issue.openspec_schema,
              require_plan_approval: candidate.issue.require_plan_approval,
              dispatch: candidate.issue.dispatch,
              privateReview:
                candidate.issue.workflow_policy === "research-only" &&
                (yield* indexEffect(() => this.c.work.inbox.isPrivateReview(id))),
              workflow_policy: candidate.issue.workflow_policy,
              current_phase: "claiming",
              branch: BranchName.make(`work/${id}`),
              openspec_change: ChangeName.make(
                `abra-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
              ),
              supervisor_session_id: supervisor,
            },
            this.c.config,
          ).pipe(
            Effect.updateContext((caller: Context.Context<never>) =>
              Context.merge(Context.make(Agents, this.c.catalog), caller),
            ),
          );
          const reservation = yield* this.c.capacity.reserve(
            e,
            initialRole(e.workflow_policy),
            project,
            true,
          );
          e = reservation.execution;
          if (!reservation.admitted)
            return yield* new WorkflowError(
              "NOT_READY",
              "Native worker capacity changed before admission",
            );
          return e;
        }),
      );
      e = yield* this.c.operations.intent(e, OperationAction.make("start"));
      return yield* Effect.gen({ self: this }, function* () {
        yield* this.c.coordination.with(() => this.c.work.claim(id, e.execution_id));
        e = yield* this.c.transitions.move(e, "provisioning");
        return yield* this.provision(e);
      }).pipe(Effect.tapError((error) => this.c.transitions.fail(e, error, "recovery_required")));
    },
  );
  provision = Effect.fn("WorkAdmission.provision")({ self: this }, function* (e: Execution) {
    const p = yield* this.project(e);
    yield* this.c.git.validate(p);
    if (!p.project_id) {
      const discovered = yield* this.c.runtime.project(p.path);
      p.project_id = yield* this.c.records.coordinateCommit(() =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.c.records.project(p.id);
          if (!current || current.path !== p.path)
            return yield* new WorkflowError(
              "PROJECT_CHANGED",
              "Repository registration changed during provisioning",
            );
          if (current.project_id && current.project_id !== discovered)
            return yield* new WorkflowError(
              "PROJECT_CHANGED",
              "Native project identity changed during provisioning",
            );
          if (!current.project_id)
            yield* this.c.records.saveProject({ ...current, project_id: discovered });
          return discovered;
        }),
      );
    }
    e = yield* this.c.workspaces.provision(p, e, (candidate, fields) =>
      this.c.records.saveOwned(candidate, fields),
    );
    if (e.workflow_policy !== "full-openspec") {
      e = yield* this.c.transitions.move(e, "planning", {
        capacity_observed_idle: true,
        capacity_reservation: removeOwnedField,
      });
      return { action: "checkpoint", execution: e } as const;
    }
    if (!e.openspec_update_commit) {
      // Refresh before admitting any writer. Retain its commit separately from the fetched base
      // so Explore's change-only guard excludes controller-generated instruction updates.
      if (yield* this.c.git.dirty(e.worktree_directory!))
        return yield* new WorkflowError(
          "OPENSPEC_UPDATE_DIRTY",
          "OpenSpec update requires a clean owned worktree; inspect and preserve unfinished provisioning changes before retrying",
        );
      yield* this.c.spec.update(e);
      e = {
        ...e,
        openspec_update_commit: yield* this.c.git.commit(
          e.worktree_directory!,
          e.issue_id,
          `Refresh OpenSpec instructions for ${e.issue_id}`,
        ),
      };
      e = yield* this.c.records.saveOwned(e, ["openspec_update_commit"]);
    }
    if (e.openspec_schema_binding?.state === "pending") {
      e = { ...e, openspec_schema_binding: yield* this.c.spec.bind(e) };
      e = yield* this.c.records.saveOwned(e, ["openspec_schema_binding"]);
    }
    yield* this.c.spec.create(e);
    e = yield* this.c.transitions.move(e, "exploring");
    e = yield* this.launch(e, "explore");
    return e;
  });
}
