import { ExecutionRecovery } from "../workflow/execution-recovery.ts";
import { Authorizations, CheckpointEvidence } from "../workflow/authorization.ts";
import { WorkAdmission } from "../workflow/admission.ts";
import { Advancement } from "../workflow/advancement.ts";
import { WorkerContexts } from "../workflow/worker-context.ts";
import { Obligations } from "../workflow/obligations.ts";
import { AttentionService } from "../workflow/attention.ts";
import { Operations } from "../workflow/operations.ts";
import { Capacity } from "../workflow/capacity.ts";
import { Scopes } from "../workflow/scopes.ts";
import { Corrections } from "../workflow/corrections.ts";
import { Reports } from "../workflow/reports.ts";
import { Queries } from "../workflow/queries.ts";
import { SessionInspection } from "../workflow/session-inspection.ts";
import { WorkerSessions } from "../workflow/sessions.ts";
import { Leads } from "../workflow/leads.ts";
import { CodingChecks } from "../workflow/checks.ts";
import { ExecutionTransitions } from "../workflow/transitions.ts";
import { ExternalValidation } from "../workflow/external-validation.ts";
import { PRFeedback } from "../workflow/pr-feedback.ts";
import { Finishing } from "../workflow/finishing.ts";
import { Finalization } from "../workflow/finalization.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { ConfigApplication } from "../config/application.ts";
import { invalidationsLayer } from "../visibility/invalidations.ts";
import { AbsolutePath } from "../identities.ts";
import { Context, Effect, Layer } from "effect";
import { type Context as PluginContext } from "@opencode/plugin/effect/plugin";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import { ProcessRunner } from "../process.ts";
import { NativeStore, Records } from "../storage/store.ts";
import { FileLocks, type Locks } from "../storage/lock.ts";
import { openWorkGraph, type WorkGraph } from "../work/graph.ts";
import { OpenSpec } from "../openspec/adapter.ts";
import { Git } from "../git/repository.ts";
import { GitHubDelivery, type Delivery } from "../git/delivery.ts";
import { NativeRuntime, type Runtime } from "./runtime.ts";
import { Onboarding } from "../config/onboard.ts";
import { ProjectSetup } from "../config/setup.ts";
import { RepositorySources } from "../git/source.ts";
import { Workspaces } from "../git/workspaces.ts";
import { Controller } from "../workflow/controller.ts";
import { PlanningBaselines } from "../workflow/planning.ts";
import { type Config } from "../domain.ts";
import { platformLayer } from "../platform.ts";
import { Agents } from "@abracode/agents";
import { AgentsLive, sourcesLayer, bundledAssets, bundledSkills } from "@abracode/agents/bundled";
import { OpenCodeAgentsLive } from "@abracode/agents/native";
import { StaticProfile } from "@abracode/agents/contracts";
import { readWorkerContext } from "../workflow/worker-context.ts";
import { contributionAuthorization } from "./agent-contributions.ts";
import { realpath } from "../filesystem.ts";

