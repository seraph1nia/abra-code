import { cp, symlink } from "node:fs/promises";
import { removeFixture } from "./helpers/resources.ts";
import { capabilityRequirements } from "../src/opencode/role-policy.ts";
import { workerProfile } from "../src/config/snapshot.ts";
import { type WorkerEnvironment } from "../src/opencode/worker-environment.ts";
import { Agent } from "@opencode/schema/agent";
import { verifiedSpec } from "./helpers/spec-review.ts";
import { decode } from "../src/decode.ts";
import { ConfigSchema } from "../src/config/contracts.ts";
import { SpecStatusSchema, ApplyStatusSchema, OpenSpec } from "../src/openspec/adapter.ts";
import {
  type DispositionAnswer,
  type QuestionAnswer,
  type Runtime,
  type SessionState,
} from "../src/opencode/runtime.ts";
import * as Id from "../src/identities.ts";
import { domainEffect } from "../src/effect.ts";
import { Effect, Exit, Scope, Semaphore } from "effect";
import { mkdtemp, mkdir, writeFile, readFile, rename } from "../src/filesystem.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../src/process.ts";
import { Git } from "../src/git/repository.ts";
import { Records, type Store } from "../src/storage/store.ts";
import { fixtureGraph } from "./helpers/work-database.ts";

import { createWorkflow } from "../src/opencode/application.ts";
import { Onboarding } from "../src/config/onboard.ts";
import {
  CrewError,
  ensure,
  type Config,
  type Execution,
  type ManagedExecution,
  type Issue,
  type Project,
  type Role,
  type WorkerModel,
} from "../src/domain.ts";

