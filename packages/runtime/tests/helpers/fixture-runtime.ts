import { capabilityRequirements } from "../../src/opencode/role-policy.ts";
import { workerProfile } from "../../src/config/snapshot.ts";
import { type WorkerEnvironment } from "../../src/opencode/worker-environment.ts";
import { Agent } from "@opencode/schema/agent";
import {
  type DispositionAnswer,
  type QuestionAnswer,
  type Runtime,
  type SessionState,
} from "../../src/opencode/runtime.ts";
import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "../effects.ts";
import { Effect } from "effect";
import { mkdir } from "../../src/filesystem.ts";
import { join } from "node:path";
import { Git } from "../../src/git/repository.ts";
import {
  CrewError,
  ensure,
  type Config,
  type ManagedExecution,
  type Project,
  type Role,
  type WorkerModel,
} from "../../src/domain.ts";

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
    requests: readonly import("../../src/opencode/runtime.ts").PromptIdentity[],
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
