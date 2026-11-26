import { sha256 } from "../digest.ts";
import type {
  ScopedMemorySearch,
  ScopedMemoryRead,
  MemoryPublication,
} from "@abracode/contracts/visibility/memory";
import type { PublicationQuery } from "@abracode/contracts/presentation/contracts";
import type { Submission } from "@abracode/contracts/web/workspace-wire";
import type {
  ReviewSelection,
  ReviewAssetQuerySchema,
  ReviewSubmit,
  ReviewResponseQuerySchema,
} from "@abracode/contracts/web/reviews";
import type { PrepareDiagramSelection } from "@abracode/contracts/web/diagram-actions";
import { NativeSessionReader } from "../opencode/agui/source.ts";
import { type NativeEventEnvelope } from "../opencode/agui/native-state.ts";
import { projectNativeMessage } from "../opencode/agui/messages.ts";
import type { ChangeScope } from "@abracode/contracts/web/changes";
import { checkpointMatchesForm } from "./form-binding.ts";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "@abracode/contracts/web/report-actions";
import { workerHistoryMessage } from "@abracode/contracts/web/worker-history";
import { Effect, Schema, Stream } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import type { SessionMessage } from "@opencode/schema/session-message";
import { type Endpoint } from "@opencode/client/effect/service";
import { CrewError } from "../domain.ts";
import {
  AbsolutePath,
  IssueId,
  MessageId,
  SessionId,
  timestamp,
} from "@abracode/contracts/identities";
import { makeClient, memoSuccessful } from "../opencode/client.ts";
import { WorkSnapshotSchema } from "@abracode/contracts/web/wire";
import { WorkspaceSnapshotSchema } from "@abracode/contracts/web/workspace-wire";
import { decode } from "../decode.ts";
import { visibility } from "../visibility/protocol.ts";
import { webGateway } from "./protocol.ts";
import type { AttentionForm, WebBackend, WorkQueries, WorkspaceSnapshot } from "./contracts.ts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { toolPresentation } from "./tool-presentation.ts";
import { nativeRpcError, readWorkReport } from "./native-errors.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { isTransportFailure, nativeChanges } from "./native-changes.ts";
export const fingerprint = (value: unknown) => sha256(canonicalJSON(value));
export const projectMessage = (message: SessionMessage.Info) =>
  projectNativeMessage(message, toolPresentation);

