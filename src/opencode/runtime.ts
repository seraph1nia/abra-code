import { workerProfile } from "../config/snapshot.ts";
import { readWorkerContext, compatibleContext } from "../workflow/worker-context.ts";
import { resolveSkills, awaitWorkerPlugin, type WorkerEnvironment } from "./worker-environment.ts";
import { nativePermissions } from "./role-policy.ts";
import { workerBrowser } from "./browser.ts";
import { provisionedEvidence } from "../workflow/evidence.ts";
import {
  StorageKey,
  ToolName,
  Timestamp,
  QuestionIdentity,
  AbsolutePath,
  ActivityId,
  Fingerprint,
  Commit,
  FormId,
  MessageId,
  NativeProjectId,
  SessionId,
} from "../identities.ts";

import { provideFileSystem } from "../platform.ts";
import { makeClient, memoSuccessful } from "./client.ts";
import { domainEffect } from "../effect.ts";
import {
  CrewError,
  type Config,
  type ManagedExecution,
  type Project,
  type Role,
  type WorkerModel,
  type WorkerError,
} from "../domain.ts";
import { Effect, Schema } from "effect";
import { Session, SessionMessage, Agent, Model } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { type Context } from "@opencode/plugin/effect/plugin";
import { Records, NativeStore } from "../storage/store.ts";
import { decode } from "../decode.ts";
import { WorkerModelSchema } from "../contracts.ts";

import { diagnosticText, summarizeContext, type MessageSummary } from "./diagnostics.ts";
export interface SessionState {
  activity?: { identity: ActivityId; at: number; summary: string };
  id: SessionId;
  directory: AbsolutePath;
  outcome?: typeof Session.Info.Type.outcome;
  busy: boolean;
  metadata?: Record<string, unknown>;
  model?: WorkerModel;
  agent?: Agent.ID;
  error?: WorkerError;
  error_at?: number;
  diagnostic_error?: string;
  recent_messages?: MessageSummary[];
  available_tools?: {
    model: WorkerModel;
    names: ToolName[];
    at: Timestamp;
  };
}
export type QuestionAnswer =
  | { status: "pending" | "cancelled"; answer?: never }
  | { status: "answered"; answer: string };