export function createWorkflow(
  config: Config,
  records: Records,
  work: WorkGraph,
  spec: OpenSpec,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  locks: Locks,
  assets: string = bundledAssets,
) {
  const sources = new RepositorySources(git, config.repository_root);
  const workspaces = new Workspaces(git, sources, runtime, config.worktree_root);
  const workerContexts = new WorkerContexts(records, config, assets);
  const coordination = records.coordinate(locks);
  const obligations = new Obligations(records, runtime, work, coordination, config.home, git);
  const attention = new AttentionService(config, records, runtime, coordination, locks);
  const operations = new Operations(records, locks, coordination);
  const capacity = new Capacity(config, records, coordination);
  const scopes = new Scopes(records);
  const corrections = new Corrections(records, git, config);
  const reports = new Reports(config.home, records, git, locks, work, runtime.notify.bind(runtime));
  const checkpoints = new CheckpointEvidence(git);
  const inspection = new SessionInspection(runtime);
  const planning = new PlanningBaselines({
    records,
    git,
    work,
    runtime,
    spec,
    inspection,
    obligations,
  });
  const authorizations = new Authorizations(records, runtime, checkpoints, planning.assertDelta);
  const queries = new Queries(
    config,
    records,
    work,
    spec,
    git,
    runtime,
    (e) => reports.read(e),
    checkpoints,
  );
  const sessions = new WorkerSessions(
    config,
    records,
    runtime,
    capacity,
    coordination,
    queries,
    git,
    spec,
    attention,
    inspection,
    planning,
    assets,
  );
  const messages = sessions.messages;
  const checks = new CodingChecks(records, git, spec, sessions, coordination, queries, checkpoints);
  const transitions = new ExecutionTransitions(
    records,
    work,
    runtime,
    coordination,
    queries,
    operations,
    sessions,
  );
  const external = new ExternalValidation(records, git, runtime, {
    capacity,
    work,
    operations,
    queries,
    sessions,
  });
  const prFeedback = new PRFeedback({
    records,
    work,
    spec,
    delivery,
    runtime,
    operations,
    sessions,
    queries,
    corrections,
    transitions,
  });
  const finishing = new Finishing({
    git,
    records,
    delivery,
    workspaces,
    sessions,
    obligations,
    checks,
    spec,
  });
  const finalization = new Finalization({
    finishing,
    feedback: prFeedback,
    git,
    spec,
    records,
    delivery,
    work,
    reports,
    workspaces,
    coordination,
    obligations,
    sessions,
    transitions,
  });
  const admission = new WorkAdmission({
    config,
    records,
    work,
    spec,
    git,
    runtime,
    reports,
    queries,
    coordination,
    operations,
    capacity,
    transitions,
    sessions,
    workspaces,
  });
  const recovery = new ExecutionRecovery({
    authorizations,
    checkpoints,
    records,
    work,
    spec,
    git,
    runtime,
    delivery,
    queries,
    sessions,
    messages,
    obligations,
    transitions,
    finishing,
    prFeedback,
    finalization,
    admission,
    checks,
  });
  const advancement = new Advancement({
    config,
    planning,
    authorizations,
    checkpoints,
    recovery,
    admission,
    records,
    work,
    spec,
    git,
    delivery,
    obligations,
    operations,
    scopes,
    corrections,
    reports,
    queries,
    sessions,
    messages,
    checks,
    transitions,
    external,
    finishing,
    finalization,
  });
  const leads = new Leads(
    config,
    records,
    work,
    runtime,
    locks,
    obligations,
    admission.createWorkBatch,
    advancement.workMessage,
  );
  const controller = new Controller({
    queries,
    admission,
    execution: advancement,
    publication: advancement,
    verification: prFeedback,
    validation: external,
    reports,
    attention,
    obligations,
    communication: messages,
    contexts: workerContexts,
    leads,
  });
  const onboarding = new Onboarding(
    records,
    git,
    git.runner,
    config.commands.openspec,
    config.repository_root,
    locks,
    config,
  );
  return {
    controller,
    scheduler: new Scheduler(controller, records),
    config,
    onboarding,
    configuration: new ConfigApplication(config, records, onboarding),
    setup: new ProjectSetup({
      config,
      records,
      git,
      runtime,
      delivery,
      sources,
      workspaces,
      locks,
    }),
  };
}
export class Crew extends Context.Service<Crew, ReturnType<typeof createWorkflow>>()(
  "abracode/Crew",
) {}
/** The application entrypoint owns the live adapters; tests supply the same interfaces. */
export const applicationLayer = (ctx: PluginContext, home: string, catalogLayer = AgentsLive) =>
  Layer.effect(
    Crew,
    Effect.gen(function* () {
      const config = yield* loadConfig(home);
      const runner = new ProcessRunner();
      const git = new Git(runner);
      const work = yield* openWorkGraph(config);
      const catalog = yield* Agents;
      const records = new Records(new NativeStore(ctx.storage));
      const nativeRuntime = new NativeRuntime(ctx, config);
      const application = createWorkflow(
        config,
        records,
        work,
        new OpenSpec(runner, config.commands.openspec),
        git,
        nativeRuntime,
        new GitHubDelivery(git, runner, config.commands.forge),
        new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks"))),
      );
      const location = yield* realpath(ctx.location.directory);
      const central = location === config.home;
      const executions = yield* records.executions();
      for (const execution of executions) records.rememberWorkers(execution);
      const owned =
        central || executions.some((execution) => execution.worktree_directory === location);
      const profiles: StaticProfile[] = [];
      for (const definition of owned ? yield* catalog.list : []) {
        const agent = yield* catalog.get(definition.id);
        for (const role of definition.roles) {
          if (!central && (role === "supervisor" || role === "project-lead")) continue;
          profiles.push(yield* agent.resolve(role));
        }
      }
      // Exact retained static profiles must exist before a worker inventory can be exposed.
      for (const execution of executions) {
        if (execution.worktree_directory !== location) continue;
        profiles.push(...Object.values(execution.configuration_snapshot?.definitions ?? {}));
        if (execution.worker_context_id) {
          const context = yield* readWorkerContext(records.store, execution.worker_context_id);
          if (context.schema_version === 2) profiles.push(context.prepared.profile);
        }
      }
      yield* Layer.build(
        OpenCodeAgentsLive(ctx, {
          central,
          skills: bundledSkills,
          profiles,
          supervisorModel: config.supervisor_model,
          authorize: contributionAuthorization(
            (session) => application.controller.queries.assignment(session),
            records.store,
            (session, message) => nativeRuntime.promptOrigin(session, message),
          ),
        }).pipe(Layer.provide(Layer.succeed(Agents, catalog))),
      );
      yield* Effect.addFinalizer(() => application.controller.close());
      return application;
    }),
  ).pipe(
    Layer.provideMerge(
      catalogLayer.pipe(Layer.provideMerge(sourcesLayer()), Layer.provideMerge(platformLayer)),
    ),
    Layer.provideMerge(invalidationsLayer),
  );
