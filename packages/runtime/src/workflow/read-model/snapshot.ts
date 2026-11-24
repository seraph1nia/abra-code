import { Clock, Effect, Ref, Schedule } from "effect";
import {
  type IssueId,
  type RepositoryId,
  type SessionId,
  timestamp,
} from "@abracode/contracts/identities";
import type { WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
import { loadConfig } from "../../config/load.ts";
import { declarationDigest } from "../../config/declarations.ts";
import {
  CrewError,
  type Config,
  type Execution,
  type Issue,
  type Project,
  type ReadinessBlocker,
  type SetupExecution,
} from "../../domain.ts";
import { domainEffect } from "../../effect.ts";
import { diagnosticText } from "../../opencode/diagnostics.ts";
import { type Records } from "../../storage/store.ts";
import { localDay } from "../../visibility/fleet.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { explainIssues } from "../../work/model.ts";
import { scanCapacity, summarizeCapacity, type CapacitySummary } from "../capacity.ts";
import { executionBlocker, retainedReadiness } from "../readiness.ts";

export { executionBlocker, retainedReadiness };

export type ExternalReadinessContext = {
  declarations: { digests: Map<RepositoryId, string>; error?: string };
  authority?: ReadinessBlocker;
};

export type CaptureFn = <A>(
  read: (revision: string) => Effect.Effect<A, CrewError>,
) => Effect.Effect<A, CrewError>;

export type SnapshotDeps = {
  config: Config;
  records: Records;
  work: WorkGraph;
  automaticAuthority: () => Effect.Effect<
    { session_id?: SessionId; blocker?: ReadinessBlocker },
    CrewError
  >;
};

type SetupOverview = ReturnType<typeof setupOverview>;

type FinderCapacity = {
  stamp: number;
  revision: string | undefined;
  capacity: CapacitySummary;
  setupOverview: SetupOverview;
  recordsUnavailable: boolean;
  authority?: ReadinessBlocker;
};

type FinderCacheState = {
  stamp: number;
  capacity?: FinderCapacity;
};

function setupOverview(projects: readonly Project[], setups: readonly SetupExecution[]) {
  const byRepo = new Map(setups.map((setup) => [setup.repository_id, setup]));
  const pending = projects.flatMap<{
    repository_id: RepositoryId;
    phase: SetupExecution["current_phase"] | "unrequested";
  }>((project) => {
    const phase = byRepo.get(project.id)?.current_phase;
    if (phase && phase !== "completed") return [{ repository_id: project.id, phase }];
    return project.openspec ? [] : [{ repository_id: project.id, phase: "unrequested" as const }];
  });
  return { setup_count: pending.length, setups: pending.slice(0, 10) };
}

/** Shared single-task readiness blockers for overview projections without fleet scans. */
export function retainedOverviewBlockers(task: {
  issue: Issue;
  dependencies: readonly {
    id: Issue["id"];
    title?: string;
    status: Issue["status"] | "unavailable";
  }[];
  execution?: Execution;
  execution_unavailable?: string;
}): ReadinessBlocker[] {
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
  return blocker_details;
}

export class SnapshotQueries {
  private readonly finderCache = Ref.makeUnsafe<FinderCacheState>({ stamp: 0 });

  constructor(private readonly deps: SnapshotDeps) {}

  /** Capture retained state only; native/session and filesystem projections run afterward.
   * The global record lock plus graph revision validation covers intake commits
   * that intentionally occur outside that lock. Three nonblocking attempts and
   * a 500 ms attempt deadline bound contention and slow storage observations.
   */
  capture = <A>(read: (revision: string) => Effect.Effect<A, CrewError>) =>
    this.deps.records
      .coordinateRead(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const revision = yield* this.deps.work.revision;
            const value = yield* read(revision);
            if (revision !== (yield* this.deps.work.revision))
              return yield* new CrewError(
                "OBSERVATION_CHANGED",
                "Work graph changed during retained-state capture",
              );
            return value;
          }),
        ),
      )
      .pipe(
        Effect.timeoutOrElse({
          duration: "500 millis",
          orElse: () =>
            Effect.fail(
              new CrewError("OBSERVATION_TIMEOUT", "Retained-state capture exceeded its deadline"),
            ),
        }),
        Effect.retry({
          times: 2,
          schedule: Schedule.exponential("50 millis"),
          while: (error) =>
            ["LOCKED", "OBSERVATION_CHANGED", "OBSERVATION_TIMEOUT"].includes(error.code),
        }),
        Effect.mapError((error) =>
          ["LOCKED", "OBSERVATION_CHANGED", "OBSERVATION_TIMEOUT"].includes(error.code)
            ? new CrewError(
                "OBSERVATION_UNAVAILABLE",
                `Coherent retained state is temporarily unavailable: ${error.message}`,
              )
            : error,
        ),
        domainEffect,
      );

  observe = (query?: WorkDiscovery, includeRecords = false) =>
    this.capture((revision) =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const day = localDay(yield* Clock.currentTimeMillis);
          const scans = yield* Effect.all(
            {
              issues: this.deps.work.list,
              page: query ? this.deps.work.find(query) : Effect.undefined,
              closures: this.deps.work.closureTimes,
              completions: this.deps.work.completions(day.day_start, day.day_end),
              projects: this.deps.records.projectScan(),
              executions: this.deps.records.executionScan(),
              setups: this.deps.records.setupScan(),
              recordsRevision: this.deps.records.observationRevision,
              exported: includeRecords ? this.deps.records.export() : Effect.undefined,
            },
            { concurrency: "unbounded" },
          );
          return {
            issues: scans.issues,
            exported: scans.exported,
            page: scans.page,
            closures: scans.closures,
            completions: scans.completions,
            day,
            explanation: explainIssues(scans.issues),
            projects: scans.projects.values,
            executions: scans.executions.values,
            setups: scans.setups.values,
            recordsRevision: scans.recordsRevision,
            diagnostics: [
              ...scans.projects.diagnostics,
              ...scans.executions.diagnostics,
              ...scans.setups.diagnostics,
            ],
            source: {
              work_revision: revision,
              captured_at: yield* timestamp,
              executions: scans.executions.values.map((e) => ({
                issue_id: e.issue_id,
                execution_id: e.execution_id,
                revision: e.revision,
              })),
              projects: scans.projects.values.map((p) => ({
                repository_id: p.id,
                revision: p.revision,
              })),
              setups: scans.setups.values.map((e) => ({
                repository_id: e.repository_id,
                execution_id: e.execution_id,
                revision: e.revision,
              })),
            },
          };
        }),
      ),
    );

  private slotUsage(cached: FinderCapacity, project?: Project) {
    const { capacity } = cached;
    const limits = project ?? this.deps.config;
    return {
      workers: project
        ? (capacity.activeByRepository.get(project.id)?.size ?? 0)
        : capacity.active.size,
      worker_limit: limits.max_workers,
      retained: project
        ? (capacity.retainedByRepository.get(project.id)?.size ?? 0)
        : capacity.retained.size,
      retained_limit: limits.max_executions,
    };
  }

  /** Use the existing capacity observation only while its record revision still matches. */
  bindingPopulation = () =>
    this.capture((work_revision) =>
      Effect.gen({ self: this }, function* () {
        const first = yield* this.deps.work.find({ state: "all", offset: 0, limit: 50 });
        const second =
          first.total > 50
            ? yield* this.deps.work.find({ state: "all", offset: 50, limit: 50 })
            : undefined;
        const cached = (yield* Ref.get(this.finderCache)).capacity;
        const capacity =
          cached &&
          !cached.recordsUnavailable &&
          cached.revision === (yield* this.deps.records.observationRevision)
            ? {
                ...this.slotUsage(cached),
                auto_schedule: this.deps.config.auto_schedule,
                ...cached.setupOverview,
              }
            : undefined;
        return {
          capacity,
          ids: [...first.entries, ...(second?.entries ?? [])].map((issue) => issue.id),
          total: first.total,
          work_revision,
        };
      }),
    );

  /** One issue and its retained execution; no finder, fleet, lead or admission reads. */
  observeTask = (id: IssueId, includeHistory = false) =>
    this.capture((revision) =>
      Effect.gen({ self: this }, function* () {
        const graph = yield* this.deps.work.task(id);
        const history = includeHistory ? yield* this.deps.work.history(id) : undefined;
        const result = yield* this.deps.records.execution(id).pipe(Effect.result);
        const execution = result._tag === "Success" ? result.success : undefined;
        return {
          ...graph,
          history,
          execution,
          execution_unavailable:
            result._tag === "Failure" ? diagnosticText(result.failure.message) : undefined,
          source: {
            work_revision: revision,
            captured_at: yield* timestamp,
            execution_revision: execution?.revision,
          },
        };
      }),
    );

  private nextStamp = () =>
    Ref.modify(this.finderCache, (state) => {
      const next = state.stamp + 1;
      return [next, { ...state, stamp: next }] as const;
    });

  /** Refresh off the finder path. The stamp makes a delayed scan safe to discard. */
  refreshFinderReadiness = (bundle?: ReadBundle) =>
    Effect.gen({ self: this }, function* () {
      const retained = bundle
        ? {
            stamp: yield* this.nextStamp(),
            revision: bundle.recordsRevision,
            setupOverview: setupOverview(bundle.projects, bundle.setups),
            capacity: summarizeCapacity([...bundle.executions, ...bundle.setups]),
            recordsUnavailable: bundle.diagnostics.length > 0,
          }
        : yield* this.capture(() =>
            Effect.all(
              {
                revision: this.deps.records.observationRevision,
                projects: this.deps.records.projectScan(),
                executions: this.deps.records.executionScan(),
                setups: this.deps.records.setupScan(),
              },
              { concurrency: 4 },
            ).pipe(
              Effect.flatMap(({ revision, projects, executions, setups }) =>
                this.nextStamp().pipe(
                  Effect.map((stamp) => ({
                    stamp,
                    revision,
                    setupOverview: setupOverview(projects.values, setups.values),
                    capacity: summarizeCapacity([...executions.values, ...setups.values]),
                    recordsUnavailable: [projects, executions, setups].some(
                      ({ diagnostics }) => diagnostics.length > 0,
                    ),
                  })),
                ),
              ),
            ),
          );
      const authority = this.deps.config.auto_schedule
        ? (yield* this.deps.automaticAuthority()).blocker
        : undefined;
      return yield* Ref.modify(this.finderCache, (state) => {
        const before = state.capacity;
        if (before && before.stamp > retained.stamp) return [false, state] as const;
        const changed =
          !before ||
          before.revision !== retained.revision ||
          before.authority?.message !== authority?.message;
        return [changed, { ...state, capacity: { ...retained, authority } }] as const;
      });
    });

  private declarations() {
    return loadConfig(this.deps.config.home).pipe(
      Effect.match({
        onSuccess: (config) => ({
          digests: new Map(config.repositories.map((d) => [d.id, declarationDigest(d)])),
          error: undefined,
        }),
        onFailure: (error) => ({ digests: new Map<RepositoryId, string>(), error: error.message }),
      }),
    );
  }

  observeFinder = (query: WorkDiscovery) =>
    Effect.gen({ self: this }, function* () {
      const retained = yield* this.capture((workRevision) =>
        Effect.gen({ self: this }, function* () {
          const page = yield* this.deps.work.find(query);
          const repositories = new Set(page.entries.map((issue) => issue.repository_id));
          if (query.repository_id) repositories.add(query.repository_id);
          const observed = yield* Effect.all(
            {
              related: this.deps.work.taskEvidence(page.entries),
              recordRevision: this.deps.records.observationRevision,
              executions: Effect.forEach(
                page.entries,
                (issue) => this.deps.records.execution(issue.id).pipe(Effect.result),
                { concurrency: 4 },
              ),
              projects: Effect.forEach(
                repositories,
                (id) =>
                  this.deps.records.project(id).pipe(
                    Effect.result,
                    Effect.map((result) => [id, result] as const),
                  ),
                { concurrency: 4 },
              ),
              observedAt: timestamp,
            },
            { concurrency: 4 },
          );
          const summary = (yield* Ref.get(this.finderCache)).capacity;
          return {
            ...observed,
            page,
            workRevision,
            summary: summary?.revision === observed.recordRevision ? summary : undefined,
          };
        }),
      );
      const declarations = retained.page.entries.some(({ status }) => status !== "closed")
        ? yield* this.declarations()
        : undefined;
      const projects = new Map(retained.projects);
      const selected = query.repository_id && projects.get(query.repository_id);
      const observedCapacity = retained.summary?.recordsUnavailable ? undefined : retained.summary;
      return {
        ...retained.page,
        capacity: observedCapacity && this.slotUsage(observedCapacity),
        project_capacity:
          observedCapacity && selected?._tag === "Success" && selected.success
            ? this.slotUsage(observedCapacity, selected.success)
            : undefined,
        entries: retained.page.entries.map((issue, index) => {
          const result = retained.executions[index]!;
          const execution = result._tag === "Success" ? result.success : undefined;
          const project = projects.get(issue.repository_id);
          const related = retained.related[index]!;
          const ready =
            declarations && issue.status !== "closed"
              ? retainedReadiness(
                  this.deps.config,
                  issue,
                  related.dependencies.filter((d) => d.status !== "closed"),
                  project?._tag === "Success" ? project.success : undefined,
                  execution,
                  {
                    declarationDigest: declarations.digests.get(issue.repository_id),
                    declarationError: declarations.error,
                    capacity: retained.summary?.capacity,
                    authority: retained.summary?.authority,
                    recordsUnavailable:
                      Boolean(retained.summary?.recordsUnavailable) ||
                      result._tag === "Failure" ||
                      project?._tag === "Failure",
                  },
                )
              : undefined;
          return {
            issue,
            execution,
            executionUnavailable:
              result._tag === "Failure" ? diagnosticText(result.failure.message) : undefined,
            readiness: ready && { ...ready, eligibility_observed: Boolean(retained.summary) },
            closedAt:
              execution && execution.current_phase !== "completed" ? undefined : related.closed_at,
          };
        }),
        workRevision: retained.workRevision,
        recordsRevision: retained.recordRevision,
        observedAt: retained.observedAt,
      };
    });

  readinessContext = Effect.fn("Queries.readinessContext")(
    function* (this: SnapshotQueries): Effect.fn.Return<ExternalReadinessContext, CrewError> {
      const declarations = yield* this.declarations();
      const authority = this.deps.config.auto_schedule
        ? (yield* this.deps.automaticAuthority()).blocker
        : undefined;
      return { declarations, authority };
    }.bind(this),
    domainEffect,
  );

  readinessFor = (ids: readonly IssueId[], external?: ExternalReadinessContext) =>
    this.capture(() =>
      Effect.all(
        {
          explanation: this.deps.work.explainSelected(ids),
          projects: this.deps.records.projectScan(),
          scan: scanCapacity(this.deps.records),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(({ explanation, projects, scan }) => ({
          explanation,
          projects: projects.values,
          executions: scan.executions,
          setups: scan.setups,
          diagnostics: [...projects.diagnostics, ...scan.diagnostics],
        })),
      ),
    ).pipe(
      Effect.flatMap((retained) => this.evaluateReadiness(retained, external)),
      Effect.map((rows) => new Map(rows.map((row) => [row.issue.id, row]))),
    );

  ready = (bundle?: ReadBundle) =>
    (bundle ? Effect.succeed(bundle) : this.observe()).pipe(
      Effect.flatMap((data) => this.evaluateReadiness(data)),
      Effect.map((rows) =>
        rows.sort(
          (a, b) => a.issue.priority - b.issue.priority || a.issue.id.localeCompare(b.issue.id),
        ),
      ),
    );

  private evaluateReadiness(
    {
      explanation,
      projects,
      executions,
      diagnostics,
      setups,
    }: Pick<ReadBundle, "explanation" | "projects" | "executions" | "diagnostics" | "setups">,
    external?: ExternalReadinessContext,
  ) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const { declarations, authority } = external ?? (yield* this.readinessContext());
        const capacity = summarizeCapacity([...executions, ...setups]);
        const byID = new Map(executions.map((e) => [e.issue_id, e]));
        const projectsByID = new Map(projects.map((p) => [p.id, p]));
        const blocked = new Map(explanation.blocked.map((row) => [row.id, row.blocked_by]));
        return [...explanation.ready, ...explanation.blocked]
          .filter((issue) => issue.status !== "closed")
          .map((issue) => ({
            ...retainedReadiness(
              this.deps.config,
              issue,
              blocked.get(issue.id) ?? [],
              projectsByID.get(issue.repository_id),
              byID.get(issue.id),
              {
                declarationDigest: declarations.digests.get(issue.repository_id),
                declarationError: declarations.error,
                authority,
                capacity,
                recordsUnavailable: diagnostics.length > 0,
              },
            ),
            dependencies: blocked.get(issue.id) ?? issue.dependencies,
          }));
      }),
    );
  }
}

export type ReadBundle = Effect.Success<ReturnType<SnapshotQueries["observe"]>>;
