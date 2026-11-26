import { Config as Env, Effect, Option } from "effect";
import { Agent } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import type { Context } from "@opencode/plugin/effect/plugin";
import type {
  AbsolutePath,
  Commit,
  Fingerprint,
  FormId,
  MessageId,
  NativeProjectId,
  QuestionIdentity,
  SessionId,
} from "@abracode/contracts/identities";
import {
  CrewError,
  type Config,
  type ManagedExecution,
  type Project,
  type Role,
  type WorkerModel,
} from "../domain.ts";
import { provideFileSystem } from "../platform.ts";
import { runtimePaths } from "../config/identity.ts";
import { workerProfile } from "../config/snapshot.ts";
import type { Records } from "../storage/store.ts";
import { provisionedEvidence } from "../workflow/evidence.ts";
import type { FinishingTarget } from "../workflow/finishing/contracts.ts";
import { workerBrowser } from "./browser.ts";
import { makeClient, memoSuccessful, OPENCODE_VERSION } from "./client.ts";
import {
  readApproval,
  readDisposition,
  readQuestionAnswer,
  requestApproval,
  requestDisposition,
  requestQuestion,
  type DispositionAnswer,
  type QuestionAnswer,
} from "./forms.ts";
import { nativeDomain, nativeSession, nativeWorktree } from "./native-call.ts";
import { checkWorkerInventory, preflightWorker, validateModelSelection } from "./preflight.ts";
import { leadPermissions, workerPermissions } from "./role-policy.ts";
import {
  observePromptAdmissions,
  observePromptOrigin,
  observeSession,
  type PromptAdmission,
  type PromptIdentity,
  type SessionState,
} from "./session-observer.ts";
import type { WorkerEnvironment } from "./worker-environment.ts";

export { OPENCODE_VERSION, checkWorkerInventory };
export type { DispositionAnswer, PromptAdmission, PromptIdentity, QuestionAnswer, SessionState };

export type SessionIdentity = {
  directory: string;
  agent?: string;
  metadata?: Record<string, unknown>;
};
export interface Runtime {
  managementSession(
    id: SessionId,
    parent: SessionId,
    model: WorkerModel,
    lead: string,
  ): Effect.Effect<void, CrewError>;
  requestDisposition?(
    session: SessionId,
    form: FormId,
    question: string,
    identity: QuestionIdentity,
    target: FinishingTarget,
  ): Effect.Effect<FormId, CrewError>;
  disposition?(
    session: SessionId,
    form: FormId,
    identity: QuestionIdentity,
    target: FinishingTarget,
  ): Effect.Effect<DispositionAnswer, CrewError>;
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
  sessionOwner?(id: SessionId): Effect.Effect<SessionIdentity & { issue_id?: string }, CrewError>;
  session(id: SessionId, assignment?: MessageId): Effect.Effect<SessionState, CrewError>;
  promptAdmissions(
    session: SessionId,
    requests: readonly PromptIdentity[],
  ): Effect.Effect<ReadonlyMap<MessageId, PromptAdmission>, CrewError>;
  promptAdmission(
    session: SessionId,
    message: MessageId,
    text: string,
  ): Effect.Effect<"queued" | "consumed" | "absent", CrewError>;
  prompt(
    id: SessionId,
    text: string,
    messageID: MessageId,
    steer?: boolean,
  ): Effect.Effect<void, CrewError>;
  interrupt(
    id: SessionId,
    promptID?: MessageId,
    additional?: readonly MessageId[],
  ): Effect.Effect<void, CrewError>;
  notify(id: SessionId, text: string, message?: MessageId): Effect.Effect<void, CrewError>;
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
  constructor(
    private ctx: Context,
    private config: Config,
    private records: Pick<Records, "projects" | "store">,
  ) {}

  private cachedClient = memoSuccessful(Effect.suspend(() => this.discoverClient()));
  client = () => this.cachedClient.read;

  private discoverClient = Effect.fn("NativeRuntime.discoverClient")(
    { self: this },
    function* () {
      const password = this.config.server_url
        ? Option.getOrUndefined(yield* Env.option(Env.String("ABRACODE_SERVER_PASSWORD")))
        : undefined;
      const endpoint = this.config.server_url
        ? {
            url: this.config.server_url,
            auth: password
              ? {
                  type: "basic" as const,
                  username: yield* Env.String("ABRACODE_SERVER_USER").pipe(
                    Env.withDefault("opencode"),
                  ),
                  password,
                }
              : undefined,
          }
        : yield* Service.discover({
            file: runtimePaths(this.config.home).service,
            version: OPENCODE_VERSION,
          }).pipe(provideFileSystem);
      if (!endpoint)
        return yield* new CrewError(
          "SERVER_ENDPOINT",
          "Cannot discover native service. Set server_url and ABRACODE_SERVER_PASSWORD for a standalone server",
        );
      return yield* makeClient(endpoint);
    },
    Effect.mapError(CrewError.from),
  );