export interface Runtime {
  preflight(
    e: ManagedExecution,
    role: Role,
    promptID?: MessageId,
  ): Effect.Effect<WorkerEnvironment | void, CrewError>;
  promptOrigin(
    session: SessionId,
    message: MessageId,
  ): Effect.Effect<MessageId | undefined, CrewError>;
  project(path: AbsolutePath): Effect.Effect<NativeProjectId, CrewError>;
  inventory(project: NativeProjectId): Effect.Effect<AbsolutePath[], CrewError>;
  createWorktree(
    p: Project,
    e: ManagedExecution,
    root: AbsolutePath,
  ): Effect.Effect<AbsolutePath, CrewError>;
  removeWorktree(p: Project, e: ManagedExecution): Effect.Effect<void, CrewError>;
  createSession(
    e: ManagedExecution,
    role: Role,
    id: SessionId,
  ): Effect.Effect<SessionId, CrewError>;
  refreshPermissions(
    e: ManagedExecution,
    role: Role,
    id: SessionId,
  ): Effect.Effect<void, CrewError>;
  supervisorModel(id?: SessionId): Effect.Effect<WorkerModel | undefined, CrewError>;
  switchModel(id: SessionId, model: WorkerModel): Effect.Effect<void, CrewError>;
  switchAgent(id: SessionId, agent: Agent.ID): Effect.Effect<void, CrewError>;
  session(id: SessionId): Effect.Effect<SessionState, CrewError>;
  prompt(
    id: SessionId,
    text: string,
    messageID: MessageId,
    steer?: boolean,
  ): Effect.Effect<void, CrewError>;
  interrupt(id: SessionId, promptID?: MessageId): Effect.Effect<void, CrewError>;
  notify(id: SessionId, text: string): Effect.Effect<void, CrewError>;
  requestQuestion(
    session: SessionId,
    formID: FormId,
    question: string,
    identity: QuestionIdentity,
  ): Effect.Effect<FormId, CrewError>;
  questionAnswer(session: SessionId, formID: FormId): Effect.Effect<QuestionAnswer, CrewError>;
  requestApproval(
    session: SessionId,
    formID: FormId,
    title: string,
    fingerprint: Fingerprint | Commit,
  ): Effect.Effect<FormId, CrewError>;
  approval(
    session: SessionId,
    form: FormId,
  ): Effect.Effect<"pending" | "approved" | "rejected", CrewError>;
}
export class NativeRuntime implements Runtime {
  // Construct only the lazy cache here, never a discovery request during setup.
  private acquired = Effect.runSync(memoSuccessful(Effect.suspend(() => this.discoverClient())));
  constructor(
    private ctx: Context,
    private config: Config,
  ) {}
  client = Effect.fn("NativeRuntime.client")(() => this.acquired);
  private discoverClient = Effect.fn("NativeRuntime.discoverClient")(
    function* (this: NativeRuntime) {
      const endpoint = this.config.server_url
        ? {
            url: this.config.server_url,
            auth: process.env.ABRACODE_SERVER_PASSWORD
              ? {
                  type: "basic" as const,
                  username: process.env.ABRACODE_SERVER_USER ?? "opencode",
                  password: process.env.ABRACODE_SERVER_PASSWORD,
                }
              : undefined,
          }
        : yield* Service.discover().pipe(provideFileSystem);
      if (!endpoint)
        return yield* new CrewError(
          "SERVER_ENDPOINT",
          "Cannot discover native service. Set server_url and ABRACODE_SERVER_PASSWORD for a standalone server",
        );
      return yield* makeClient(endpoint);
    }.bind(this),
    domainEffect,
  );
  project = Effect.fn("NativeRuntime.project")(
    function* (this: NativeRuntime, path: AbsolutePath) {
      return (yield* (yield* this.client()).location.get({
        location: { directory: path },
      })).project.id;
    }.bind(this),
    domainEffect,
  );
  inventory = Effect.fn("NativeRuntime.inventory")(
    function* (this: NativeRuntime, projectID: NativeProjectId) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      return (yield* this.ctx.worktree
        .list({ projectID: projectID })
        .pipe(Effect.mapError(CrewError.from))).map((x) => x.directory);
    }.bind(this),
    domainEffect,
  );
  createWorktree = Effect.fn("NativeRuntime.createWorktree")(
    function* (this: NativeRuntime, p: Project, e: ManagedExecution, root: AbsolutePath) {
      if (!p.project_id)
        return yield* new CrewError("PROJECT_ID", "Repository not discovered by OpenCode");
      if (!e.base_commit)
        return yield* new CrewError(
          "BASE_COMMIT",
          "Record the fetched base before native provisioning",
        );
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      return (yield* this.ctx.worktree
        .create({
          projectID: p.project_id,
          from: p.path,
          directory: root,
          name: e.execution_id,
          branch: e.base_commit,
        })
        .pipe(Effect.mapError(CrewError.from))).directory;
    }.bind(this),
    domainEffect,
  );
  removeWorktree = Effect.fn("NativeRuntime.removeWorktree")(
    function* (this: NativeRuntime, p: Project, e: ManagedExecution) {
      const evidence = yield* provisionedEvidence(e);
      if (!(p.project_id && e.worktree_directory))
        return yield* new CrewError("OWNERSHIP", "Missing native ownership");
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.worktree
        .remove({
          projectID: p.project_id,
          directory: evidence.worktree_directory,
          force: false,
        })
        .pipe(Effect.mapError(CrewError.from));
    }.bind(this),
    domainEffect,
  );
  private permissions = Effect.fn("NativeRuntime.permissions")(
    function* (this: NativeRuntime, e: ManagedExecution, role: Role, id: SessionId) {
      const projects = yield* new Records(new NativeStore(this.ctx.storage)).projects();
      return nativePermissions(role, e.openspec_change, [
        ...projects.map((p) => p.path),
        workerBrowser(this.config.home, id).directory,
      ]);
    }.bind(this),
    domainEffect,
  );
  refreshPermissions = Effect.fn("NativeRuntime.refreshPermissions")(
    function* (this: NativeRuntime, e: ManagedExecution, role: Role, id: SessionId) {
      const permissions = yield* this.permissions(e, role, id);
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Public native session updates declare unknown failures; preserve the adapter boundary.
      yield* this.ctx.session
        .update({ sessionID: id, permissions })
        .pipe(Effect.mapError(CrewError.from));
    }.bind(this),
    domainEffect,
  );
  createSession = Effect.fn("NativeRuntime.createSession")(
    function* (this: NativeRuntime, e: ManagedExecution, role: Role, id: SessionId) {
      if (!e.worktree_directory) return yield* new CrewError("WORKTREE", "Missing worktree");
      const profile = workerProfile(e, role, this.config);
      const permissions = yield* this.permissions(e, role, id);
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      const session = yield* this.ctx.session
        .create({
          id: id,
          title: `${e.issue_id} · ${role}`,
          location: { directory: e.worktree_directory! },
          agent: profile?.agent ?? Agent.ID.make("build"),
          ...((profile?.model ?? e.worker_model)
            ? { model: (profile?.model ?? e.worker_model)! }
            : {}),
          metadata: { abracode: { issue_id: e.issue_id, execution_id: e.execution_id, role } },
          permissions,
        })
        .pipe(Effect.mapError(CrewError.from));
      if (!(session.location.directory === e.worktree_directory))
        return yield* new CrewError(
          "SESSION_LOCATION",
          "OpenCode created a session at the wrong location",
        );
      return session.id;
    }.bind(this),
    domainEffect,
  );
  session = Effect.fn("NativeRuntime.session")(
    function* (this: NativeRuntime, id: SessionId) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      const s = yield* this.ctx.session
        .get({ sessionID: id })
        .pipe(Effect.mapError(CrewError.from));
      const client = yield* this.client();
      const active = yield* client.session.active();
      const pending = yield* client.session.inbox.list({ sessionID: id });
      let diagnostic_error: string | undefined;
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      const context = yield* this.ctx.session.context({ sessionID: id }).pipe(
        Effect.catch((error) =>
          domainEffect(
            Effect.sync(() => {
              diagnostic_error = diagnosticText(CrewError.from(error).message);
              return [];
            }),
          ),
        ),
        Effect.mapError(CrewError.from),
      );
      return {
        id: s.id,
        agent: s.agent ?? Agent.ID.make("build"),
        directory: s.location.directory,
        outcome: s.outcome,
        busy: !!active[id] || pending.length > 0,
        metadata: s.metadata,
        ...summarizeContext(yield* Schema.encodeEffect(Schema.Array(SessionMessage.Info))(context)),
        available_tools: yield* new NativeStore(this.ctx.storage)
          .get(StorageKey.make(`worker-tools/${id}`))
          .pipe(
            Effect.flatMap((value) =>
              decode(
                Schema.UndefinedOr(
                  Schema.Struct({
                    model: WorkerModelSchema,
                    names: Schema.mutable(Schema.Array(ToolName)),
                    at: Timestamp,
                  }),
                ),
                value,
                `worker-tools/${id}`,
              ),
            ),
          ),
        ...(diagnostic_error ? { diagnostic_error } : {}),
      };
    }.bind(this),
    domainEffect,
  );
  supervisorModel: (id?: SessionId) => Effect.Effect<WorkerModel | undefined, CrewError> =
    Effect.fn("NativeRuntime.supervisorModel")(
      function* (this: NativeRuntime, id?: SessionId) {
        if (id) {
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
          const context = yield* this.ctx.session
            .context({ sessionID: id })
            .pipe(Effect.mapError(CrewError.from));
          const assistant = context.findLast((m) => m.type === "assistant");
          if (assistant?.type === "assistant") return assistant.model;
        }
        const model = (yield* (yield* this.client()).model.default({
          location: { directory: this.config.home },
        })).data;
        if (!model || !model.enabled)
          return yield* new CrewError(
            "MODEL_UNAVAILABLE",
            "No Supervisor or native default model is available; configure workers.<role>.model",
          );
        return { providerID: model.providerID, id: model.id };
      }.bind(this),
      domainEffect,
    );
  switchModel = Effect.fn("NativeRuntime.switchModel")(
    function* (this: NativeRuntime, id: SessionId, model: WorkerModel) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.session
        .switchModel({ sessionID: id, model: model })
        .pipe(Effect.mapError(CrewError.from));
    }.bind(this),
    domainEffect,
  );
  switchAgent = Effect.fn("NativeRuntime.switchAgent")(
    function* (this: NativeRuntime, id: SessionId, agent: Agent.ID) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Public native session operations declare unknown failures; retain the typed adapter boundary.
      const current = yield* this.ctx.session
        .get({ sessionID: id })
        .pipe(Effect.mapError(CrewError.from));
      if ((current.agent ?? Agent.ID.make("build")) === agent) return;
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Public native session operations declare unknown failures; retain the typed adapter boundary.
      yield* this.ctx.session
        .switchAgent({ sessionID: id, agent })
        .pipe(Effect.mapError(CrewError.from));
    }.bind(this),
    domainEffect,
  );
  preflight = Effect.fn("NativeRuntime.preflight")(
    function* (this: NativeRuntime, e: ManagedExecution, role: Role, promptID?: MessageId) {
      if (!e.worktree_directory)
        return yield* new CrewError("WORKTREE", "Worker inventory requires the owned worktree");
      const client = yield* this.client();
      const sessionID = e[`${role}_session_id`];
      if (promptID && sessionID) {
        const admitted = yield* Effect.all([
          client.session.inbox.list({ sessionID }),
          client.session.context({ sessionID }),
        ]);
        if (
          admitted[0].some((item) => item.id === promptID) ||
          admitted[1].some((message) => message.id === promptID)
        )
          return;
      }
      const captured =
        promptID && e.worker_context_id
          ? yield* readWorkerContext(new NativeStore(this.ctx.storage), e.worker_context_id)
          : undefined;
      if (captured) {
        if (!sessionID || !promptID)
          return yield* new CrewError(
            "CONTEXT_ASSIGNMENT",
            "Captured context lacks a retained native admission identity",
          );
        compatibleContext(captured, {
          execution_id: e.execution_id,
          generation: e.control_generation,
          role,
          session_id: sessionID,
          prompt_id: promptID,
        });
      }
      const profile = captured
        ? {
            agent: captured.environment.agent,
            model: captured.environment.model,
            required_skills: captured.environment.skills
              .filter((skill) => skill.source !== "role-policy")
              .map((skill) => skill.id),
            required_tools: captured.environment.tools.filter(
              (group) => group.source !== "role-policy",
            ),
          }
        : workerProfile(e, role, this.config);
      const location = { directory: e.worktree_directory };
      yield* awaitWorkerPlugin(
        client.plugin.list({ location }).pipe(
          Effect.map((inventory) => inventory.data),
          Effect.mapError(
            () =>
              new CrewError(
                "INVENTORY_UNAVAILABLE",
                "Worker-location plugin inventory unavailable; retry after native activation",
              ),
          ),
        ),
      );
      const [agents, models, skills] = yield* Effect.all(
        [
          client.agent.list({ location }),
          client.model.list({ location }),
          client.skill.list({ location }),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError(
          () =>
            new CrewError(
              "INVENTORY_UNAVAILABLE",
              "Worker-location inventory unavailable; preserve the admission intent and retry after repair",
            ),
        ),
      );
      const selected = yield* checkWorkerInventory(
        profile,
        e.worker_model,
        role,
        agents.data,
        models.data,
      );
      return {
        ...selected,
        ...(yield* resolveSkills(
          role,
          e.workflow_policy,
          profile,
          skills.data,
          e.worktree_directory,
        )),
      };
    }.bind(this),
    domainEffect,
  );
  prompt = Effect.fn("NativeRuntime.prompt")(
    function* (
      this: NativeRuntime,
      sessionID: SessionId,
      text: string,
      id: MessageId,
      steer = false,
    ) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.session
        .prompt({
          sessionID: sessionID,
          id: id,
          text,
          delivery: steer ? "steer" : "queue",
          metadata: { source: "abracode" },
        })
        .pipe(Effect.mapError(CrewError.from), Effect.uninterruptible);
    }.bind(this),
    domainEffect,
  );
  interrupt = Effect.fn("NativeRuntime.interrupt")(
    function* (this: NativeRuntime, sessionID: SessionId, promptID?: MessageId) {
      const client = promptID ? yield* this.client() : undefined;
      if (client && promptID) {
        const pending = yield* client.session.inbox.list({ sessionID: sessionID });
        if (pending.some((item) => item.id === promptID))
          yield* client.session.inbox.cancel({
            sessionID: sessionID,
            inboxID: promptID,
          });
      }
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.session
        .interrupt({ sessionID: sessionID, resume: false })
        .pipe(Effect.mapError(CrewError.from));
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.session.wait({ sessionID: sessionID }).pipe(Effect.mapError(CrewError.from));
      if (client && promptID) {
        if (
          (yield* client.session.inbox.list({ sessionID: sessionID })).some(
            (item) => item.id === promptID,
          )
        )
          return yield* new CrewError(
            "PROMPT_PENDING",
            "Owned prompt remains queued; stop is not confirmed",
          );
      }
    }.bind(this),
    domainEffect,
  );
  notify = Effect.fn("NativeRuntime.notify")(
    function* (this: NativeRuntime, sessionID: SessionId, text: string) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      yield* this.ctx.session
        .synthetic({
          sessionID: sessionID,
          text,
          metadata: { source: "abracode", notification: true },
        })
        .pipe(Effect.mapError(CrewError.from));
    }.bind(this),
    domainEffect,
  );
  promptOrigin = Effect.fn("NativeRuntime.promptOrigin")(
    function* (this: NativeRuntime, session: SessionId, message: MessageId) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native context is schema-decoded upstream; normalize its declared unknown error.
      const context = yield* this.ctx.session
        .context({ sessionID: session })
        .pipe(Effect.mapError(CrewError.from));
      const index = context.findIndex((m) => m.id === message);
      if (index < 0) return;
      return context.slice(0, index + 1).findLast((m) => m.type === "user")?.id;
    }.bind(this),
    domainEffect,
  );
  requestQuestion = Effect.fn("NativeRuntime.requestQuestion")(
    function* (
      this: NativeRuntime,
      session: SessionId,
      id: FormId,
      question: string,
      identity: QuestionIdentity,
    ) {
      const forms = (yield* this.client()).session.form;
      const existing = yield* forms
        .get({ sessionID: session, formID: id })
        .pipe(Effect.catchTag("FormNotFoundError", () => Effect.void));
      if (existing) {
        if (!(existing.metadata?.decision_identity === identity))
          return yield* new CrewError("DECISION_FORM", "Form belongs to another question");
        return existing.id;
      }
      return (yield* forms.create({
        sessionID: session,
        id: id,
        title: question.slice(0, 512),
        metadata: { source: "abracode", decision_identity: identity },
        fields: [
          {
            key: "answer",
            type: "string",
            required: true,
            minLength: 1,
            maxLength: 8192,
            title: "Answer this question",
          },
        ],
      })).id;
    }.bind(this),
    domainEffect,
  );
  questionAnswer = Effect.fn("NativeRuntime.questionAnswer")(
    function* (this: NativeRuntime, session: SessionId, id: FormId) {
      const form = yield* (yield* this.client()).session.form.get({
        sessionID: session,
        formID: id,
      });
      if (form.state.status === "cancelled") return { status: "cancelled" as const };
      if (form.state.status !== "answered") return { status: "pending" as const };
      const answer = form.state.answer.answer;
      if (!(typeof answer === "string" && answer.length > 0 && answer.length <= 8192))
        return yield* new CrewError("DECISION_ANSWER", "Invalid native question answer");
      return { status: "answered" as const, answer };
    }.bind(this),
    domainEffect,
  );
  requestApproval = Effect.fn("NativeRuntime.requestApproval")(
    function* (
      this: NativeRuntime,
      sessionID: SessionId,
      id: FormId,
      title: string,
      fingerprint: Fingerprint | Commit,
    ) {
      const forms = (yield* this.client()).session.form;
      const existing = yield* forms
        .get({ sessionID: sessionID, formID: id })
        .pipe(Effect.catchTag("FormNotFoundError", () => Effect.void));
      if (existing) {
        if (!(existing.metadata?.fingerprint === fingerprint))
          return yield* new CrewError(
            "APPROVAL_FORM",
            "Existing native form belongs to another checkpoint",
          );
        return existing.id;
      }
      return (yield* forms.create({
        sessionID: sessionID,
        id: id,
        title,
        metadata: { source: "abracode", fingerprint },
        fields: [
          {
            key: "authorize",
            type: "boolean",
            required: true,
            title: "Authorize this exact checkpoint",
            default: false,
          },
        ],
      })).id;
    }.bind(this),
    domainEffect,
  );
  approval: (
    sessionID: SessionId,
    formID: FormId,
  ) => Effect.Effect<"pending" | "approved" | "rejected", CrewError> = Effect.fn(
    "NativeRuntime.approval",
  )(
    function* (this: NativeRuntime, sessionID: SessionId, formID: FormId) {
      const f = yield* (yield* this.client()).session.form.get({
        sessionID: sessionID,
        formID: formID,
      });
      return f.state.status === "answered"
        ? f.state.answer.authorize === true
          ? "approved"
          : "rejected"
        : f.state.status === "cancelled"
          ? "rejected"
          : "pending";
    }.bind(this),
    domainEffect,
  );
}

