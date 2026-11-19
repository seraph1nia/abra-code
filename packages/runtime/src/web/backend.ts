import type {
  ReviewSelection,
  ReviewAssetQuerySchema,
  ReviewSubmit,
  ReviewResponseQuerySchema,
} from "@abracode/contracts/web/reviews";
import type { PrepareDiagramSelection } from "@abracode/contracts/web/diagram-actions";
import { NativeSessionReader } from "../opencode/agui/source.ts";
import { projectNativeMessage } from "../opencode/agui/messages.ts";
import type { ChangeScope } from "@abracode/contracts/web/changes";
import { nativeChangeScope } from "./change-scopes.ts";
import { checkpointMatchesForm } from "./form-binding.ts";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "./report-actions.ts";
import { workerHistoryMessage } from "./worker-history.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect native HTTP and event APIs, verified against OpenCode 2.3.0. */
import { createHash } from "node:crypto";
import { Effect, Result, Schema, Stream } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import type { SessionMessage } from "@opencode/schema/session-message";
import { type Endpoint } from "@opencode/client/effect/service";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { AbsolutePath, IssueId, SessionId, RequestId, timestamp } from "../identities.ts";
import { makeClient } from "../opencode/client.ts";
import { ArtifactSchema, WorkSnapshotSchema } from "./wire.ts";
import { WorkspaceSnapshotSchema } from "./workspace-wire.ts";
import { decode } from "../decode.ts";
import { visibility } from "../visibility/protocol.ts";
import { webGateway } from "./protocol.ts";
import type { AttentionForm, WebBackend, WorkQueries, WorkspaceSnapshot } from "./contracts.ts";
import type { ResourceSelection } from "./resources.ts";
import { toolPresentation } from "./tool-presentation.ts";
import { nativeRpcError, readWorkReport } from "./native-errors.ts";

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const projectMessage = (message: SessionMessage.Info) =>
  projectNativeMessage(message, toolPresentation);