  requestDisposition = Effect.fn("NativeRuntime.requestDisposition")(
    { self: this },
    function* (
      sessionID: SessionId,
      id: FormId,
      question: string,
      identity: QuestionIdentity,
      target: FinishingTarget,
    ) {
      return yield* requestDisposition(
        yield* this.client(),
        sessionID,
        id,
        question,
        identity,
        target,
      );
    },
  );

  disposition = Effect.fn("NativeRuntime.disposition")(
    { self: this },
    function* (
      sessionID: SessionId,
      formID: FormId,
      identity: QuestionIdentity,
      target: FinishingTarget,
    ) {
      return yield* readDisposition(yield* this.client(), sessionID, formID, identity, target);
    },
  );

  project = Effect.fn("NativeRuntime.project")({ self: this }, function* (path: AbsolutePath) {
    return (yield* nativeDomain((yield* this.client()).location).get({
      location: { directory: path },
    })).project.id;
  });

  inventory = Effect.fn("NativeRuntime.inventory")(
    { self: this },
    function* (projectID: NativeProjectId) {
      return (yield* nativeWorktree(this.ctx).list({ projectID })).map((x) => x.directory);
    },
  );

  createWorktree = Effect.fn("NativeRuntime.createWorktree")(
    { self: this },
    function* (p: Project, e: ManagedExecution, root: AbsolutePath) {
      if (!p.project_id)
        return yield* new CrewError("PROJECT_ID", "Repository not discovered by OpenCode");
      if (!e.base_commit)
        return yield* new CrewError(
          "BASE_COMMIT",
          "Record the fetched base before native provisioning",
        );
      return (yield* nativeWorktree(this.ctx).create({
        projectID: p.project_id,
        from: p.path,
        directory: root,
        name: e.execution_id,
        branch: e.base_commit,
      })).directory;
    },
  );

  removeWorktree = Effect.fn("NativeRuntime.removeWorktree")(
    { self: this },
    function* (p: Project, e: ManagedExecution) {
      const evidence = yield* provisionedEvidence(e);
      if (!(p.project_id && e.worktree_directory))
        return yield* new CrewError("OWNERSHIP", "Missing native ownership");
      yield* nativeWorktree(this.ctx).remove({
        projectID: p.project_id,
        directory: evidence.worktree_directory,
        force: false,
      });
    },
  );

  private permissions = Effect.fn("NativeRuntime.permissions")(
    { self: this },
    function* (e: ManagedExecution, role: Role, id: SessionId) {
      const projects = yield* this.records.projects;
      return workerPermissions(
        role,
        e.configuration_snapshot?.definitions?.[role],
        e.openspec_change,
        [...projects.map((p) => p.path), workerBrowser(this.config.home, id).directory],
      );
    },
  );

  refreshPermissions = Effect.fn("NativeRuntime.refreshPermissions")(
    { self: this },
    function* (e: ManagedExecution, role: Role, id: SessionId) {
      const permissions = yield* this.permissions(e, role, id);
      yield* nativeSession(this.ctx).update({ sessionID: id, permissions });
    },
  );

  managementSession = Effect.fn("NativeRuntime.managementSession")(
    { self: this },
    function* (id: SessionId, parent: SessionId, model: WorkerModel, lead: string) {
      const location = { directory: this.config.home };
      const [agents, models] = yield* Effect.all(
        [
          nativeDomain(this.ctx.agent).list({ location }),
          nativeDomain(this.ctx.model).list({ location }),
        ],
        { concurrency: "unbounded" },
      );
      if (!agents.data.some((a) => a.id === "project-lead"))
        return yield* new CrewError("LEAD_PROFILE", "Static project-lead agent is unavailable");
      yield* validateModelSelection(model, models.data, {
        unavailable: "Project-lead model is unavailable or lacks tools",
        variantUnavailable: () => "Project-lead variant is unavailable",
        capabilityCode: "MODEL_UNAVAILABLE",
        capabilityMessage: "Project-lead model is unavailable or lacks tools",
      });
      const existing = yield* nativeSession(this.ctx)
        .get({ sessionID: id })
        .pipe(
          Effect.catchIf(
            (error) => error.code === "SESSION_NOT_FOUND",
            () => Effect.void,
          ),
        );
      const session =
        existing ??
        (yield* nativeSession(this.ctx).create({
          id,
          parentID: parent,
          title: `Project lead · ${lead}`,
          agent: Agent.ID.make("project-lead"),
          model,
          location,
          metadata: { abracode_lead: lead },
          permissions: leadPermissions(),
        }));
      if (
        session.location.directory !== this.config.home ||
        session.agent !== "project-lead" ||
        session.metadata?.abracode_lead !== lead ||
        session.parentID !== parent ||
        session.model?.providerID !== model.providerID ||
        session.model?.id !== model.id ||
        (session.model?.variant ?? "default") !== (model.variant ?? "default") ||
        JSON.stringify(session.permissions?.map((p) => [p.action, p.resource, p.effect])) !==
          JSON.stringify(leadPermissions().map((p) => [p.action, p.resource, p.effect]))
      )
        return yield* new CrewError(
          "LEAD_SESSION",
          "Retained management session identity conflicts",
        );
    },
  );

