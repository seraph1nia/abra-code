import { type InboxDetailCache } from "../work/inbox-cache.ts";
import { answerSelection } from "../workflow/messaging/selected-requests.ts";
import { AgentMemory } from "../memory/service.ts";
import { PersonalThoughts } from "../work/thoughts.ts";
import { GithubInbox } from "../work/github-inbox.ts";
import { Forge } from "../git/forge.ts";
import { InboxForge } from "../git/inbox.ts";
import { ExecutionRecovery } from "../workflow/execution-recovery.ts";
import {
  assertApprovalActor,
  Authorizations,
  CheckpointEvidence,
} from "../workflow/authorization.ts";
import { WorkAdmission } from "../workflow/admission.ts";
import { Advancement } from "../workflow/advancement.ts";
import { readWorkerContext } from "../workflow/worker-context.ts";
import { Obligations } from "../workflow/obligations.ts";
import { AttentionService } from "../workflow/attention.ts";
import { Operations } from "../workflow/operations.ts";
import { Capacity } from "../workflow/capacity.ts";
import { Scopes } from "../workflow/scopes.ts";
import { Corrections } from "../workflow/corrections.ts";
import { Reports } from "../reporting/reports.ts";
import { Queries } from "../workflow/queries.ts";
import { SessionInspection } from "../workflow/worker-assignment.ts";
import { WorkerSessions } from "../workflow/sessions.ts";
import { LeadActions as Leads } from "../workflow/leads/actions.ts";
import { CodingChecks } from "../workflow/checks.ts";
import { ExecutionTransitions } from "../workflow/transitions.ts";
import { ExternalValidation } from "../workflow/external-validation.ts";
import { PRFeedback } from "../workflow/pr/supervision.ts";
import { Finishing } from "../workflow/finishing/preparation.ts";
import { Finalization } from "../workflow/finishing/pipeline.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { ConfigApplication } from "../config/application.ts";
import { invalidationsLayer } from "../invalidations.ts";
import { readBindings } from "../visibility/bindings.ts";
import { AbsolutePath, Executable, IssueId } from "@abracode/contracts/identities";
import type { BindingSelection } from "@abracode/contracts/web/bindings";
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
import { Coordination } from "../workflow/coordination.ts";
import { PlanningBaselines } from "../workflow/planning.ts";
import { type Config } from "../domain.ts";
import { platformLayer } from "../platform.ts";
import { Agents } from "@abracode/agents";
import { AgentsLive, sourcesLayer, bundledAssets, bundledSkills } from "@abracode/agents/bundled";
import { OpenCodeAgentsLive } from "@abracode/agents/native";
import { StaticProfile } from "@abracode/agents/contracts";
import { contributionAuthorization } from "./agent-contributions.ts";
import { realpath } from "../filesystem.ts";

interface WorkflowResources {
  readonly details?: InboxDetailCache;
  readonly operations?: Operations;
  readonly thoughts?: PersonalThoughts;
  readonly memory?: AgentMemory;
}

function createInfrastructure(
  catalog: typeof Agents.Service,
  config: Config,
  records: Records,
  work: WorkGraph,
  git: Git,
  runtime: Runtime,
  locks: Locks,
  resources: WorkflowResources & { operations: Operations },
) {
  const sources = new RepositorySources(git, config.repository_root);
  const workspaces = new Workspaces(git, sources, runtime, config.worktree_root);
  const coordination = records.coordination;
  const assertActor = assertApprovalActor(records, runtime, config.home);
  const obligations = new Obligations(
    records,
    runtime,
    work,
    coordination,
    config.home,
    git,
    assertActor,
  );
  const attention = new AttentionService(config, records, runtime, coordination, locks);
  const operations = resources.operations;
  const capacity = new Capacity(config, records);
  const scopes = new Scopes(records);
  const corrections = new Corrections(records, git, config);
  const checkpoints = new CheckpointEvidence(git);
  const inspection = new SessionInspection(runtime);
  const thoughts = resources?.thoughts ?? new PersonalThoughts(config, work);
  const memory = resources?.memory ?? new AgentMemory(config, records, thoughts);
  return {
    details: resources?.details,
    catalog,
    sources,
    assertActor,
    workspaces,
    coordination,
    obligations,
    attention,
    operations,
    capacity,
    scopes,
    corrections,
    checkpoints,
    inspection,
    thoughts,
    memory,
  };
}