export class NativeWebBackend implements WebBackend {
  private lastObservation?: WorkspaceSnapshot;
  private lastValidWork?: WorkspaceSnapshot["work"];
  private cachedClient?: OpenCodeClient;
  readonly sessionID: SessionId;
  private reader: NativeSessionReader;
  private workerCursors = new Set<string>();
  constructor(
    private home: AbsolutePath,
    sessionID: string,
    private discover: Effect.Effect<Endpoint | undefined, CrewError>,
  ) {
    this.sessionID = SessionId.make(sessionID);
    this.reader = new NativeSessionReader(
      this.sessionID,
      () => this.connection().pipe(Effect.mapError(nativeRpcError)),
      toolPresentation,
    );
  }
  private verifySession = (client: OpenCodeClient) =>
    Effect.gen({ self: this }, function* () {
      const session = yield* client.session.get({ sessionID: this.sessionID });
      if (
        session.agent !== "abra" ||
        session.location.directory !== this.home ||
        session.metadata?.abracode_supervisor_home !== this.home
      )
        return yield* new CrewError(
          "ABRA_REQUIRED",
          "The central Abra session changed; reopen the frontend",
        );
      return session;
    });
  private createConnection = () =>
    Effect.gen({ self: this }, function* () {
      const endpoint = yield* this.discover;
      if (!endpoint) return yield* new CrewError("WEB_SERVICE", "AbraCode service unavailable");
      const url = URL.parse(endpoint.url);
      if (
        !url ||
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        return yield* new CrewError("WEB_SERVICE", "Expected this installation's local service");
      const client = yield* makeClient(endpoint);
      const session = yield* this.verifySession(client);
      this.cachedClient = client;
      return { client, session };
    });
  private discovery = memoSuccessful(Effect.suspend(() => this.createConnection()));
  private discoverConnection = () => this.discovery.read;
  private forget(client: OpenCodeClient) {
    return Effect.suspend(() => {
      if (this.cachedClient !== client) return Effect.void;
      this.cachedClient = undefined;
      return this.discovery.invalidate;
    });
  }
  private connection = () =>
    Effect.suspend(() => {
      const cached = this.cachedClient;
      if (!cached) return this.discoverConnection();
      return this.verifySession(cached).pipe(
        Effect.map((session) => ({ client: cached, session })),
        Effect.catchIf(isTransportFailure, () =>
          this.forget(cached).pipe(Effect.andThen(this.discoverConnection)),
        ),
      );
    });
  private client = () =>
    Effect.suspend(() =>
      this.cachedClient
        ? Effect.succeed(this.cachedClient)
        : this.discoverConnection().pipe(Effect.map(({ client }) => client)),
    );
  private use<A, E>(fn: (client: OpenCodeClient) => Effect.Effect<A, E>, retryRead = false) {
    const invoke = (
      retry: boolean,
    ): Effect.Effect<A, E | Effect.Error<ReturnType<typeof this.client>>> =>
      this.client().pipe(
        Effect.flatMap((client) =>
          fn(client).pipe(
            Effect.catchIf(
              (cause: E) => isTransportFailure(cause),
              (cause) =>
                this.forget(client).pipe(
                  Effect.andThen(() => (retry ? invoke(false) : Effect.fail(cause))),
                ),
            ),
          ),
        ),
      );
    return invoke(retryRead).pipe(Effect.mapError(nativeRpcError));
  }
  private read<A, E>(fn: (client: OpenCodeClient) => Effect.Effect<A, E>) {
    return this.use(fn, true);
  }
  private gateway(client: OpenCodeClient) {
    return client.rpc(webGateway);
  }
  private gatewayCall<I extends object, A, E>(
    mode: "read" | "write",
    select: (
      rpc: ReturnType<NativeWebBackend["gateway"]>,
    ) => (
      payload: NoInfer<I> & { session_id: SessionId },
      options: ReturnType<NativeWebBackend["location"]>,
    ) => Effect.Effect<A, E>,
    input: I,
  ) {
    return this.use(
      (client) =>
        select(this.gateway(client))({ ...input, session_id: this.sessionID }, this.location()),
      mode === "read",
    );
  }
  readonly memoryEnabled = Effect.suspend(() =>
    this.gatewayCall("read", (rpc) => rpc.memoryEnabled, {}),
  );
  memorySearch = (input: typeof ScopedMemorySearch.Type) =>
    this.gatewayCall("read", (rpc) => rpc.memorySearch, input);
  memoryRead = (input: typeof ScopedMemoryRead.Type) =>
    this.gatewayCall("read", (rpc) => rpc.memoryRead, input);
  memoryPublish = (input: MemoryPublication) =>
    this.gatewayCall("write", (rpc) => rpc.memoryPublish, input);
  readonly agents = Effect.suspend(() => this.gatewayCall("read", (rpc) => rpc.agents, {}));
  readonly repositories = Effect.suspend(() => this.gatewayCall("read", (rpc) => rpc.projects, {}));
  private location() {
    return { location: { directory: this.home } };
  }
  readonly reviews = {
    receipt: (selection: typeof ReviewResponseQuerySchema.Type) =>
      this.gatewayCall("read", (rpc) => rpc.reviewReceipt, selection),
    list: (issue?: string) =>
      this.gatewayCall(
        "read",
        (rpc) => rpc.reviewList,
        issue ? { issue_id: IssueId.make(issue) } : {},
      ),
    read: (selection: ReviewSelection) => this.gatewayCall("read", (rpc) => rpc.review, selection),
    asset: (selection: typeof ReviewAssetQuerySchema.Type) =>
      this.gatewayCall("read", (rpc) => rpc.reviewAsset, selection),
    submit: (input: ReviewSubmit) => this.gatewayCall("write", (rpc) => rpc.reviewSubmit, input),
  };
  private checkpoint(client: OpenCodeClient, form: Form.Info) {
    return Effect.gen({ self: this }, function* () {
      if (form.metadata?.source !== "abracode") return undefined;
      return yield* this.gateway(client).checkpoint(
        { session_id: this.sessionID, form_id: form.id },
        this.location(),
      );
    });
  }
  private attentionForm(client: OpenCodeClient, form: Form.Info) {
    return Effect.gen({ self: this }, function* () {
      const checkpoint = yield* this.checkpoint(client, form);
      const active = checkpointMatchesForm(form, checkpoint);
      return {
        form,
        checkpoint,
        active,
        binding: fingerprint(form),
      } satisfies AttentionForm;
    });
  }
  observe = (scope: ChangeScope) =>
    Effect.suspend(() =>
      this.reader
        .read({
          transcript: !this.lastObservation || scope.all || scope.transcript,
          inbox: !this.lastObservation || scope.all || scope.admissions || scope.transcript,
        })
        .pipe(
          Effect.filterOrElse(
            (native) => !native.repair,
            () => this.reader.read({ transcript: true, inbox: true }),
          ),
          Effect.filterOrFail(
            (native) => !native.repair,
            () =>
              new CrewError(
                "WEB_OBSERVATION",
                "Native transcript changed while recovering. Reconnect for a fresh observation.",
              ),
          ),
          Effect.flatMap((native) =>
            Effect.gen({ self: this }, function* () {
              const { client, session, page, inbox } = native;
              const prior = this.lastObservation;
              const all = !prior || scope.all;
              const transcript = all || scope.transcript;
              const attention = all || scope.attention;
              const workChanged = all || scope.work_all || scope.finder || scope.issues?.length;

              const rpc = this.gateway(client),
                opts = this.location();
              const selection = {
                receipts: !!(all || scope.admissions),
                surfaces: !!(all || scope.presentations),
                projects: !!(all || scope.projects),
                ...(all || scope.presentations || transcript
                  ? {
                      message_ids:
                        page?.data.map((message) => message.id) ??
                        this.reader
                          .current()
                          ?.messages.map((message) => MessageId.make(message.id)) ??
                        [],
                    }
                  : {}),
              };
              const { forms, permissions, observedWork, sections } = yield* Effect.all(
                {
                  forms: attention
                    ? client.session.form.list({ sessionID: this.sessionID }).pipe(
                        Effect.flatMap((forms) =>
                          Effect.forEach(forms, (form) => this.attentionForm(client, form), {
                            concurrency: 4,
                          }),
                        ),
                      )
                    : Effect.undefined,
                  permissions: attention
                    ? client.permission.list({ sessionID: this.sessionID })
                    : Effect.undefined,
                  observedWork: workChanged
                    ? client
                        .rpc(visibility)
                        .snapshot({}, opts)
                        .pipe(
                          Effect.flatMap((work) =>
                            decode(WorkSnapshotSchema, work, "Retained work observation"),
                          ),
                          Effect.result,
                        )
                    : Effect.undefined,
                  sections:
                    selection.receipts ||
                    selection.surfaces ||
                    selection.projects ||
                    selection.message_ids
                      ? rpc.observeSections({ session_id: this.sessionID, ...selection }, opts)
                      : Effect.undefined,
                },
                { concurrency: 4 },
              );
              if (observedWork?._tag === "Success") this.lastValidWork = observedWork.success;
              const work = this.lastValidWork ?? {
                home: this.home,
                at: yield* timestamp,
                work: [],
              };
              const value = yield* decode(
                WorkspaceSnapshotSchema,
                {
                  session_id: this.sessionID,
                  agent_id: "abra" as const,
                  at: yield* timestamp,
                  busy: native.busy,
                  outcome: session.outcome,
                  model: native.model,
                  older: page ? page.cursor.next : prior?.older,
                  forms: forms ?? prior!.forms,
                  permissions: permissions
                    ? permissions.map((request) => ({ request, binding: fingerprint(request) }))
                    : prior!.permissions,
                  inbox: inbox ?? prior!.inbox,
                  work,
                  work_unavailable:
                    observedWork?._tag === "Failure"
                      ? "Retained work is temporarily unavailable. Showing the last valid work observation."
                      : workChanged
                        ? undefined
                        : prior?.work_unavailable,
                  receipts: selection.receipts ? sections?.receipts : prior!.receipts,
                  surfaces: selection.surfaces ? sections?.surfaces : prior!.surfaces,
                  presentations: selection.message_ids
                    ? sections?.presentations
                    : prior?.presentations,
                  projects: selection.projects ? sections?.projects : prior!.projects,
                },
                "Workspace snapshot",
              );
              this.lastObservation = value;
              return value;
            }),
          ),
        ),
    ).pipe(Effect.mapError(nativeRpcError));
  get agentStatus() {
    return this.reader.status.pipe(Effect.mapError(nativeRpcError));
  }
  snapshot = this.observe({ all: true });
  history = (cursor: string) =>
    Effect.gen({ self: this }, function* () {
      const page = yield* this.reader.history(cursor);
      return {
        messages: page.messages,
        older: page.older,
        presentations: yield* this.gateway(page.client).presentations(
          { session_id: this.sessionID, message_ids: page.messageIDs },
          this.location(),
        ),
      };
    }).pipe(Effect.mapError(nativeRpcError));
  resolve = (target: ResourceSelection) =>
    this.gatewayCall("read", (rpc) => rpc.resolve, { target });
  publications = (query: typeof PublicationQuery.Type) =>
    this.gatewayCall("read", (rpc) => rpc.publications, query);
  surface = (id: string, revision: number) =>
    this.gatewayCall("read", (rpc) => rpc.surface, { surface_id: id, revision });
  submit = (input: Submission) => this.gatewayCall("write", (rpc) => rpc.submit, input);
  receipt = (requestID: string) =>
    this.gatewayCall("read", (rpc) => rpc.receipt, { request_id: requestID });
  stop = this.use((client) =>
    client.session
      .interrupt({ sessionID: this.sessionID, resume: false })
      .pipe(Effect.map((r) => r.interrupted)),
  );
  private visibility(client: OpenCodeClient) {
    return client.rpc(visibility);
  }
  private workMethod<I, A, E>(
    select: (
      rpc: ReturnType<NativeWebBackend["visibility"]>,
    ) => (input: I, options: ReturnType<NativeWebBackend["location"]>) => Effect.Effect<A, E>,
  ) {
    return (input: I) =>
      this.read((client) => select(this.visibility(client))(input, this.location()));
  }
  readonly work: WorkQueries = {
    evidenceSearch: this.workMethod((rpc) => rpc.evidenceSearch),
    sessions: this.workMethod((rpc) => rpc.sessions),
    thoughtWork: this.workMethod((rpc) => rpc.thoughtWork),
    thoughtList: this.workMethod((rpc) => rpc.thoughtList),
    thoughtDetail: this.workMethod((rpc) => rpc.thoughtDetail),
    githubInbox: this.workMethod((rpc) => rpc.githubInbox),
    githubItem: this.workMethod((rpc) => rpc.githubItem),
    binding: this.workMethod((rpc) => rpc.binding),
    evidence: this.workMethod((rpc) => rpc.evidence),
    verification: this.workMethod((rpc) => rpc.verification),
    overview: this.workMethod((rpc) => rpc.overview),
    detail: this.workMethod((rpc) => rpc.detail),
    document: this.workMethod((rpc) => rpc.document),
    worker: this.workMethod((rpc) => rpc.worker),
    find: (input) =>
      this.workMethod((rpc) => rpc.find)({
        ...input,
        state: input.state ?? "active",
        offset: input.offset ?? 0,
        limit: input.limit ?? 50,
      }),
    leads: (input) =>
      this.workMethod((rpc) => rpc.leads)({
        ...input,
        offset: input.offset ?? 0,
        request_offset: input.request_offset ?? 0,
        proposal_offset: input.proposal_offset ?? 0,
      }),
    diff: (input) => this.workMethod((rpc) => rpc.diff)({ ...input, scope: input.scope ?? "all" }),
    messages: (input) =>
      this.workMethod((rpc) => rpc.messages)({ ...input, offset: input.offset ?? 0 }),
    feedback: (input) =>
      this.workMethod((rpc) => rpc.feedback)({ ...input, page: input.page ?? 0 }),
    report: (input) =>
      readWorkReport(this.workMethod((rpc) => rpc.report)(input), this.work.detail(input)),
    artifacts: (input) =>
      this.gatewayCall("read", (rpc) => rpc.history, {
        issue_id: input.issue_id,
        artifact_offset: input.offset ?? 0,
      }),
    decisions: (input) => this.gatewayCall("read", (rpc) => rpc.history, input),
    artifactDocument: (input) => this.gatewayCall("read", (rpc) => rpc.artifactDocument, input),
    artifactSummary: (input) => this.gatewayCall("read", (rpc) => rpc.artifactSummary, input),
    "worker-history": (input) =>
      this.read((client) =>
        Effect.gen({ self: this }, function* () {
          const { issue_id, session_id } = input;
          yield* this.gateway(client).resolve(
            {
              session_id: this.sessionID,
              target: { action: "open_session", issue_id, session_id },
            },
            this.location(),
          );
          const key = (cursor: string) => JSON.stringify([issue_id, session_id, cursor]);
          if (input.cursor && !this.workerCursors.has(key(input.cursor)))
            return yield* new CrewError(
              "WEB_CURSOR",
              "Transcript cursor was not issued for this owned worker session; refresh first",
            );
          const page = yield* client.message.list({
            sessionID: session_id,
            limit: 8,
            ...(input.cursor ? { cursor: input.cursor } : { order: "desc" as const }),
          });
          if (page.cursor.next) {
            this.workerCursors.add(key(page.cursor.next));
            if (this.workerCursors.size > 500)
              this.workerCursors.delete(this.workerCursors.values().next().value!);
          }
          return {
            session_id,
            observed_at: yield* timestamp,
            older: page.cursor.next,
            messages: [...page.data].reverse().flatMap((message) => {
              const projected = projectMessage(message);
              return projected ? [workerHistoryMessage(projected)] : [];
            }),
          };
        }),
      ),
  };
  replyForm = (input: { id: string; binding: string; answer: Form.Answer }) =>
    this.use((client) =>
      Effect.gen({ self: this }, function* () {
        const form = yield* client.session.form.get({
          sessionID: this.sessionID,
          formID: Form.ID.make(input.id),
        });
        const { state, ...info } = form;
        const current = yield* this.attentionForm(client, info);
        if (current.binding !== input.binding || state.status === "cancelled")
          return yield* new CrewError(
            "STALE_FORM",
            "This form changed or was cancelled; refresh attention",
          );
        if (state.status === "answered") {
          if (fingerprint(state.answer) === fingerprint(input.answer)) return;
          return yield* new CrewError("FORM_CONFLICT", "The form already has another answer");
        }
        if (!current.active)
          return yield* new CrewError(
            "STALE_FORM",
            "Controller checkpoint changed; ask Abra for the current form",
          );
        const answer = yield* Schema.decodeEffect(Form.Answer)(input.answer);
        yield* client.session.form.reply({ sessionID: this.sessionID, formID: form.id, answer });
      }),
    );
  replyPermission = (input: { id: string; binding: string; decision: Permission.Reply }) =>
    this.use((client) =>
      Effect.gen({ self: this }, function* () {
        const request = yield* client.permission.get({
          sessionID: this.sessionID,
          requestID: Permission.ID.make(input.id),
        });
        if (fingerprint(request) !== input.binding)
          return yield* new CrewError("STALE_PERMISSION", "Permission request changed");
        const decision = yield* Schema.decodeEffect(Permission.Reply)(input.decision);
        yield* client.permission.reply({
          sessionID: this.sessionID,
          requestID: request.id,
          decision,
        });
      }),
    );
  exportDocument = (input: typeof ExportDocumentSchema.Type) =>
    this.gatewayCall("write", (rpc) => rpc.exportDocument, input);
  readExport = (input: typeof ReadExportSchema.Type) =>
    this.gatewayCall("read", (rpc) => rpc.readExport, input);
  prepareDiagrams = (selection: PrepareDiagramSelection) =>
    this.gatewayCall("read", (rpc) => rpc.prepareDiagrams, { selection });
  saveSurface = (input: typeof SaveSurfaceSchema.Type) =>
    this.gatewayCall("write", (rpc) => rpc.saveSurface, input);
  nativeEvent = (event: NativeEventEnvelope) => this.reader.apply(event);
  nativeSnapshot = () => this.reader.current();
  readonly changes = Stream.unwrap(
    this.client().pipe(
      Effect.map((client) =>
        nativeChanges(
          client,
          this.home,
          this.sessionID,
          (session) =>
            this.lastValidWork?.work.find((work) =>
              work.sessions.some((worker) => worker.id === session),
            )?.issue_id,
          (failed) => this.forget(failed),
        ),
      ),
    ),
  ).pipe(Stream.mapError(CrewError.from));
}
