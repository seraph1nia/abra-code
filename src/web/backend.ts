import { checkpointMatchesForm } from "./form-binding.ts";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "./report-actions.ts";
import { workerHistoryMessage } from "./worker-history.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect native HTTP and event APIs, verified against OpenCode 2.3.0. */
import { createHash } from "node:crypto";
import { DateTime, Effect, Schema, Stream } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import type { SessionMessage } from "@opencode/schema/session-message";
import { type Endpoint } from "@opencode/client/effect/service";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import {
  AbsolutePath,
  IssueId,
  RelativePath,
  SessionId,
  RequestId,
  RepositoryId,
  LeadId,
  Timestamp,
  ContentHash,
} from "../identities.ts";
import { makeClient } from "../opencode/client.ts";
import { ArtifactSchema } from "./wire.ts";
import { WorkspaceSnapshotSchema } from "./workspace-wire.ts";
import { decode } from "../decode.ts";
import { visibility } from "../visibility/protocol.ts";
import { webGateway } from "./protocol.ts";
import type { AttentionForm, TranscriptMessage, WebBackend, WorkReadName } from "./contracts.ts";
import type { ResourceSelection } from "./resources.ts";
import { toolPresentation } from "./tool-presentation.ts";
import type { TranscriptTool } from "./presentation-contracts.ts";

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const time = (at: DateTime.Utc) => DateTime.formatIso(at);
const jsonText = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "native" ? undefined : v), 2);
function projectTool(
  tool: SessionMessage.AssistantTool,
  observedAt: Timestamp | undefined,
): TranscriptTool {
  const state = tool.state;
  const input = state.status === "streaming" ? state.input : jsonText(state.input);
  const presentation =
    state.status === "completed"
      ? toolPresentation(tool.name, state.input, state.content, observedAt)
      : undefined;
  const result =
    state.status === "error"
      ? state.error.message
      : state.status === "completed" && !presentation
        ? state.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : undefined;
  return {
    id: tool.id,
    name: tool.name,
    status: state.status,
    input: input?.slice(0, 4096),
    result: result?.slice(0, 8192),
    presentation,
    limited: (input?.length ?? 0) > 4096 || (result?.length ?? 0) > 8192,
  };
}
/** Explicit projection keeps provider replay/hidden reasoning out of the browser. */
export function projectMessage(message: SessionMessage.Info): TranscriptMessage | undefined {
  const base = { id: message.id, at: time(message.time.created) };
  if (message.type === "user")
    return {
      ...base,
      role: "user",
      text: message.text,
      files: message.files?.map(
        (f) => f.name ?? (f.source.type === "uri" ? f.source.uri : "Attachment"),
      ),
    };
  if (message.type === "assistant") {
    const tools = message.content
      .filter((part) => part.type === "tool")
      .map((part) =>
        projectTool(
          part,
          part.time.completed ? Timestamp.make(time(part.time.completed)) : undefined,
        ),
      );
    return {
      ...base,
      role: "assistant",
      text: message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
      tools,
      parts: message.content.flatMap((part): NonNullable<TranscriptMessage["parts"]> =>
        part.type === "text"
          ? [{ type: "text", text: part.text }]
          : part.type === "tool"
            ? [{ type: "tool", tool_id: part.id }]
            : [],
      ),
    };
  }
  if (message.type === "system" || message.type === "synthetic")
    return { ...base, role: "system", text: message.description ?? message.text };
  if (message.type === "compaction")
    return { ...base, role: "system", text: `Conversation compaction: ${message.status}` };
  return undefined;
}