type Infrastructure = ReturnType<typeof createInfrastructure>;

function createReporting(
  config: Config,
  records: Records,
  git: Git,
  locks: Locks,
  work: WorkGraph,
  runtime: Runtime,
) {
  return new Reports(config.home, records, git, locks, work, runtime.notify.bind(runtime));
}

function createWorkflowCore(
  config: Config,
  records: Records,
  work: WorkGraph,
  spec: OpenSpec,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  infra: Infrastructure,
  reports: Reports,
  assets: string,
) {
  const planning = new PlanningBaselines({
    assertActor: infra.assertActor,
    records,
    git,
    work,
    spec,
    inspection: infra.inspection,
    obligations: infra.obligations,
  });
  const authorizations = new Authorizations(
    records,
    runtime,
    infra.checkpoints,
    infra.assertActor,
    planning.assertDelta,
  );
  const queries = new Queries(
    config,
    records,
    work,
    spec,
    git,
    runtime,
    (e) => reports.read(e),
    infra.checkpoints,
  );
  const readBinding = (selection: BindingSelection) =>
    readBindings(queries, {
      issue_ids: selection.ids.map((id) => IssueId.make(id)),
      include_population: selection.unfiltered,
    });
  const sessions = new WorkerSessions(
    config,
    records,
    runtime,
    infra.capacity,
    infra.coordination,
    queries,
    git,
    spec,
    infra.attention,
    infra.inspection,
    planning,
    assets,
  );
  const messages = sessions.messages;
  const checks = new CodingChecks(
    records,
    git,
    spec,
    sessions,
    infra.coordination,
    queries,
    infra.checkpoints,
    Executable.make(join(config.home, "node_modules/.bin/ocr")),
  );
  const transitions = new ExecutionTransitions(
    records,
    work,
    runtime,
    infra.coordination,
    queries,
    infra.operations,
    sessions,
  );
  const external = new ExternalValidation(records, git, runtime, {
    capacity: infra.capacity,
    work,
    operations: infra.operations,
    queries,
    sessions,
  });
  const prFeedback = new PRFeedback({
    records,
    work,
    spec,
    delivery,
    runtime,
    operations: infra.operations,
    sessions,
    queries,
    corrections: infra.corrections,
    transitions,
  });
  const finishing = new Finishing({
    git,
    records,
    delivery,
    workspaces: infra.workspaces,
    sessions,
    obligations: infra.obligations,
    checks,
    spec,
  });
  const finalization = new Finalization({
    operations: infra.operations,
    finishing,
    feedback: prFeedback,
    git,
    spec,
    records,
    delivery,
    work,
    reports,
    workspaces: infra.workspaces,
    coordination: infra.coordination,
    obligations: infra.obligations,
    sessions,
    transitions,
  });
  return {
    planning,
    authorizations,
    queries,
    readBinding,
    sessions,
    messages,
    checks,
    transitions,
    external,
    prFeedback,
    finishing,
    finalization,
  };
}

type WorkflowCore = ReturnType<typeof createWorkflowCore>;