export class NativeWebBackend implements WebBackend {
  private lastObservation?: WorkspaceSnapshot;
  private lastValidWork?: WorkspaceSnapshot["work"];
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
      () => this.connection().pipe(domainEffect),
      toolPresentation,
    );
  }
  private connection = () =>
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
      return { client, session };
    });
  private client = () => this.connection().pipe(Effect.map(({ client }) => client));
  private use<A, E>(fn: (client: OpenCodeClient) => Effect.Effect<A, E>) {
    return domainEffect(this.client().pipe(Effect.flatMap(fn), Effect.mapError(nativeRpcError)));
  }
  private gateway(client: OpenCodeClient) {
    return client.rpc(webGateway);
  }
  readonly agents = Effect.suspend(() =>
    this.use((client) =>
      this.gateway(client).agents({ session_id: this.sessionID }, this.location()),
    ),
  );
  private location() {
    return { location: { directory: this.home } };
  }
  readonly reviews = {
    receipt: (selection: typeof ReviewResponseQuerySchema.Type) =>
      this.use((client) =>
        this.gateway(client).reviewReceipt(
          { session_id: this.sessionID, ...selection },
          this.location(),
        ),
      ),
    list: (issue?: string) =>
      this.use((client) =>
        this.gateway(client).reviewList(
          { session_id: this.sessionID, ...(issue ? { issue_id: IssueId.make(issue) } : {}) },
          this.location(),
        ),
      ),
    read: (selection: ReviewSelection) =>
      this.use((client) =>
        this.gateway(client).review({ session_id: this.sessionID, ...selection }, this.location()),
      ),
    asset: (selection: typeof ReviewAssetQuerySchema.Type) =>
      this.use((client) =>
        this.gateway(client).reviewAsset(
          { session_id: this.sessionID, ...selection },
          this.location(),
        ),
      ),
    submit: (input: ReviewSubmit) =>
      this.use((client) =>
        this.gateway(client).reviewSubmit(
          { session_id: this.sessionID, ...input },
          this.location(),
        ),
      ),
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
    domainEffect(
      Effect.suspend(() =>
        this.reader
          .read({
            transcript: !this.lastObservation || scope.all || scope.transcript,
            inbox: !this.lastObservation || scope.all || scope.admissions || scope.transcript,
          })
          .pipe(
            Effect.flatMap((native) =>
              Effect.gen({ self: this }, function* () {
                const { client, session, page, inbox } = native;
                const prior = this.lastObservation;
                const all = !prior || scope.all;
                const transcript = all || scope.transcript;
                const attention = all || scope.attention;
                const workChanged = all || scope.work_all || scope.finder || scope.issues?.length;

                const forms = attention
                  ? yield* client.session.form.list({ sessionID: this.sessionID })
                  : undefined;
                const permissions = attention
                  ? yield* client.permission.list({ sessionID: this.sessionID })
                  : undefined;
                const rpc = this.gateway(client),
                  opts = this.location();
                const observedWork = workChanged
                  ? yield* client
                      .rpc(visibility)
                      .snapshot({}, opts)
                      .pipe(
                        Effect.flatMap((work) =>
                          decode(WorkSnapshotSchema, work, "Retained work observation"),
                        ),
                        Effect.result,
                      )
                  : undefined;
                if (observedWork?._tag === "Success") this.lastValidWork = observedWork.success;
                const work =
                  observedWork?._tag === "Success"
                    ? observedWork.success
                    : (this.lastValidWork ?? { home: this.home, at: yield* timestamp, work: [] });
                const selection = {
                  receipts: !!(all || scope.admissions),
                  surfaces: !!(all || scope.presentations),
                  projects: !!(all || scope.projects),
                  ...(all || scope.presentations || transcript
                    ? {
                        message_ids:
                          page?.data.map((message) => message.id) ??
                          prior!.messages.map((message) => message.id),
                      }
                    : {}),
                };
                const sections =
                  selection.receipts ||
                  selection.surfaces ||
                  selection.projects ||
                  selection.message_ids
                    ? yield* rpc.observeSections({ session_id: this.sessionID, ...selection }, opts)
                    : undefined;
                const value = yield* decode(
                  WorkspaceSnapshotSchema,
                  {
                    session_id: this.sessionID,
                    agent_id: "abra" as const,
                    at: yield* timestamp,
                    busy: native.busy,
                    outcome: session.outcome,
                    model: native.model,
                    messages: native.messages ?? prior!.messages,
                    older: page ? page.cursor.next : prior?.older,
                    forms: forms
                      ? yield* Effect.forEach(forms, (form) => this.attentionForm(client, form))
                      : prior!.forms,
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
      ),
    );
  get agentStatus() {
    return this.reader.status;
  }
  snapshot = this.observe({ all: true });
  history = (cursor: string) =>
    domainEffect(
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
      }),
    );
  resolve = (target: ResourceSelection) =>
    this.use((client) =>
      this.gateway(client).resolve({ session_id: this.sessionID, target }, this.location()),
    );
  surface = (id: string, revision: number) =>
    this.use((client) =>
      this.gateway(client).surface(
        { session_id: this.sessionID, surface_id: id, revision },
        this.location(),
      ),
    );
  submit = (input: { request_id: string; text: string; delivery: "queue" | "steer" }) =>
    this.use((client) =>
      this.gateway(client).submit({ session_id: this.sessionID, ...input }, this.location()),
    );
  receipt = (requestID: string) =>
    this.use((client) =>
      this.gateway(client).receipt(
        { session_id: this.sessionID, request_id: requestID },
        this.location(),
      ),
    );
  stop = this.use((client) =>
    client.session
      .interrupt({ sessionID: this.sessionID, resume: false })
      .pipe(Effect.map((r) => r.interrupted)),
  );
  readonly work: WorkQueries = {
    binding: (input) =>
      this.use((client) => client.rpc(visibility).binding(input, this.location())),
    find: (input) =>
      this.use((client) =>
        client.rpc(visibility).find(
          {
            ...input,
            state: input.state ?? "active",
            offset: input.offset ?? 0,
            limit: input.limit ?? 50,
          },
          this.location(),
        ),
      ),
    leads: (input) =>
      this.use((client) =>
        client.rpc(visibility).leads(
          {
            ...input,
            offset: input.offset ?? 0,
            request_offset: input.request_offset ?? 0,
            proposal_offset: input.proposal_offset ?? 0,
          },
          this.location(),
        ),
      ),
    detail: (input) => this.use((client) => client.rpc(visibility).detail(input, this.location())),
    document: (input) =>
      this.use((client) => client.rpc(visibility).document(input, this.location())),
    diff: (input) =>
      this.use((client) =>
        client.rpc(visibility).diff({ ...input, scope: input.scope ?? "all" }, this.location()),
      ),
    worker: (input) => this.use((client) => client.rpc(visibility).worker(input, this.location())),
    messages: (input) =>
      this.use((client) =>
        client.rpc(visibility).messages({ ...input, offset: input.offset ?? 0 }, this.location()),
      ),
    feedback: (input) =>
      this.use((client) =>
        client.rpc(visibility).feedback({ ...input, page: input.page ?? 0 }, this.location()),
      ),
    report: (input) =>
      readWorkReport(
        this.use((client) => client.rpc(visibility).report(input, this.location())),
        this.work.detail(input),
      ),
    artifacts: (input) =>
      this.use((client) =>
        this.gateway(client).history(
          {
            session_id: this.sessionID,
            issue_id: input.issue_id,
            artifact_offset: input.offset ?? 0,
          },
          this.location(),
        ),
      ),
    decisions: (input) =>
      this.use((client) =>
        this.gateway(client).history({ session_id: this.sessionID, ...input }, this.location()),
      ),
    artifactDocument: (input) =>
      this.use((client) =>
        this.gateway(client).artifactDocument(
          { session_id: this.sessionID, ...input },
          this.location(),
        ),
      ),
    artifactSummary: (input) =>
      this.use((client) =>
        this.gateway(client).artifactSummary(
          { session_id: this.sessionID, ...input },
          this.location(),
        ),
      ),
    "worker-history": (input) =>
      this.use((client) =>
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
  artifact = (issue: string, request: string) =>
    this.use((client) =>
      this.gateway(client)
        .artifact(
          {
            session_id: this.sessionID,
            issue_id: IssueId.make(issue),
            request_id: RequestId.make(request),
          },
          this.location(),
        )
        .pipe(Effect.flatMap((value) => decode(ArtifactSchema, value, "Visual artifact"))),
    );
  exportDocument = (input: typeof ExportDocumentSchema.Type) =>
    this.use((client) =>
      this.gateway(client).exportDocument(
        { session_id: this.sessionID, ...input },
        this.location(),
      ),
    );
  readExport = (input: typeof ReadExportSchema.Type) =>
    this.use((client) =>
      this.gateway(client).readExport({ session_id: this.sessionID, ...input }, this.location()),
    );
  prepareDiagrams = (selection: PrepareDiagramSelection) =>
    this.use((client) =>
      this.gateway(client).prepareDiagrams(
        { session_id: this.sessionID, selection },
        this.location(),
      ),
    );
  saveSurface = (input: typeof SaveSurfaceSchema.Type) =>
    this.use((client) =>
      this.gateway(client).saveSurface({ session_id: this.sessionID, ...input }, this.location()),
    );
  nativeEvent = (event: import("../opencode/agui/native-state.ts").NativeEventEnvelope) =>
    this.reader.apply(event);
  nativeSnapshot = () => this.reader.current();
  readonly changes = Stream.unwrap(
    this.client().pipe(
      Effect.map((client) =>
        client.event.subscribe().pipe(
          Stream.filterMap((event) => {
            const scope = nativeChangeScope(
              event,
              this.home,
              this.sessionID,
              (session) =>
                this.lastValidWork?.work.find((work) =>
                  work.sessions.some((worker) => worker.id === session),
                )?.issue_id,
            );
            const data = "data" in event ? event.data : undefined;
            const native =
              event.type === "server.connected" ||
              (event.type.startsWith("session.") &&
                data &&
                typeof data === "object" &&
                "sessionID" in data &&
                data.sessionID === this.sessionID &&
                (!event.location?.directory || event.location.directory === this.home));
            return scope || native
              ? Result.succeed({ ...scope, ...(native ? { native: event } : {}) })
              : Result.fail(undefined);
          }),
          Stream.mapError(CrewError.from),
        ),
      ),
    ),
  ).pipe(Stream.mapError(CrewError.from));
}
