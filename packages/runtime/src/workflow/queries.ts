import { feedbackPage } from "./read-model/feedback-page.ts";
import { Effect } from "effect";
import {
  type AbsolutePath,
  type ArtifactId,
  type FindingId,
  type FindingRevisionId,
  type IssueId,
  type RelativePath,
  type RepositoryId,
  type SessionId,
} from "@abracode/contracts/identities";
import type {
  EvidenceSearch,
  WorkDiscovery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { type LeadEvidenceQuery } from "@abracode/contracts/visibility/lead-observation";
import type { EvidenceQuery } from "@abracode/contracts/web/worker-evidence";
import {
  CrewError,
  type Config,
  type Execution,
  type ReadinessBlocker,
  type Role,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "../git/repository.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type OpenSpec } from "../openspec/adapter.ts";
import { type Records } from "../storage/store.ts";
import { archivedPlans } from "../visibility/archived-plans.ts";
import { changeDocument, changeDocuments } from "../visibility/documents.ts";
import { discoverEvidence } from "../visibility/evidence-discovery.ts";
import { executionContract } from "../visibility/execution-contract.ts";
import { type DiffScope } from "../visibility/protocol.ts";
import { TicketDiff } from "../visibility/ticket-diff.ts";
import { type WorkGraph } from "../work/graph.ts";
import { CheckpointEvidence } from "./authorization.ts";
import { scanLeads } from "./lead-contracts.ts";
import { leadEvidence, leadOverview } from "./read-model/lead-queries.ts";
import { queryMessages } from "./read-model/message-queries.ts";
import {
  SnapshotQueries,
  type ExternalReadinessContext,
  type ReadBundle,
} from "./read-model/snapshot.ts";
import {
  inspectWorker,
  observeCheckpoint,
  observeSupervision,
  queryDiagnostics,
  queryVerification,
  supervisionAggregate,
} from "./read-model/worker-queries.ts";
import { readWorkerContext } from "./worker-context.ts";
import { retainedEvidence } from "./worker-evidence.ts";

export type { ExternalReadinessContext, ReadBundle };

/** Read-only workflow surface. No adapter or storage mutation is exposed to observers. */
export class Queries {
  private readonly snapshots: SnapshotQueries;

  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private spec: OpenSpec,
    private git: Git,
    private runtime: Runtime,
    private reportReader?: (e: Execution) => Effect.Effect<string, CrewError>,
    private checkpoints = new CheckpointEvidence(git),
  ) {
    this.snapshots = new SnapshotQueries({
      config: this.config,
      records: this.records,
      work: this.work,
      automaticAuthority: this.automaticAuthority,
    });
  }

  get settings() {
    return {
      home: this.config.home,
      autoSchedule: this.config.auto_schedule,
      supervisionMode: this.config.supervision_mode,
      reconcileInterval: this.config.reconcile_interval_ms,
    };
  }

  executionContract = (e: Execution) => executionContract(e, this.config.supervision_mode);
  afterCommit = () => this.records.coordinateCommit(() => Effect.void);
  evidence = (query: EvidenceQuery) =>
    this.execution(query.issue_id).pipe(
      Effect.flatMap((e) => retainedEvidence(this.records.store, e, query)),
    );

  verification = (id: IssueId) =>
    queryVerification({ issue: this.issue, execution: this.execution, git: this.git }, id);

  feedback = (id: IssueId, page = 0, finding_id?: FindingId, revision?: FindingRevisionId) =>
    feedbackPage(this.records, id, page, finding_id, revision);
  projects = () => this.records.projects;
  project = (id: RepositoryId) => this.records.project(id);
  executions = () => this.records.executions;
  execution = (id: IssueId) => this.records.execution(id);
  thoughtWork = (query: Parameters<WorkGraph["thoughtWork"]>[0]) => this.work.thoughtWork(query);
  searchOwners = (after: string, repository?: RepositoryId, issue?: IssueId) =>
    this.work.searchOwners(after, repository, issue);
  discoverEvidence = (query: EvidenceSearch) =>
    discoverEvidence(this, () => scanLeads(this.records), query);
  issues = () => this.work.list;
  issue = (id: IssueId) => this.work.show(id);
  history = (id: IssueId) => this.work.history(id);
  completions = (...args: Parameters<WorkGraph["completions"]>) => this.work.completions(...args);
  setup = (id: RepositoryId) => this.records.setup(id);
  recordDiagnostics = () => this.records.diagnostics;
  recordsExport = () => this.records.export;
  supervisor = () => this.records.supervisor;

  /** Observation never collects a native answer or grants lifecycle authorization. */
  checkpoint = (session: SessionId, form: string) =>
    observeCheckpoint({ records: this.records, checkpoints: this.checkpoints }, session, form);

  leadOverview = (bundle: ReadBundle) =>
    leadOverview({ config: this.config, records: this.records, runtime: this.runtime }, bundle);

  leadEvidence = (input: typeof LeadEvidenceQuery.Type) =>
    leadEvidence(
      {
        config: this.config,
        records: this.records,
        work: this.work,
        runtime: this.runtime,
        capture: this.snapshots.capture,
        project: this.project,
        issue: this.issue,
      },
      input,
    );

  automaticAuthority = Effect.fn("Queries.automaticAuthority")(
    function* (
      this: Queries,
    ): Effect.fn.Return<{ session_id?: SessionId; blocker?: ReadinessBlocker }, CrewError> {
      const session = yield* this.records.supervisor;
      if (!session)
        return {
          blocker: {
            code: "authority",
            message: "Automatic scheduling requires a retained Abra session",
          },
        };
      const state = yield* this.runtime.session(session).pipe(Effect.result);
      if (state._tag === "Failure")
        return {
          blocker: {
            code: "authority",
            message: `Retained Abra is unavailable: ${diagnosticText(state.failure.message)}`,
          },
        };
      if (state.success.directory !== this.config.home || state.success.agent !== "abra")
        return {
          blocker: {
            code: "authority",
            message: "Retained automatic-scheduling authority is not Abra in the central checkout",
          },
        };
      return { session_id: session };
    }.bind(this),
    domainEffect,
  );

  planDocuments = (e: Execution) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        if (e.archive_path || e.current_phase === "completed") {
          const archive = yield* archivedPlans(this.git, yield* this.project(e.repository_id), e);
          return {
            paths: archive.paths,
            read: archive.read,
            observation: {
              source: "archive" as const,
              commit: archive.commit,
              limited: archive.limited,
            },
          };
        }
        const paths = yield* changeDocuments(e);
        return {
          paths,
          observation: { source: "worktree" as const, limited: paths.length >= 100 },
          read: (path: RelativePath) =>
            paths.includes(path)
              ? changeDocument(e, path)
              : Effect.fail(new CrewError("SPEC_PATH", "Select a document from the owned change")),
        };
      }),
    );

  planDocument = (e: Execution, path: RelativePath) =>
    this.planDocuments(e).pipe(Effect.flatMap((docs) => docs.read(path)));
  specStatus = (e: Execution) => this.spec.status(e);
  specApply = (e: Execution) => this.spec.apply(e);
  specInstructions = (e: Execution, artifact: ArtifactId) => this.spec.instructions(e, artifact);
  dirty = (path: AbsolutePath) => this.git.dirty(path);
  session = (id: SessionId) => this.runtime.session(id);

  sessionAvailability = (
    e: Execution,
    id: SessionId,
  ): Effect.Effect<"available" | "unavailable" | "unverified"> =>
    this.runtime.sessionOwner
      ? this.runtime.sessionOwner(id).pipe(
          Effect.map((owner) =>
            (
              owner.issue_id
                ? owner.issue_id === e.issue_id
                : owner.directory === e.worktree_directory
            )
              ? ("available" as const)
              : ("unavailable" as const),
          ),
          Effect.orElseSucceed(() => "unavailable" as const),
        )
      : Effect.succeed("unverified" as const);

  inspectWorker = (issue: IssueId, session: SessionId) =>
    inspectWorker(
      {
        config: this.config,
        runtime: this.runtime,
        get: this.get,
        executionContract: this.executionContract,
        sessionAvailability: this.sessionAvailability,
      },
      issue,
      session,
    );

  supervision = (
    e: Execution | undefined,
    blockers: readonly ReadinessBlocker[] = [],
    closed = false,
  ) => observeSupervision({ runtime: this.runtime }, e, blockers, closed);

  supervisionAggregate = (
    bundle?: ReadBundle,
    readiness?: readonly {
      issue: { id: IssueId };
      blocker_details: readonly ReadinessBlocker[];
    }[],
  ) =>
    supervisionAggregate(
      { runtime: this.runtime, observe: () => this.observe(), ready: this.ready },
      bundle,
      readiness,
    );

  capturedWorkerPrompt = (e: Execution) =>
    e.worker_context_id
      ? readWorkerContext(this.records.store, e.worker_context_id)
      : Effect.fail(new CrewError("PROMPT_INTENT", "No retained worker context"));

  messages = Effect.fn("Queries.messages")(
    function* (this: Queries, id: IssueId, offset = 0, limit = 20) {
      return yield* queryMessages({ runtime: this.runtime, get: this.get }, id, offset, limit);
    }.bind(this),
    domainEffect,
  );

  assignment = (sessionID: SessionId) => this.records.workerAssignment(sessionID);
  diff = (id: IssueId, scope: DiffScope, file?: RelativePath, filesOnly = false) =>
    new TicketDiff({
      issue: this.issue,
      execution: this.execution,
      project: this.project,
      git: { run: this.git.run.bind(this.git), validate: this.git.validate },
    }).read(id, scope, file, filesOnly);

  report = (id: IssueId) =>
    this.get(id).pipe(
      Effect.flatMap((e) =>
        this.reportReader
          ? this.reportReader(e)
          : Effect.fail(new CrewError("REPORT_UNAVAILABLE", "Report reader unavailable")),
      ),
    );

  effectiveProject = Effect.fn("Queries.effectiveProject")(
    function* (this: Queries, e: Execution) {
      const p = yield* this.records.project(e.repository_id);
      if (!p) return yield* new CrewError("PROJECT_MISSING", "Repository is no longer registered");
      if (e.delivery_policy !== p.delivery)
        return yield* new CrewError(
          "POLICY_DRIFT",
          "Registered delivery policy changed during execution",
        );
      return { ...p, verification: e.effective_policy.verification };
    }.bind(this),
    domainEffect,
  );

  get = Effect.fn("Queries.get")(
    function* (this: Queries, id: IssueId): Effect.fn.Return<Execution, CrewError> {
      const e = yield* this.records.execution(id);
      if (!e) return yield* new CrewError("EXECUTION_MISSING", `No execution for ${id}`);
      return e;
    }.bind(this),
    domainEffect,
  );

  diagnostics = Effect.fn("Queries.diagnostics")(
    function* (this: Queries, id: IssueId, role?: Role) {
      return yield* queryDiagnostics(
        {
          config: this.config,
          records: this.records,
          runtime: this.runtime,
          get: this.get,
          executionContract: this.executionContract,
        },
        id,
        role,
      );
    }.bind(this),
    domainEffect,
  );

  observe = (query?: WorkDiscovery, includeRecords = false) =>
    this.snapshots.observe(query, includeRecords);

  workList = (includeRecords = false) =>
    Effect.gen({ self: this }, function* () {
      const bundle = yield* this.observe(undefined, includeRecords);
      return {
        supervision: yield* this.supervisionAggregate(bundle),
        issues: bundle.issues,
        executions: bundle.executions,
        record_diagnostics: bundle.diagnostics,
        records: bundle.exported,
        retained_source: bundle.source,
      };
    });

  bindingPopulation = () => this.snapshots.bindingPopulation();
  observeTask = (id: IssueId, includeHistory = false) =>
    this.snapshots.observeTask(id, includeHistory);
  refreshFinderReadiness = (bundle?: ReadBundle) => this.snapshots.refreshFinderReadiness(bundle);
  observeFinder = (query: WorkDiscovery) => this.snapshots.observeFinder(query);
  readinessContext = () => this.snapshots.readinessContext();
  readinessFor = (ids: readonly IssueId[], external?: ExternalReadinessContext) =>
    this.snapshots.readinessFor(ids, external);
  ready = (bundle?: ReadBundle) => this.snapshots.ready(bundle);
}
