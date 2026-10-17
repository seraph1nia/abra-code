import { capabilityRequirements } from "../src/opencode/role-policy.ts";
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
import { Effect, Semaphore } from "effect";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from "../src/filesystem.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../src/process.ts";
import { Git } from "../src/git/repository.ts";
import { Records, type Store } from "../src/storage/store.ts";
import { explainIssues } from "../src/work/model.ts";
import { type WorkGraph, type NewIssue } from "../src/work/graph.ts";

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
export class FakeWorkGraph implements WorkGraph {
  issues = new Map<string, { -readonly [K in keyof Issue]: Issue[K] }>();
  requests = new Map<string, { input: string; id: Id.IssueId }>();
  claims = 0;
  creations = 0;
  readonly list = domainEffect(
    Effect.sync(() => [...this.issues.values()].map((issue) => structuredClone(issue))),
  );
  readonly explain = this.list.pipe(Effect.map(explainIssues));
  readonly ready = this.explain.pipe(Effect.map((result) => result.ready));
  show = (id: Id.IssueId) => {
    return domainEffect(
      Effect.sync(() => {
        const i = this.issues.get(id);
        ensure(i, "MISSING", "Missing issue");
        return structuredClone(i);
      }),
    );
  };
  create = Effect.fn("FakeWorkGraph.create")(
    function* (this: FakeWorkGraph, input: NewIssue) {
      const encoded = JSON.stringify(input);
      const saved = this.requests.get(input.request_id);
      if (saved) {
        ensure(
          saved.input === encoded,
          "REQUEST_REBIND",
          "This request_id belongs to a different goal",
        );
        return yield* this.show(saved.id);
      }
      for (const id of input.dependencies) yield* this.show(id);
      const id = Id.IssueId.make(`abra-created-${++this.creations}`);
      this.requests.set(input.request_id, { input: encoded, id });
      this.add(id, input.repository_id, input.dependencies);
      const issue = this.issues.get(id)!;
      issue.title = input.title;
      issue.description = input.description;
      issue.priority = input.priority;
      issue.workflow_policy = input.workflow_policy ?? "full-openspec";
      issue.scope = input.scope;
      issue.report_reference = input.report_reference;
      issue.request_id = input.request_id;
      return yield* this.show(id);
    }.bind(this),
    domainEffect,
  );
  claim = (id: Id.IssueId, actor: Id.ExecutionId) => {
    return domainEffect(
      Effect.sync(() => {
        const i = this.issues.get(id)!;
        ensure(!i.assignee || i.assignee === actor, "CLAIM_LOST", "Another worker owns issue");
        i.assignee = Id.ExecutionId.make(actor);
        i.status = "in_progress";
        this.claims++;
      }),
    );
  };
  block(id: Id.IssueId, _execution: Id.ExecutionId, _reason: string) {
    return domainEffect(
      Effect.sync(() => {
        this.issues.get(id)!.status = "blocked";
      }),
    );
  }
  resume(id: Id.IssueId, _execution: Id.ExecutionId) {
    return domainEffect(
      Effect.sync(() => {
        this.issues.get(id)!.status = "in_progress";
      }),
    );
  }
  close(id: Id.IssueId, _execution: Id.ExecutionId) {
    return domainEffect(
      Effect.sync(() => {
        this.issues.get(id)!.status = "closed";
      }),
    );
  }
  history(_id: string) {
    return domainEffect(Effect.sync(() => []));
  }
  add(id: Id.IssueId, repo = Id.RepositoryId.make("api"), deps: Id.IssueId[] = []) {
    this.issues.set(id, {
      id,
      title: id,
      status: "open",
      priority: 1,
      repository_id: Id.RepositoryId.make(repo),
      workflow_policy: "full-openspec",
      request_id: Id.RequestId.make(id),
      description: "",
      dependencies: deps,
    });
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
          schemaName: "spec-driven",
          isPlanningComplete: this.planned,
          isComplete: this.planned,
          artifacts: [
            {
              id: "tasks",
              status: this.planned ? ("done" as const) : ("ready" as const),
              outputPath: "tasks.md",
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
    const profile = _e.configuration_snapshot?.workers[_role] ?? this.profiles[_role];
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
  interrupt(id: Id.SessionId) {
    return domainEffect(
      Effect.sync(() => {
        this.sessions.get(id)!.busy = false;
        this.sessions.get(id)!.outcome = "interrupted";
      }),
    );
  }
  notify() {
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
export const fixture = domainEffect(
  Effect.gen(function* () {
    const root = yield* mkdtemp(join(tmpdir(), "abracode-unit-"));
    yield* mkdir(join(root, ".opencode/agents"), { recursive: true });
    for (const role of ["explore", "apply", "review", "research"])
      yield* writeFile(
        join(root, ".opencode/agents", `${role}.md`),
        yield* readFile(join(process.cwd(), ".opencode/agents", `${role}.md`), "utf8"),
      );
    const runner = new ProcessRunner();
    const git = new Git(runner);
    const store = new MemoryStore();
    const records = new Records(store);
    const locks = new TestLocks();
    const work = new FakeWorkGraph();
    const spec = new FakeSpec();
    const runtime = new FakeRuntime(git);
    const delivery = new FakeDelivery(git);
    const config: Config = yield* decode(
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
    const { controller, setup } = createWorkflow(
      config,
      records,
      work,
      spec,
      git,
      runtime,
      delivery,
      locks,
    );
    return {
      root,
      git,
      records,
      locks,
      work,
      spec,
      runtime,
      delivery,
      config,
      onboarding,
      controller,
      setup,
      close: () =>
        controller.close().pipe(Effect.andThen(rm(root, { recursive: true, force: true }))),
    };
  }),
);
export function planned(f: Effect.Success<typeof fixture>, id = Id.IssueId.make("abra-1")) {
  return domainEffect(
    Effect.gen(function* () {
      f.work.add(id);
      let e = yield* f.controller.start(Id.IssueId.make(id), Id.SessionId.make("ses_supervisor"));
      f.spec.planned = true;
      f.runtime.success(e.explore_session_id!);
      e = yield* f.controller.advance(Id.IssueId.make(id));
      return e;
    }),
  );
}
export function applying(f: Effect.Success<typeof fixture>, id = Id.IssueId.make("abra-1")) {
  return domainEffect(
    Effect.gen(function* () {
      let e = yield* planned(f, id);
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
export function delivered(f: Effect.Success<typeof fixture>, id = Id.IssueId.make("abra-1")) {
  return domainEffect(
    Effect.gen(function* () {
      let e = yield* applying(f, id);
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
