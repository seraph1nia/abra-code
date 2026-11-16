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
import { type Config } from "../domain.ts";
import { platformLayer } from "../platform.ts";

export function createWorkflow(
  config: Config,
  records: Records,
  work: WorkGraph,
  spec: OpenSpec,
  git: Git,
  runtime: Runtime,
  delivery: Delivery,
  locks: Locks,
) {
  const sources = new RepositorySources(git, config.repository_root);
  const workspaces = new Workspaces(git, sources, runtime, config.worktree_root);
  let advancement: Advancement;
  const workerContexts = new WorkerContexts(records, config);
  const coordination = records.coordinate(locks);
  const obligations = new Obligations(records, runtime, work, coordination);
  const attention = new AttentionService(config, records, runtime, coordination, locks);
  const operations = new Operations(records, locks, coordination);
  const capacity = new Capacity(config, records, coordination);
  const scopes = new Scopes(records);
  const corrections = new Corrections(records, git, config);
  const reports = new Reports(config.home, records, git, locks, work, runtime.notify.bind(runtime));
  const checkpoints = new CheckpointEvidence(git);
  const authorizations = new Authorizations(records, runtime, checkpoints);
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
  );
  const messages = sessions.messages;
  const leads = new Leads(
    config,
    records,
    work,
    runtime,
    locks,
    obligations,
    (a, s) => advancement.createWorkBatch(a, s),
    (a, s) => advancement.workMessage(a, s),
  );
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
    synchronize: (e, p, observation) => advancement.synchronize(e, p, observation),
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
  const admission = new WorkAdmission(
    {
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
    },
    {
      reconcile: (e) => advancement.reconcileExecution(e),
      checkpoint: (e) => advancement.checkpointExecution(e),
    },
  );
  const recovery = new ExecutionRecovery(
    {
      authorizations,
      checkpoints,
      config,
      records,
      work,
      spec,
      git,
      runtime,
      delivery,
      operations,
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
    },
    {
      checkpoint: (e) => advancement.checkpointExecution(e),
      beginApply: (e, p) => advancement.beginApply(e, p),
      correctFailure: (e, error) => advancement.correctFailure(e, error),
    },
  );
  advancement = new Advancement({
    authorizations,
    checkpoints,
    recovery,
    admission,
    records,
    work,
    spec,
    git,
    runtime,
    delivery,
    coordination,
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
export const applicationLayer = (ctx: PluginContext, home: string) =>
  Layer.effect(
    Crew,
    Effect.gen(function* () {
      const config = yield* loadConfig(home);
      const runner = new ProcessRunner();
      const git = new Git(runner);
      const work = yield* openWorkGraph(config);
      const application = createWorkflow(
        config,
        new Records(new NativeStore(ctx.storage)),
        work,
        new OpenSpec(runner, config.commands.openspec),
        git,
        new NativeRuntime(ctx, config),
        new GitHubDelivery(git, runner, config.commands.forge),
        new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks"))),
      );
      yield* Effect.addFinalizer(() => application.controller.close());
      return application;
    }),
  ).pipe(Layer.provideMerge(Layer.merge(platformLayer, invalidationsLayer)));