export class NativeWebBackend implements WebBackend {
  readonly sessionID: SessionId;
  private cursors = new Set<string>();
  private workerCursors = new Set<string>();
  private rememberCursor(cursor: string | undefined) {
    if (!cursor) return;
    this.cursors.add(cursor);
    if (this.cursors.size > 500) this.cursors.delete(this.cursors.values().next().value!);
  }
  constructor(
    private home: AbsolutePath,
    sessionID: string,
    private discover: Effect.Effect<Endpoint | undefined, CrewError>,
  ) {
    this.sessionID = SessionId.make(sessionID);
  }
  private client = () =>
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
      return client;
    });
  private use<A, E>(fn: (client: OpenCodeClient) => Effect.Effect<A, E>) {
    return domainEffect(this.client().pipe(Effect.flatMap(fn)));
  }
  private gateway(client: OpenCodeClient) {
    return client.rpc(webGateway);
  }
  private location() {
    return { location: { directory: this.home } };
  }
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
  snapshot = this.use((client) =>
    Effect.gen({ self: this }, function* () {
      const session = yield* client.session.get({ sessionID: this.sessionID });
      const page = yield* client.message.list({
        sessionID: this.sessionID,
        limit: 100,
        order: "desc",
      });
      this.rememberCursor(page.cursor.next);
      const forms = yield* client.session.form.list({ sessionID: this.sessionID });
      const permissions = yield* client.permission.list({ sessionID: this.sessionID });
      const inbox = yield* client.session.inbox.list({ sessionID: this.sessionID });
      const rpc = this.gateway(client),
        opts = this.location();
      return yield* decode(
        WorkspaceSnapshotSchema,
        {
          session_id: this.sessionID,
          agent_id: "abra" as const,
          at: new Date().toISOString(),
          busy: Boolean(
            session.time.busy &&
            (!session.time.idle ||
              DateTime.toEpochMillis(session.time.busy) >
                DateTime.toEpochMillis(session.time.idle)),
          ),
          outcome: session.outcome,
          model: session.model
            ? `${session.model.providerID}/${session.model.id}${session.model.variant ? `#${session.model.variant}` : ""}`
            : undefined,
          messages: [...page.data].reverse().flatMap((m) => projectMessage(m) ?? []),
          older: page.cursor.next,
          forms: yield* Effect.forEach(forms, (form) => this.attentionForm(client, form)),
          permissions: permissions.map((request) => ({ request, binding: fingerprint(request) })),
          inbox: inbox
            .filter((i) => i.type === "user")
            .map((i) => ({ id: i.id, text: i.payload.text, delivery: i.delivery })),
          work: yield* client.rpc(visibility).snapshot({}, opts),
          receipts: yield* rpc.receipts({ session_id: this.sessionID }, opts),
          surfaces: yield* rpc.surfaces({ session_id: this.sessionID }, opts),
          presentations: yield* rpc.presentations(
            { session_id: this.sessionID, message_ids: page.data.map((message) => message.id) },
            opts,
          ),
          projects: yield* rpc.projects({ session_id: this.sessionID }, opts),
        },
        "Workspace snapshot",
      );
    }),
  );
  history = (cursor: string) =>
    this.use((client) =>
      Effect.gen({ self: this }, function* () {
        if (!this.cursors.has(cursor))
          return yield* new CrewError(
            "WEB_CURSOR",
            "History cursor was not issued for this Abra session; refresh first",
          );
        const page = yield* client.message.list({ sessionID: this.sessionID, cursor, limit: 100 });
        this.rememberCursor(page.cursor.next);
        return {
          messages: [...page.data].reverse().flatMap((m) => projectMessage(m) ?? []),
          older: page.cursor.next,
          presentations: yield* this.gateway(client).presentations(
            { session_id: this.sessionID, message_ids: page.data.map((message) => message.id) },
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
  stop = this.use((client) =>
    client.session
      .interrupt({ sessionID: this.sessionID, resume: false })
      .pipe(Effect.map((r) => r.interrupted)),
  );
  read = (name: WorkReadName, input: Record<string, string>) =>
    this.use((client) =>
      Effect.gen({ self: this }, function* () {
        const rpc = client.rpc(visibility),
          opts = this.location();
        if (name === "find")
          return yield* rpc.find(
            {
              ...(input.repository_id
                ? { repository_id: RepositoryId.make(input.repository_id) }
                : {}),
              state: input.state === "closed" || input.state === "all" ? input.state : "active",
              search: input.search,
              offset: Number(input.offset ?? 0),
              limit: Number(input.limit ?? 50),
            },
            opts,
          );
        if (name === "leads")
          return yield* rpc.leads(
            {
              ...(input.issue_id ? { issue_id: IssueId.make(input.issue_id) } : {}),
              ...(input.repository_id
                ? { repository_id: RepositoryId.make(input.repository_id) }
                : {}),
              ...(input.lead_id ? { lead_id: LeadId.make(input.lead_id) } : {}),
              offset: Number(input.offset ?? 0),
              request_offset: Number(input.request_offset ?? 0),
              proposal_offset: Number(input.proposal_offset ?? 0),
            },
            opts,
          );
        const issue_id = IssueId.make(input.issue_id);
        switch (name) {
          case "artifact-document":
            return yield* this.gateway(client).artifactDocument(
              {
                session_id: this.sessionID,
                issue_id,
                request_id: RequestId.make(input.request_id),
                hash: ContentHash.make(input.hash),
              },
              opts,
            );
          case "artifact-summary":
            return yield* this.gateway(client).artifactSummary(
              {
                session_id: this.sessionID,
                issue_id,
                request_id: RequestId.make(input.request_id),
                hash: ContentHash.make(input.hash),
              },
              opts,
            );
          case "detail":
            return yield* rpc.detail({ issue_id }, opts);
          case "document":
            return yield* rpc.document({ issue_id, path: RelativePath.make(input.path) }, opts);
          case "diff":
            return yield* rpc.diff(
              {
                issue_id,
                ...(input.file ? { file: RelativePath.make(input.file) } : {}),
                scope: input.scope === "uncommitted" ? "uncommitted" : "all",
              },
              opts,
            );
          case "worker-history": {
            const session_id = SessionId.make(input.session_id);
            yield* this.gateway(client).resolve(
              {
                session_id: this.sessionID,
                target: { action: "open_session", issue_id, session_id },
              },
              opts,
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
              observed_at: new Date().toISOString(),
              older: page.cursor.next,
              messages: [...page.data].reverse().flatMap((message) => {
                const projected = projectMessage(message);
                return projected ? [workerHistoryMessage(projected)] : [];
              }),
            };
          }
          case "worker":
            return yield* rpc.worker(
              { issue_id, session_id: SessionId.make(input.session_id) },
              opts,
            );
          case "messages":
            return yield* rpc.messages({ issue_id, offset: Number(input.offset ?? 0) }, opts);
          case "feedback":
            return yield* rpc.feedback({ issue_id, page: Number(input.page ?? 0) }, opts);
          case "report":
            return yield* rpc.report({ issue_id }, opts);
          case "artifacts":
            return yield* this.gateway(client).history(
              { session_id: this.sessionID, issue_id, artifact_offset: Number(input.offset ?? 0) },
              opts,
            );
          case "decisions":
            return yield* this.gateway(client).history(
              { session_id: this.sessionID, issue_id },
              opts,
            );
        }
      }),
    );
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
  saveSurface = (input: typeof SaveSurfaceSchema.Type) =>
    this.use((client) =>
      this.gateway(client).saveSurface({ session_id: this.sessionID, ...input }, this.location()),
    );
  readonly changes = Stream.unwrap(
    this.client().pipe(
      Effect.map((client) =>
        client.event.subscribe().pipe(
          Stream.map(() => undefined),
          Stream.mapError(CrewError.from),
        ),
      ),
    ),
  ).pipe(Stream.mapError(CrewError.from));
}