import { type Delivery, type PR } from "../src/git/delivery.ts";
import { type Locks } from "../src/storage/lock.ts";
export class MemoryStore implements Store {
  values = new Map<string, unknown>();
  get<T>(key: string) {
    return domainEffect(
      Effect.sync(() => {
        return structuredClone(this.values.get(key)) as T | undefined;
      }),
    );
  }
  set<T>(key: string, value: T) {
    return domainEffect(
      Effect.sync(() => {
        this.values.set(key, structuredClone(value));
      }),
    );
  }
  entries(prefix: string) {
    return domainEffect(
      Effect.sync(() =>
        [...this.values]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key: Id.StorageKey.make(key), value: structuredClone(value) })),
      ),
    );
  }
}
export class TestLocks implements Locks {
  private semaphores = new Map<string, Semaphore.Semaphore>();
  private owners = new Set<string>();
  get held() {
    return this.owners.size > 0;
  }
  with<A, E, R>(
    key: string,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number },
  ) {
    const semaphore = this.semaphores.get(key) ?? Semaphore.makeUnsafe(1);
    this.semaphores.set(key, semaphore);
    const body = Effect.acquireUseRelease(
      Effect.sync(() => this.owners.add(key)),
      () => action(),
      () =>
        Effect.sync(() => {
          this.owners.delete(key);
        }),
    );
    return options?.waitSeconds === 0
      ? semaphore
          .withPermitsIfAvailable(1)(body)
          .pipe(
            Effect.flatMap((result) =>
              Effect.fromOption(result).pipe(
                Effect.mapError(() => new CrewError("LOCKED", `${key} is owned`)),
              ),
            ),
          )
      : semaphore.withPermits(1)(body);
  }
}
export class FakeSpec extends OpenSpec {
  planned = false;
  done = false;
  valid = true;
  constructor() {
    super(new ProcessRunner(), Id.Executable.make("unused"));
  }
  update = (_e: Execution): Effect.Effect<void, CrewError> => Effect.void;
  bind = (e: Execution) =>
    Effect.succeed({
      schema_version: 1 as const,
      state: "bound" as const,
      selection_source: e.openspec_schema ? ("task" as const) : ("repository_default" as const),
      name: e.openspec_schema ?? Id.SpecSchemaName.make("spec-driven"),
      source: "package" as const,
      root: Id.AbsolutePath.make("/fixture/schema"),
      files: [
        {
          path: Id.RelativePath.make("schema.yaml"),
          hash: Id.ContentHash.make("a".repeat(64)),
          bytes: 1,
        },
      ],
      hash: Id.ContentHash.make("b".repeat(64)),
    });
  assertSchema = (_e: Execution): Effect.Effect<void, CrewError> => Effect.void;
  create = Effect.fn("FakeSpec.create")(
    function* (this: FakeSpec, e: Execution) {
      yield* writePlan(e.worktree_directory!, e.openspec_change);
    }.bind(this),
    domainEffect,
  );
  status(e: Execution) {
    return Effect.suspend(() =>
      decode(
        SpecStatusSchema,
        {
          changeName: e.openspec_change,
          schemaName:
            e.openspec_schema_binding?.state === "bound"
              ? e.openspec_schema_binding.name
              : (e.openspec_schema ?? "spec-driven"),
          isPlanningComplete: this.planned,
          isComplete: this.planned,
          artifacts: [
            {
              id: "tasks",
              status: this.planned ? ("done" as const) : ("ready" as const),
              outputPath: "tasks.md",
              requires: [],
            },
          ],
          applyRequires: ["tasks"],
          actionContext: { mode: "repo-local" },
        },
        "Fixture OpenSpec",
      ),
    );
  }
  apply() {
    return Effect.suspend(() =>
      decode(
        ApplyStatusSchema,
        {
          state: this.done
            ? ("all_done" as const)
            : this.planned
              ? ("ready" as const)
              : ("blocked" as const),
          taskTrackingConfigured: true,
          progress: { total: 1, complete: this.done ? 1 : 0, remaining: this.done ? 0 : 1 },
          tasks: [{ id: "1", done: this.done }],
        },
        "Fixture OpenSpec",
      ),
    );
  }
  validate = () => {
    return domainEffect(
      Effect.sync(() => {
        ensure(this.valid, "INVALID_SPEC", "Invalid OpenSpec");
        return { items: [{ valid: true }], summary: { totals: { failed: 0, passed: 1 } } };
      }),
    );
  };
  archive = Effect.fn("FakeSpec.archive")(
    function* (this: FakeSpec, e: Execution) {
      const target = join(e.worktree_directory!, "openspec/changes/archive");
      yield* mkdir(target, { recursive: true });
      yield* rename(
        join(e.worktree_directory!, "openspec/changes", e.openspec_change),
        join(target, `2026-10-14-${e.openspec_change}`),
      );
      return Id.RelativePath.make(`openspec/changes/archive/2026-10-14-${e.openspec_change}`);
    }.bind(this),
    domainEffect,
  );
}
export function writePlan(path: string, change: string, done = false) {
  return domainEffect(
    Effect.gen(function* () {
      const root = join(path, "openspec/changes", change);
      yield* mkdir(join(root, "specs/sample"), { recursive: true });
      yield* writeFile(
        join(root, "proposal.md"),
        "## Why\nNeed a sample.\n## What Changes\nAdd sample.\n## Capabilities\n### New Capabilities\n- `sample`: Sample capability.\n### Modified Capabilities\n## Impact\nSample code.\n",
      );
      yield* writeFile(join(root, "design.md"), "## Design\nReturn a sample.\n");
      yield* writeFile(
        join(root, "tasks.md"),
        `## Implementation\n- [${done ? "x" : " "}] 1.1 Implement sample\n`,
      );
      yield* writeFile(
        join(root, "specs/sample/spec.md"),
        "## Purpose\nProvide a stable sample response that consumers can request through the sample capability.\n\n## ADDED Requirements\n### Requirement: Sample behavior\nThe system SHALL return a sample.\n#### Scenario: Request sample\n- **WHEN** a sample is requested\n- **THEN** a sample is returned\n",
      );
    }),
  );
}
export class FakeRuntime implements Runtime {
  consumeReviewPages = true;
  managementSession(id: Id.SessionId, _parent: Id.SessionId, model: WorkerModel, lead: string) {
    return domainEffect(
      Effect.sync(() => {
        const old = this.sessions.get(id);
        if (old && old.metadata?.abracode_lead !== lead)
          throw new CrewError("LEAD_SESSION", "Conflict");
        if (!old)
          this.sessions.set(id, {
            id,
            directory: this.managementHome,
            agent: Agent.ID.make("project-lead"),
            model,
            metadata: { abracode_lead: lead },
            busy: false,
            executing: false,
          });
      }),
    );
  }

