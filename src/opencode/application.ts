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
  const controller = new Controller(config, records, work, spec, git, runtime, delivery, locks, {
    sources,
    workspaces,
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