function createWorkflowControl(
  config: Config,
  records: Records,
  work: WorkGraph,
  spec: OpenSpec,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  locks: Locks,
  infra: Infrastructure,
  reports: Reports,
  core: WorkflowCore,
  attention: AttentionService,
  messages: WorkflowCore["messages"],
) {
  const admission = new WorkAdmission({
    catalog: infra.catalog,
    config,
    records,
    work,
    spec,
    git,
    runtime,
    reports,
    queries: core.queries,
    coordination: infra.coordination,
    operations: infra.operations,
    capacity: infra.capacity,
    transitions: core.transitions,
    sessions: core.sessions,
    workspaces: infra.workspaces,
  });
  const recovery = new ExecutionRecovery({
    capacity: infra.capacity,
    authorizations: core.authorizations,
    checkpoints: infra.checkpoints,
    work,
    spec,
    git,
    delivery,
    queries: core.queries,
    sessions: core.sessions,
    messages,
    obligations: infra.obligations,
    transitions: core.transitions,
    finishing: core.finishing,
    prFeedback: core.prFeedback,
    finalization: core.finalization,
    admission,
    checks: core.checks,
  });
  const advancement = new Advancement({
    config,
    planning: core.planning,
    authorizations: core.authorizations,
    checkpoints: infra.checkpoints,
    recovery,
    admission,
    records,
    work,
    spec,
    git,
    delivery,
    obligations: infra.obligations,
    operations: infra.operations,
    scopes: infra.scopes,
    corrections: infra.corrections,
    reports,
    queries: core.queries,
    sessions: core.sessions,
    messages,
    checks: core.checks,
    transitions: core.transitions,
    external: core.external,
    finishing: core.finishing,
    finalization: core.finalization,
  });
  const leads = new Leads(
    config,
    records,
    work,
    runtime,
    locks,
    admission.createWorkBatch,
    advancement.workMessage,
    infra.memory,
  );
  const inbox = new GithubInbox(
    new InboxForge(new Forge(git.runner, config.commands.forge)),
    work.inbox,
    records,
    admission,
    config,
    infra.details,
  );
  return new Controller({
    answerSelection: (session, request, issue, answer) =>
      answerSelection(records.store, locks, session, request, issue, answer),
    thoughts: infra.thoughts,
    memory: infra.memory,
    inbox,
    queries: core.queries,
    admission,
    execution: advancement,
    publication: advancement,
    verification: core.prFeedback,
    validation: core.external,
    reports,
    attention,
    obligations: infra.obligations,
    communication: messages,
    contexts: core.sessions.contexts,
    leads,
    readBinding: core.readBinding,
  });
}

function createConfigurationServices(
  config: Config,
  records: Records,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  locks: Locks,
  infra: Infrastructure,
  controller: Controller,
) {
  const onboarding = new Onboarding(
    records,
    git,
    git.runner,
    config.commands.openspec,
    config.repository_root,
    locks,
    config,
  );
  const setup = new ProjectSetup({
    catalog: infra.catalog,
    config,
    records,
    git,
    runtime,
    delivery,
    sources: infra.sources,
    workspaces: infra.workspaces,
    locks,
  });
  return {
    onboarding,
    setup,
    configuration: new ConfigApplication(config, records, onboarding),
    scheduler: new Scheduler(controller, records, setup),
  };
}

const resolveAgentProfiles = (
  catalog: Context.Service.Shape<typeof Agents>,
  records: Records,
  location: AbsolutePath,
  central: boolean,
) =>
  Effect.gen(function* () {
    const executions = yield* records.executions;
    for (const execution of executions) records.rememberWorkers(execution);
    const owned =
      central || executions.some((execution) => execution.worktree_directory === location);
    const profiles: StaticProfile[] = [];
    for (const definition of owned ? yield* catalog.list : []) {
      const resolved = yield* catalog.get(definition.id).pipe(Effect.result);
      if (resolved._tag === "Failure") {
        yield* Effect.logWarning(
          "Cannot load agent definition",
          definition.id,
          resolved.failure.code,
        );
        continue;
      }
      const agent = resolved.success;
      for (const role of definition.roles) {
        if (!central && (role === "supervisor" || role === "project-lead")) continue;
        const profile = yield* agent.resolve(role).pipe(Effect.result);
        if (profile._tag === "Success") profiles.push(profile.success);
        else
          yield* Effect.logWarning(
            "Cannot register agent profile",
            definition.id,
            role,
            profile.failure.code,
          );
      }
    }
    // Exact retained static profiles must exist before a worker inventory can be exposed.
    for (const execution of executions) {
      if (execution.worktree_directory !== location) continue;
      profiles.push(...Object.values(execution.configuration_snapshot?.definitions ?? {}));
      if (execution.worker_context_id) {
        const context = yield* readWorkerContext(records.store, execution.worker_context_id).pipe(
          Effect.result,
        );
        if (context._tag === "Failure")
          yield* Effect.logWarning(
            "Unavailable retained worker profile",
            execution.issue_id,
            context.failure.code,
          );
        else if (context.success.schema_version === 2)
          profiles.push(context.success.prepared.profile);
      }
    }
    return profiles;
  });