  managementHome = Id.AbsolutePath.make("/fixture");
  permissionRefreshes = 0;
  refreshPermissions() {
    return Effect.sync(() => {
      this.permissionRefreshes++;
    });
  }
  preflight(
    _e: ManagedExecution,
    _role: Role,
    _promptID?: Id.MessageId,
  ): Effect.Effect<WorkerEnvironment | void, CrewError> {
    if (_promptID && this.admissions.has(_promptID)) return Effect.void;
    const profile = workerProfile(_e, _role, { workers: this.profiles });
    const req = capabilityRequirements(_role, _e.workflow_policy, profile);
    return Effect.succeed({
      agent: profile?.agent ?? Agent.ID.make("build"),
      model: profile?.model ?? _e.worker_model ?? this.selectedModel,
      tools: req.tools,
      skills: req.skills.map((id) => ({
        id,
        path: Id.AbsolutePath.make("/fixture/skill.md"),
        digest: "fixture",
        source: "role-policy",
        loading: "unobserved" as const,
      })),
    });
  }
  profiles: Config["workers"] = {};
  origins = new Map<Id.MessageId, Id.MessageId>();
  promptOrigin(_session: Id.SessionId, message: Id.MessageId) {
    return Effect.succeed(this.origins.get(message));
  }
  selectedModel: WorkerModel = {
    providerID: Id.ProviderId.make("fixture"),
    id: Id.ModelId.make("fixture"),
  };
  sessions = new Map<Id.SessionId, SessionState>();
  trees: Id.AbsolutePath[] = [];
  forms = new Map<Id.FormId, "pending" | "approved" | "rejected">();
  prompts: number = 0;
  admissions = new Set<Id.MessageId>();
  promptAdmission(
    _session: Id.SessionId,
    message: Id.MessageId,
    _text: string,
  ): Effect.Effect<"queued" | "consumed" | "absent"> {
    return Effect.succeed(
      this.admissions.has(message) ? ("consumed" as const) : ("absent" as const),
    );
  }
  promptAdmissions(
    session: Id.SessionId,
    requests: readonly import("../src/opencode/runtime.ts").PromptIdentity[],
  ) {
    return Effect.forEach(requests, (request) =>
      this.promptAdmission(session, request.prompt_id, request.prompt).pipe(
        Effect.map((status) => [request.prompt_id, status] as const),
      ),
    ).pipe(Effect.map((entries) => new Map(entries)));
  }
  creates: number = 0;
  constructor(private git: Git) {}
  project(path: Id.AbsolutePath) {
    return domainEffect(
      Effect.sync(() => {
        return Id.NativeProjectId.make(path);
      }),
    );
  }
  inventory() {
    return domainEffect(
      Effect.sync(() => {
        return this.trees;
      }),
    );
  }
  createWorktree = Effect.fn("FakeRuntime.createWorktree")(
    function* (this: FakeRuntime, p: Project, e: ManagedExecution, root: Id.AbsolutePath) {
      const dir = Id.AbsolutePath.make(join(root, e.execution_id));
      yield* mkdir(root, { recursive: true });
      yield* this.git.run(p.path, ["worktree", "add", "--detach", dir, e.base_commit!]);
      this.trees.push(dir);
      return dir;
    }.bind(this),
    domainEffect,
  );
  removeWorktree = Effect.fn("FakeRuntime.removeWorktree")(
    function* (this: FakeRuntime, p: Project, e: ManagedExecution) {
      yield* this.git.run(p.path, ["worktree", "remove", e.worktree_directory!]);
      this.trees = this.trees.filter((d) => d !== e.worktree_directory);
    }.bind(this),
    domainEffect,
  );
  createSession(e: ManagedExecution, role: Role, id: Id.SessionId) {
    return domainEffect(
      Effect.sync(() => {
        if (!this.sessions.has(id)) {
          this.creates++;
          this.sessions.set(id, {
            id,
            directory: e.worktree_directory!,
            agent: this.profiles[role]?.agent ?? Agent.ID.make("build"),
            busy: false,
            metadata: { role },
          });
        }
        return id;
      }),
    );
  }
  supervisorModel() {
    return domainEffect(
      Effect.sync(() => {
        return this.selectedModel;
      }),
    );
  }
  switchAgent(id: Id.SessionId, agent: Agent.ID) {
    return Effect.sync(() => {
      this.sessions.get(id)!.agent = agent;
    });
  }
  switchModel(id: Id.SessionId, model: WorkerModel) {
    return domainEffect(
      Effect.sync(() => {
        this.sessions.get(id)!.model = model;
      }),
    );
  }
  session(id: Id.SessionId) {
    return domainEffect(
      Effect.sync(() => {
        const s = this.sessions.get(id);
        ensure(s, "SESSION_MISSING", "Missing session");
        return { ...s };
      }),
    );
  }
  prompt(id: Id.SessionId, _text: string, _messageID: Id.MessageId) {
    return domainEffect(
      Effect.sync(() => {
        if (this.admissions.has(_messageID)) return;
        this.admissions.add(_messageID);
        this.prompts++;
        this.sessions.get(id)!.busy = true;
        delete this.sessions.get(id)!.outcome;
      }),
    );
  }
  interrupt(id: Id.SessionId, _prompt?: Id.MessageId, _additional?: readonly Id.MessageId[]) {
    return domainEffect(
      Effect.sync(() => {
        this.sessions.get(id)!.busy = false;
        this.sessions.get(id)!.outcome = "interrupted";
      }),
    );
  }
  notify(_id: Id.SessionId, _text: string, _message?: Id.MessageId) {
    return domainEffect(Effect.sync(() => {}));
  }
  questions = new Map<Id.FormId, QuestionAnswer>();
  dispositions = new Map<Id.FormId, DispositionAnswer>();
  requestDisposition(_session: Id.SessionId, id: Id.FormId) {
    return Effect.sync(() => {
      if (!this.dispositions.has(id)) this.dispositions.set(id, { status: "pending" });
      return id;
    });
  }
  disposition(_session: Id.SessionId, id: Id.FormId) {
    return Effect.sync(() => this.dispositions.get(id) ?? { status: "pending" as const });
  }
  requestQuestion(_session: Id.SessionId, id: Id.FormId) {
    return Effect.sync(() => {
      if (!this.questions.has(id)) this.questions.set(id, { status: "pending" });
      return id;
    });
  }
  questionAnswer(_session: Id.SessionId, id: Id.FormId) {
    return Effect.sync(() => this.questions.get(id) ?? { status: "pending" as const });
  }
  requestApproval(_s: Id.SessionId, id: Id.FormId) {
    return domainEffect(
      Effect.sync(() => {
        if (!this.forms.has(id)) this.forms.set(id, "pending");
        return id;
      }),
    );
  }
  approval(_s: Id.SessionId, id: Id.FormId) {
    return domainEffect(
      Effect.sync(() => {
        return this.forms.get(id) ?? "pending";
      }),
    );
  }
  success(id: Id.SessionId) {
    this.sessions.get(id)!.busy = false;
    this.sessions.get(id)!.outcome = "succeeded";
  }
}
export class FakeDelivery implements Delivery {
  calls = 0;
  merged = false;
  pr?: PR;
  cleanupFails = false;
  constructor(private git: Git) {}
  deliver = Effect.fn("FakeDelivery.deliver")(
    function* (this: FakeDelivery, _p: Project, e: ManagedExecution) {
      this.calls++;
      const commit = yield* this.git.commit(e.worktree_directory!, e.issue_id);
      yield* this.git.run(e.worktree_directory!, ["push", "origin", e.branch]);
      this.pr ??= {
        url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/1"),
        state: "OPEN",
        headRefOid: commit,
        baseRefName: Id.BranchName.make("main"),
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
      };
      this.pr.headRefOid = commit;
      return { commit, pr: this.pr.url };
    }.bind(this),
    domainEffect,
  );
  findings() {
    return Effect.succeed([
      {
        id: Id.FindingId.make("review-finding"),
        head: this.pr!.headRefOid,
        kind: "review" as const,
        text: "Fix the approved edge case",
      },
    ]);
  }
  inspect() {
    return domainEffect(
      Effect.sync(() => {
        return this.pr;
      }),
    );
  }
  merge() {
    return domainEffect(
      Effect.sync(() => {
        this.merged = true;
        this.pr!.state = "MERGED";
        return { category: "completed", value: undefined } as const;
      }),
    );
  }
  evidence(_p: Project, e: ManagedExecution) {
    return domainEffect(
      Effect.sync(() => {
        ensure(this.merged, "NOT_MERGED", "Not merged");
        return {
          commit: e.delivered_commit!,
          target: Id.BranchName.make("main"),
          at: Id.Timestamp.make("2026-10-16T10:00:00.000Z"),
        };
      }),
    );
  }
}
export function repo(root: string, name: string) {
  return domainEffect(
    Effect.gen(function* () {
      const path = join(root, name);
      const seed = process.env.ABRACODE_TEST_REPOSITORY_SEED;
      if (seed) {
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              cp(join(seed, "repository"), path, { recursive: true }),
              cp(join(seed, "remote.git"), `${path}.git`, { recursive: true }),
            ]),
          catch: CrewError.from,
        });
        yield* new Git(new ProcessRunner()).run(Id.AbsolutePath.make(path), [
          "remote",
          "add",
          "origin",
          join(root, `${name}.git`),
        ]);
        return path;
      }
      yield* mkdir(path, { recursive: true });
      const git = new Git(new ProcessRunner());
      yield* git.run(Id.AbsolutePath.make(path), ["init", "-b", "main"]);
      yield* git.run(Id.AbsolutePath.make(path), [
        "config",
        "user.email",
        "fixture@example.invalid",
      ]);
      yield* git.run(Id.AbsolutePath.make(path), ["config", "user.name", "Fixture"]);
      yield* git.run(Id.AbsolutePath.make(path), [
        "remote",
        "add",
        "origin",
        join(root, `${name}.git`),
      ]);
      yield* mkdir(join(path, "openspec"), { recursive: true });
      yield* writeFile(join(path, "openspec/config.yaml"), "schema: spec-driven\n");
      yield* writeFile(join(path, "source.txt"), "original\n");
      yield* git.run(Id.AbsolutePath.make(path), ["add", "."]);
      yield* git.run(Id.AbsolutePath.make(root), ["init", "--bare", "-b", "main", `${path}.git`]);
      yield* git.run(Id.AbsolutePath.make(path), ["commit", "-m", "Initial"]);
      yield* git.run(Id.AbsolutePath.make(path), ["push", "origin", "main"]);
      return path;
    }),
  );
}
export function fixtureConfig(root: string) {
  return decode(
    ConfigSchema,
    {
      version: 1,
      models: { default: { providerID: "fixture", id: "fixture" } },
      supervisor_model: { providerID: "fixture", id: "fixture" },
      config_path: join(root, "abracode.yaml"),
      config_digest: "fixture",
      home: root,
      work_database: Id.AbsolutePath.make(join(root, "work.sqlite")),
      worktree_root: Id.AbsolutePath.make(join(root, "trees")),
      repository_root: Id.AbsolutePath.make(join(root, "repositories")),
      default_workflow: "full-openspec",
      auto_schedule: false,
      max_workers: 2,
      explore_capacity: 2,
      review_capacity: 2,
      reconcile_interval_ms: 30000,
      workers: {},
      commands: { openspec: "openspec", forge: "gh" },
      repositories: [],
      max_executions: 2,
      attention_capacity: 1,
      research_capacity: 2,
      progress_timeout_ms: {
        explore: 900000,
        apply: 1800000,
        review: 900000,
        research: 900000,
        operation: 300000,
      },
    },
    "Fixture configuration",
  );
}
export const fixture = domainEffect(
  Effect.gen(function* () {
    const root = yield* mkdtemp(
      join(process.env.ABRACODE_TEST_REPOSITORY_SEED ?? tmpdir(), "abracode-unit-"),
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
      const records = new Records(store);
      const locks = new TestLocks();
      const { work, seed } = yield* fixtureGraph.pipe(Effect.provideService(Scope.Scope, scope));
      const spec = new FakeSpec();
      const runtime = new FakeRuntime(git);
      runtime.managementHome = root;
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
      const { controller, setup, scheduler } = createWorkflow(
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
