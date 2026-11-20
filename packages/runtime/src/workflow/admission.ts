import { removeOwnedField } from "../storage/store.ts";
import type { Records } from "../storage/store.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { Git } from "../git/repository.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { Reports } from "./reports.ts";
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
import { domainEffect } from "../effect.ts";
import {
  BranchName,
  ChangeName,
  ExecutionId,
  IssueId,
  OperationAction,
  SessionId,
} from "../identities.ts";
import { WorkIntake, type WorkInput } from "../work/intake.ts";
import { BatchInputSchema, type BatchInput } from "../work/batch.ts";
import { decode } from "../decode.ts";
import { createExecution } from "./execution.ts";
import { initialRole } from "./roles.ts";
interface Dependencies {
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
  constructor(private c: Dependencies) {}
  private get = (id: IssueId) => this.c.queries.get(id);
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private launch = (...args: Parameters<Dependencies["sessions"]["launch"]>) =>
    this.c.sessions.launch(...args);
  private locked<A>(action: () => Effect.Effect<A, CrewError>) {
    return this.c.coordination.with(action);
  }
  private prepareIntake = Effect.fn("WorkAdmission.prepareIntake")(
    function* (this: WorkAdmission, input: WorkInput) {
      if (input.report_reference) {
        const reference = input.report_reference;
        const research = yield* this.get(reference.issue_id);
        if (
          !(
            research.workflow_policy === "research-only" &&
            research.current_phase === "completed" &&
            research.report_receipt?.report_id === reference.report_id &&
            research.report_receipt.hash === reference.hash
          )
        )
          return yield* new CrewError(
            "REPORT_REFERENCE",
            "Follow-on work requires the exact completed research report",
          );
        if (!((input.workflow_policy ?? this.c.config.default_workflow) !== "research-only"))
          return yield* new CrewError(
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
    }.bind(this),
    domainEffect,
  );
  createWork = Effect.fn("WorkAdmission.createWork")(
    function* (
      this: WorkAdmission,
      input: WorkInput,
      supervisor: SessionId,
      source?: import("../work/inbox-index.ts").SourceLink,
    ) {
      input = yield* this.prepareIntake(input);
      return yield* this.locked(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const issue = yield* new WorkIntake(
              this.c.work,
              this.c.records,
              this.c.config.default_workflow,
              this.c.config,
            ).create(input, supervisor, source);
            const readiness = (yield* this.c.queries.readinessFor([issue.id])).get(issue.id);
            return { issue, readiness };
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  createWorkBatch = Effect.fn("WorkAdmission.createWorkBatch")(
    function* (this: WorkAdmission, input: BatchInput, supervisor: SessionId) {
      input = yield* decode(BatchInputSchema, input, "Work batch");
      const tasks: Array<BatchInput["tasks"][number]> = [];
      for (const task of input.tasks) {
        const { client_key, dependencies, ...fields } = task;
        const prepared = yield* this.prepareIntake({
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
      return yield* this.locked(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const result = yield* new WorkIntake(
              this.c.work,
              this.c.records,
              this.c.config.default_workflow,
              this.c.config,
            ).createBatch({ ...input, tasks }, supervisor);
            const readiness = yield* this.c.queries.readinessFor(
              result.tasks.map((task) => task.issue.id),
            );
            return {
              ...result,
              tasks: result.tasks.map((task) => ({
                ...task,
                readiness: readiness.get(task.issue.id),
              })),
            };
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  start = Effect.fn("WorkAdmission.start")(
    function* (this: WorkAdmission, id: IssueId, supervisor?: SessionId) {
      const existing = yield* this.c.records.execution(id);
      if (existing) return { action: "reconcile", execution: existing } as const;
      const e = yield* this.c.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const candidate = (yield* this.c.queries.readinessFor([id])).get(id);
            if (!candidate?.eligible)
              return yield* new CrewError(
                "NOT_READY",
                JSON.stringify(candidate?.blockers ?? ["Issue not found/open"]),
              );
            const project = yield* this.c.records.project(candidate.repository_id!);
            if (!project)
              return yield* new CrewError("PROJECT_MISSING", "Repository is no longer registered");
            const e = yield* createExecution(
              project,
              {
                issue_id: id,
                repository_id: project.id,
                execution_id: ExecutionId.make(`abra-${randomUUID()}`),
                intent: {
                  title: candidate.issue.title,
                  description: candidate.issue.description,
                },
                quality_profile: candidate.issue.quality_profile,
                openspec_schema: candidate.issue.openspec_schema,
                require_plan_approval: candidate.issue.require_plan_approval,
                dispatch: candidate.issue.dispatch,
                workflow_policy: candidate.issue.workflow_policy,
                current_phase: "claiming",
                branch: BranchName.make(`work/${id}`),
                openspec_change: ChangeName.make(
                  `abra-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
                ),
                supervisor_session_id: supervisor,
              },
              this.c.config,
            );
            if (!(yield* this.c.capacity.reserve(e, initialRole(e.workflow_policy), project, true)))
              return yield* new CrewError(
                "NOT_READY",
                "Native worker capacity changed before admission",
              );
            return e;
          }),
        ),
      );
      yield* this.c.operations.intent(e, OperationAction.make("start"));
      return yield* domainEffect(
        Effect.gen({ self: this }, function* () {
          yield* this.c.coordination.with(() => this.c.work.claim(id, e.execution_id));
          yield* this.c.transitions.move(e, "provisioning");
          return yield* this.provision(e);
        }),
      ).pipe(Effect.tapError((error) => this.c.transitions.fail(e, error, "recovery_required")));
    }.bind(this),
    domainEffect,
  );
  provision = Effect.fn("WorkAdmission.provision")(
    function* (this: WorkAdmission, e: Execution) {
      const p = yield* this.project(e);
      yield* this.c.git.validate(p);
      if (!p.project_id) {
        p.project_id = yield* this.c.runtime.project(p.path);
        yield* this.c.records.saveProject(p);
      }
      yield* this.c.workspaces.provision(p, e, (fields) => this.c.records.saveOwned(e, fields));
      if (e.workflow_policy !== "full-openspec") {
        yield* this.c.transitions.move(e, "planning", {
          capacity_observed_idle: true,
          capacity_reservation: removeOwnedField,
        });
        return { action: "checkpoint", execution: e } as const;
      }
      if (!e.openspec_update_commit) {
        // Refresh before admitting any writer. Retain its commit separately from the fetched base
        // so Explore's change-only guard excludes controller-generated instruction updates.
        if (yield* this.c.git.dirty(e.worktree_directory!))
          return yield* new CrewError(
            "OPENSPEC_UPDATE_DIRTY",
            "OpenSpec update requires a clean owned worktree; inspect and preserve unfinished provisioning changes before retrying",
          );
        yield* this.c.spec.update(e);
        e.openspec_update_commit = yield* this.c.git.commit(
          e.worktree_directory!,
          e.issue_id,
          `Refresh OpenSpec instructions for ${e.issue_id}`,
        );
        yield* this.c.records.saveOwned(e, ["openspec_update_commit"]);
      }
      if (e.openspec_schema_binding?.state === "pending") {
        e.openspec_schema_binding = yield* this.c.spec.bind(e);
        yield* this.c.records.saveOwned(e, ["openspec_schema_binding"]);
      }
      yield* this.c.spec.create(e);
      yield* this.c.transitions.move(e, "exploring");
      yield* this.launch(e, "explore");
      return e;
    }.bind(this),
    domainEffect,
  );
}