/** Validate only the native inventory fields needed for admission. */
export const checkWorkerInventory = (
  profile: Config["workers"][Role],
  inherited: WorkerModel | undefined,
  role: Role,
  agents: readonly Pick<Agent.Info, "id" | "model">[],
  models: readonly Pick<
    Model.Info,
    "id" | "providerID" | "variants" | "capabilities" | "enabled"
  >[],
) =>
  Effect.gen(function* () {
    const agentID = profile?.agent ?? Agent.ID.make("build");
    const agent: Pick<Agent.Info, "id" | "model"> | undefined =
      agents.find((a) => a.id === agentID) ??
      (profile?.agent === undefined ? Agent.Info.default(agentID) : undefined);
    if (!agent)
      return yield* new CrewError(
        "AGENT_UNAVAILABLE",
        `Configured ${role} agent ${agentID} is absent from the worker location (available: ${agents
          .map((a) => a.id)
          .join(",")
          .slice(0, 512)})`,
      );
    const selected = profile?.model ?? inherited ?? agent.model;
    if (!selected)
      return yield* new CrewError(
        "MODEL_UNAVAILABLE",
        "No effective worker model is selected; preserve the admission intent",
      );
    const model = models.find((m) => m.providerID === selected.providerID && m.id === selected.id);
    if (!model || !model.enabled)
      return yield* new CrewError(
        "MODEL_UNAVAILABLE",
        `Selected ${role} model is absent from the worker location`,
      );
    if (
      selected.variant &&
      selected.variant !== "default" &&
      !model.variants.some((v) => v.id === selected.variant)
    )
      return yield* new CrewError(
        "MODEL_VARIANT_UNAVAILABLE",
        `Selected model variant ${selected.variant} is absent from the worker location (${model.variants.map((v) => v.id).join(",")})`,
      );
    if (!model.capabilities.tools)
      return yield* new CrewError(
        "MODEL_CAPABILITY",
        "The selected worker model does not support tools",
      );
    return { agent: agentID, model: selected };
  });