export function createWorkflow(
  catalog: typeof Agents.Service,
  config: Config,
  records: Records,
  work: WorkGraph,
  spec: OpenSpec,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  locks: Locks,
  assets: string = bundledAssets,
  resources?: WorkflowResources,
) {
  return Effect.gen(function* () {
    const operations =
      resources?.operations ?? (yield* Operations.make(records, locks, records.coordination, work));
    const infra = createInfrastructure(catalog, config, records, work, git, runtime, locks, {
      ...resources,
      operations,
    });
    const reports = createReporting(config, records, git, locks, work, runtime);
    const core = createWorkflowCore(
      config,
      records,
      work,
      spec,
      git,
      runtime,
      delivery,
      infra,
      reports,
      assets,
    );
    const { attention } = infra;
    const { messages } = core;
    const controller = createWorkflowControl(
      config,
      records,
      work,
      spec,
      git,
      runtime,
      delivery,
      locks,
      infra,
      reports,
      core,
      attention,
      messages,
    );
    const { onboarding, setup, configuration, scheduler } = createConfigurationServices(
      config,
      records,
      git,
      runtime,
      delivery,
      locks,
      infra,
      controller,
    );
    return {
      surfaces: reports.surfaces,
      controller,
      scheduler,
      config,
      onboarding,
      configuration,
      setup,
    };
  });
}
export class Crew extends Context.Service<
  Crew,
  Effect.Success<ReturnType<typeof createWorkflow>> & {
    readonly store: NativeStore;
    readonly runtime: NativeRuntime;
    readonly central: boolean;
    readonly locks: FileLocks;
  }
>()("abracode/Crew") {}
/** The application entrypoint owns the live adapters; tests supply the same interfaces. */
export const applicationLayer = (ctx: PluginContext, home: string, catalogLayer = AgentsLive) =>
  Layer.effect(
    Crew,
    Effect.gen(function* () {
      const config = yield* loadConfig(home);
      const runner = new ProcessRunner();
      const git = new Git(runner);
      const catalog = yield* Agents;
      const store = new NativeStore(ctx.storage);
      const work = yield* openWorkGraph(config);
      const locks = new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks")));
      const coordination = new Coordination(locks);
      const records = new Records(store, coordination);
      const nativeRuntime = new NativeRuntime(ctx, config, records);
      const thoughts = new PersonalThoughts(config, work);
      const operations = yield* Effect.acquireRelease(
        Operations.make(records, locks, coordination, work),
        (ops) => ops.close,
      );
      const memory = yield* Effect.acquireRelease(
        Effect.sync(() => new AgentMemory(config, records, thoughts)),
        (service) => service.close,
      );
      const application = yield* createWorkflow(
        catalog,
        config,
        records,
        work,
        new OpenSpec(runner, config.commands.openspec),
        git,
        nativeRuntime,
        new GitHubDelivery(git, runner, config.commands.forge),
        locks,
        bundledAssets,
        {
          operations,
          thoughts,
          memory,
        },
      );
      yield* Effect.addFinalizer(() => application.controller.inbox.close);
      const location = yield* realpath(ctx.location.directory);
      const central = location === config.home;
      const profiles = yield* resolveAgentProfiles(catalog, records, location, central);
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
      return {
        ...application,
        store,
        runtime: nativeRuntime,
        central,
        locks,
      };
    }),
  ).pipe(
    Layer.provideMerge(
      catalogLayer.pipe(Layer.provideMerge(sourcesLayer()), Layer.provideMerge(platformLayer)),
    ),
    Layer.provideMerge(invalidationsLayer),
  );