  createSession = Effect.fn("NativeRuntime.createSession")(
    { self: this },
    function* (e: ManagedExecution, role: Role, id: SessionId) {
      if (!e.worktree_directory) return yield* new CrewError("WORKTREE", "Missing worktree");
      const profile = workerProfile(e, role, this.config);
      const permissions = yield* this.permissions(e, role, id);
      const session = yield* nativeSession(this.ctx).create({
        id,
        title: `${e.issue_id} · ${role}`,
        location: { directory: e.worktree_directory },
        agent: profile?.agent ?? Agent.ID.make("build"),
        ...((profile?.model ?? e.worker_model)
          ? { model: (profile?.model ?? e.worker_model)! }
          : {}),
        metadata: { abracode: { issue_id: e.issue_id, execution_id: e.execution_id, role } },
        permissions,
      });
      if (session.location.directory !== e.worktree_directory)
        return yield* new CrewError(
          "SESSION_LOCATION",
          "OpenCode created a session at the wrong location",
        );
      return session.id;
    },
  );

  sessionOwner = (id: SessionId) =>
    nativeSession(this.ctx)
      .get({ sessionID: id })
      .pipe(
        Effect.map((info) => {
          const metadata = info.metadata?.abracode;
          const issue_id =
            typeof metadata === "object" &&
            metadata !== null &&
            "issue_id" in metadata &&
            typeof metadata.issue_id === "string"
              ? metadata.issue_id
              : undefined;
          return {
            issue_id,
            directory: info.location.directory,
            agent: info.agent,
            metadata: info.metadata,
          };
        }),
      );

  session = Effect.fn("NativeRuntime.session")(
    { self: this },
    function* (id: SessionId, assignment?: MessageId) {
      return yield* observeSession(
        this.ctx,
        this.records.store,
        yield* this.client(),
        id,
        assignment,
      );
    },
  );

  supervisorModel: (id?: SessionId) => Effect.Effect<WorkerModel | undefined, CrewError> =
    Effect.fn("NativeRuntime.supervisorModel")({ self: this }, function* (id?: SessionId) {
      if (id) {
        const context = yield* nativeSession(this.ctx).context({ sessionID: id });
        const assistant = context.findLast((m) => m.type === "assistant");
        if (assistant?.type === "assistant") return assistant.model;
      }
      const model = (yield* nativeDomain(this.ctx.model).default({
        location: { directory: this.config.home },
      })).data;
      if (!model || !model.enabled)
        return yield* new CrewError(
          "MODEL_UNAVAILABLE",
          "No Supervisor or native default model is available; configure workers.<role>.model",
        );
      return { providerID: model.providerID, id: model.id };
    });

  switchModel = Effect.fn("NativeRuntime.switchModel")(
    { self: this },
    function* (id: SessionId, model: WorkerModel) {
      yield* nativeSession(this.ctx).switchModel({ sessionID: id, model });
    },
  );

  switchAgent = Effect.fn("NativeRuntime.switchAgent")(
    { self: this },
    function* (id: SessionId, agent: Agent.ID) {
      const current = yield* nativeSession(this.ctx).get({ sessionID: id });
      if ((current.agent ?? Agent.ID.make("build")) === agent) return;
      yield* nativeSession(this.ctx).switchAgent({ sessionID: id, agent });
    },
  );

  preflight = Effect.fn("NativeRuntime.preflight")(
    { self: this },
    function* (e: ManagedExecution, role: Role, promptID?: MessageId) {
      return yield* preflightWorker(
        this.ctx,
        this.records.store,
        this.client,
        this.config,
        e,
        role,
        promptID,
      );
    },
  );

