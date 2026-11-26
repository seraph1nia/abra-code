import { Agents } from "@abracode/agents";
import { Coordination } from "../src/workflow/coordination.ts";
import { symlink } from "node:fs/promises";
import { removeFixture } from "./helpers/resources.ts";
import { Agent } from "@opencode/schema/agent";
import { verifiedSpec } from "./helpers/spec-review.ts";
import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "./effects.ts";
import { Effect, Exit, Scope } from "effect";
import { temporaryDirectory, mkdir, writeFile, readFile } from "../src/filesystem.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../src/process.ts";
import { Git } from "../src/git/repository.ts";
import { Records } from "../src/storage/store.ts";
import { fixtureGraph } from "./helpers/work-database.ts";
import { createWorkflow } from "../src/opencode/application.ts";
import { Onboarding } from "../src/config/onboard.ts";
import { CrewError, type Config, type Execution, type Issue } from "../src/domain.ts";
import { MemoryStore, TestLocks } from "./helpers/fixture-storage.ts";
export { MemoryStore, TestLocks } from "./helpers/fixture-storage.ts";
import { FakeSpec } from "./helpers/fixture-spec.ts";
export { FakeSpec, writePlan } from "./helpers/fixture-spec.ts";
import { FakeRuntime } from "./helpers/fixture-runtime.ts";
export { FakeRuntime } from "./helpers/fixture-runtime.ts";
import { FakeDelivery } from "./helpers/fixture-delivery.ts";
export { FakeDelivery } from "./helpers/fixture-delivery.ts";
import { repo, fixtureConfig } from "./helpers/fixture-repository.ts";
export { repo, fixtureConfig } from "./helpers/fixture-repository.ts";

export const fixture = domainEffect(
  Effect.gen(function* () {
    const root = yield* temporaryDirectory(
      process.env.ABRACODE_TEST_REPOSITORY_SEED ?? tmpdir(),
      "abracode-unit-",
    );
    const scope = Scope.makeUnsafe();
    const cleanup = Scope.close(scope, Exit.void).pipe(
      Effect.ensuring(Effect.promise(() => removeFixture(root))),
    );
    return yield* Effect.gen(function* () {
      yield* mkdir(join(root, "packages/agents/assets"), { recursive: true });
      for (const role of ["explore", "apply", "review", "research"])
        yield* writeFile(
          join(root, "packages/agents/assets", `${role}.md`),
          yield* readFile(join(process.cwd(), "packages/agents/assets", `${role}.md`), "utf8"),
        );
      yield* mkdir(join(root, "node_modules/.bin"), { recursive: true });
      yield* Effect.tryPromise({
        try: () =>
          symlink(
            join(process.cwd(), "node_modules/.bin/ocr"),
            join(root, "node_modules/.bin/ocr"),
          ),
        catch: CrewError.from,
      });
      const runner = new ProcessRunner();
      const git = new Git(runner);
      const store = new MemoryStore();
      const locks = new TestLocks();
      const records = new Records(store, new Coordination(locks));
      const { work, seed } = yield* fixtureGraph.pipe(Effect.provideService(Scope.Scope, scope));
      const spec = new FakeSpec();
      const runtime = new FakeRuntime(git);
      runtime.managementHome = root;
      const supervisor = Id.SessionId.make("ses_supervisor");
      runtime.sessions.set(supervisor, {
        id: supervisor,
        directory: root,
        agent: Agent.ID.make("abra"),
        busy: false,
      });
      const delivery = new FakeDelivery(git);
      const config: Config = yield* fixtureConfig(root);
      yield* writeFile(
        config.config_path,
        "version: 1\nmodels: { default: { providerID: fixture, id: fixture } }\nrepositories: []\n",
      );
      runtime.profiles = config.workers;
      const onboarding = new Onboarding(
        records,
        git,
        runner,
        Id.Executable.make("openspec"),
        config.repository_root,
        locks,
        config,
      );
      for (const id of ["frontend", "api", "worker"].map((value) => Id.RepositoryId.make(value)))
        yield* onboarding.register(
          {
            id,
            path: Id.AbsolutePath.make(yield* repo(root, id)),
            verification: [[process.execPath, "-e", "process.exit(0)"]],
          },
          false,
        );
      const catalog = yield* Agents;
      const { controller, setup, scheduler } = yield* createWorkflow(
        catalog,
        config,
        records,
        work,
        spec,
        git,
        runtime,
        delivery,
        locks,
        join(root, "packages/agents/assets"),
      );
      const admitPrompt = runtime.prompt.bind(runtime);
      runtime.prompt = (id, text, prompt) =>
        admitPrompt(id, text, prompt).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              if (
                !runtime.consumeReviewPages ||
                !text.startsWith("You are the AbraCode review for issue")
              )
                return;
              let offset: number | undefined = 0;
              while (offset !== undefined)
                offset = (yield* controller.reviewChanges(id, offset)).next_offset;
            }),
          ),
        );
      return {
        root,
        git,
        records,
        locks,
        seed,
        work,
        spec,
        runtime,
        delivery,
        config,
        onboarding,
        catalog,
        controller,
        setup,
        scheduler,
        close: () => controller.close().pipe(Effect.ensuring(cleanup)),
      };
    }).pipe(Effect.onError(() => cleanup));
  }),
);
type PlanningChoices = Pick<Issue, "openspec_schema" | "require_plan_approval">;
export function planned(
  f: Effect.Success<typeof fixture>,
  id = Id.IssueId.make("abra-1"),
  choices: PlanningChoices = {},
  dependencies: Id.IssueId[] = [],
) {
  return domainEffect(
    Effect.gen(function* () {
      f.seed.named(id, undefined, dependencies, choices);
      let e = yield* f.controller.start(Id.IssueId.make(id), Id.SessionId.make("ses_supervisor"));
      f.spec.planned = true;
      f.runtime.success(e.explore_session_id!);
      e = yield* f.controller.advance(Id.IssueId.make(id));
      return e;
    }),
  );
}
export function applying(
  f: Effect.Success<typeof fixture>,
  id = Id.IssueId.make("abra-1"),
  choices: PlanningChoices = {},
) {
  return domainEffect(
    Effect.gen(function* () {
      let e = yield* planned(f, id, choices);
      const pending = (yield* f.controller.approve(
        Id.IssueId.make(id),
        "plan",
        Id.SessionId.make("ses_supervisor"),
      )) as {
        form_id: string;
      };
      f.runtime.forms.set(Id.FormId.make(pending.form_id), "approved");
      e = (yield* f.controller.approve(
        Id.IssueId.make(id),
        "plan",
        Id.SessionId.make("ses_supervisor"),
      )) as Execution;
      return e;
    }),
  );
}
export function delivered(
  f: Effect.Success<typeof fixture>,
  id = Id.IssueId.make("abra-1"),
  choices: PlanningChoices = {},
) {
  return domainEffect(
    Effect.gen(function* () {
      let e = yield* applying(f, id, choices);
      f.spec.done = true;
      f.runtime.success(e.apply_session_id!);
      e = yield* f.controller.advance(Id.IssueId.make(id));
      yield* f.controller.reviewReport(e.review_session_id!, true, "Pass", undefined, verifiedSpec);
      f.runtime.success(e.review_session_id!);
      e = yield* f.controller.advance(Id.IssueId.make(id));
      return e;
    }),
  );
}
