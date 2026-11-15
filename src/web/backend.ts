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
import { AbsolutePath, IssueId, RelativePath, SessionId, RequestId } from "../identities.ts";
import { makeClient } from "../opencode/client.ts";
import { ArtifactSchema } from "./wire.ts";
import { decode } from "../decode.ts";
import { visibility } from "../visibility/protocol.ts";
import { webGateway } from "./protocol.ts";
import type { SubmissionReceipt } from "./gateway.ts";
import type {
  AttentionForm,
  SurfaceRecord,
  TranscriptMessage,
  WebBackend,
  WorkspaceSnapshot,
  WorkReadName,
} from "./contracts.ts";

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const time = (at: DateTime.Utc) => DateTime.formatIso(at);
const jsonText = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "native" ? undefined : v), 2)?.slice(0, 32768);
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
  if (message.type === "assistant")
    return {
      ...base,
      role: "assistant",
      text: message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
      tools: message.content
        .filter((c) => c.type === "tool")
        .map((c) => ({
          id: c.id,
          name: c.name,
          status: c.state.status,
          input: c.state.status === "streaming" ? undefined : jsonText(c.state.input),
          result:
            c.state.status === "completed"
              ? jsonText(c.state.content)
              : c.state.status === "error"
                ? jsonText(c.state.error)
                : undefined,
        })),
    };
  if (message.type === "system" || message.type === "synthetic")
    return { ...base, role: "system", text: message.description ?? message.text };
  if (message.type === "compaction")
    return { ...base, role: "system", text: `Conversation compaction: ${message.status}` };
  return undefined;
}

export class NativeWebBackend implements WebBackend {
  readonly sessionID: SessionId;
  private cursors = new Set<string>();
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
      return (yield* this.gateway(client).checkpoint(
        { session_id: this.sessionID, form_id: form.id },
        this.location(),
      )) as unknown as NonNullable<AttentionForm["checkpoint"]>;
    });
  }
  private attentionForm(client: OpenCodeClient, form: Form.Info) {
    return Effect.gen({ self: this }, function* () {
      const checkpoint = yield* this.checkpoint(client, form);
      const metadata = form.metadata;
      const active =
        !checkpoint ||
        (checkpoint.active === true &&
          (checkpoint.fingerprint === undefined ||
            checkpoint.fingerprint === metadata?.fingerprint) &&
          (checkpoint.identity === undefined ||
            checkpoint.identity === metadata?.decision_identity) &&
          (checkpoint.finishing_target === undefined ||
            checkpoint.finishing_target === metadata?.finishing_target));
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
      return {
        session_id: this.sessionID,
        agent_id: "abra" as const,
        at: new Date().toISOString(),
        busy: Boolean(
          session.time.busy &&
          (!session.time.idle ||
            DateTime.toEpochMillis(session.time.busy) > DateTime.toEpochMillis(session.time.idle)),
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
        receipts: (yield* rpc.receipts(
          { session_id: this.sessionID },
          opts,
        )) as unknown as SubmissionReceipt[],
        surfaces: (yield* rpc.surfaces(
          { session_id: this.sessionID },
          opts,
        )) as unknown as SurfaceRecord[],
        projects: (yield* rpc.projects(
          { session_id: this.sessionID },
          opts,
        )) as unknown as WorkspaceSnapshot["projects"],
      };
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
        };
      }),
    );
  submit = (input: { request_id: string; text: string; delivery: "queue" | "steer" }) =>
    this.use((client) =>
      this.gateway(client)
        .submit({ session_id: this.sessionID, ...input }, this.location())
        .pipe(Effect.map((r) => r as unknown as SubmissionReceipt)),
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
          opts = this.location(),
          issue_id = IssueId.make(input.issue_id);
        switch (name) {
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
          case "decisions":
          case "artifacts":
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