  promptAdmission = Effect.fn("NativeRuntime.promptAdmission")(
    { self: this },
    function* (sessionID: SessionId, id: MessageId, text: string) {
      return (yield* this.promptAdmissions(sessionID, [{ prompt_id: id, prompt: text }])).get(id)!;
    },
  );

  promptAdmissions = Effect.fn("NativeRuntime.promptAdmissions")(
    { self: this },
    function* (sessionID: SessionId, requests: readonly PromptIdentity[]) {
      return yield* observePromptAdmissions(this.ctx, yield* this.client(), sessionID, requests);
    },
  );

  prompt = Effect.fn("NativeRuntime.prompt")(
    { self: this },
    function* (sessionID: SessionId, text: string, id: MessageId, steer = false) {
      yield* nativeSession(this.ctx)
        .prompt({
          sessionID,
          id,
          text,
          delivery: steer ? "steer" : "queue",
          metadata: { source: "abracode" },
        })
        .pipe(Effect.uninterruptible);
    },
  );

  interrupt = Effect.fn("NativeRuntime.interrupt")(
    { self: this },
    function* (sessionID: SessionId, promptID?: MessageId, additional: readonly MessageId[] = []) {
      const owned = new Set([...(promptID ? [promptID] : []), ...additional]);
      const client = owned.size ? yield* this.client() : undefined;
      if (client) {
        const pending = yield* nativeDomain(client.session.inbox).list({ sessionID });
        for (const item of pending.filter((item) => owned.has(item.id)))
          yield* nativeDomain(client.session.inbox).cancel({ sessionID, inboxID: item.id });
      }
      const sessions = nativeSession(this.ctx);
      yield* sessions.interrupt({ sessionID, resume: false });
      yield* sessions.wait({ sessionID });
      if (client) {
        if (
          (yield* nativeDomain(client.session.inbox).list({ sessionID })).some((item) =>
            owned.has(item.id),
          )
        )
          return yield* new CrewError(
            "PROMPT_PENDING",
            "Owned prompt remains queued; stop is not confirmed",
          );
      }
    },
  );

  notify = Effect.fn("NativeRuntime.notify")(
    { self: this },
    function* (sessionID: SessionId, text: string, id?: MessageId) {
      if (id) {
        const client = yield* this.client();
        const [inbox, context] = yield* Effect.all(
          [
            nativeDomain(client.session.inbox).list({ sessionID }),
            nativeSession(this.ctx).context({ sessionID }),
          ],
          { concurrency: "unbounded" },
        );
        const pending = inbox.find((item) => item.id === id);
        const recorded = context.find((item) => item.id === id);
        if (pending || recorded) {
          if (
            (pending && (pending.type !== "synthetic" || pending.payload.text !== text)) ||
            (recorded && (recorded.type !== "synthetic" || recorded.text !== text))
          )
            return yield* new CrewError(
              "NOTICE_IDENTITY",
              "Completion notice identity belongs to another message",
            );
          return;
        }
      }
      yield* nativeSession(this.ctx).synthetic({
        sessionID,
        id,
        text,
        metadata: { source: "abracode", notification: true },
      });
    },
  );

  promptOrigin = Effect.fn("NativeRuntime.promptOrigin")(
    { self: this },
    function* (session: SessionId, message: MessageId) {
      return yield* observePromptOrigin(this.ctx, session, message);
    },
  );

  requestQuestion = Effect.fn("NativeRuntime.requestQuestion")(
    { self: this },
    function* (session: SessionId, id: FormId, question: string, identity: QuestionIdentity) {
      return yield* requestQuestion(yield* this.client(), session, id, question, identity);
    },
  );

  questionAnswer = Effect.fn("NativeRuntime.questionAnswer")(
    { self: this },
    function* (session: SessionId, id: FormId) {
      return yield* readQuestionAnswer(yield* this.client(), session, id);
    },
  );

  requestApproval = Effect.fn("NativeRuntime.requestApproval")(
    { self: this },
    function* (sessionID: SessionId, id: FormId, title: string, fingerprint: Fingerprint | Commit) {
      return yield* requestApproval(yield* this.client(), sessionID, id, title, fingerprint);
    },
  );

  approval: (
    sessionID: SessionId,
    formID: FormId,
  ) => Effect.Effect<"pending" | "approved" | "rejected", CrewError> = Effect.fn(
    "NativeRuntime.approval",
  )({ self: this }, function* (sessionID: SessionId, formID: FormId) {
    return yield* readApproval(yield* this.client(), sessionID, formID);
  });
}
