import { Schema } from "effect";
import {
  SessionId,
  MessageId,
  IssueId,
  RequestId,
  ContentHash,
  Identifier,
} from "../identities.ts";
export const PresentationAttachmentSchema = Schema.Struct({
  session_id: SessionId,
  message_id: MessageId,
  tool_call_id: Schema.optional(Schema.String),
  source: Schema.Literals(["tool", "notice"]),
  target: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("review"),
      review_id: Identifier,
      revision: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
    Schema.Struct({
      kind: Schema.Literal("surface"),
      surface_id: Identifier,
      revision: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
    Schema.Struct({
      kind: Schema.Literal("artifact"),
      issue_id: IssueId,
      request_id: RequestId,
      hash: ContentHash,
    }),
  ]),
}).check(
  Schema.makeFilter(
    (value) =>
      value.source !== "tool" ||
      !!value.tool_call_id ||
      "A tool association requires its native call identity",
  ),
);
export const PresentationDiagnosticSchema = Schema.Struct({
  message_id: MessageId,
  unavailable: Schema.String,
});
export const PresentationPageSchema = Schema.Struct({
  entries: Schema.Array(PresentationAttachmentSchema).check(Schema.isMaxLength(200)),
  truncated: Schema.Boolean,
  diagnostics: Schema.optional(
    Schema.Array(PresentationDiagnosticSchema).check(Schema.isMaxLength(200)),
  ),
});

export const PublicationQuery = Schema.Struct({
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  kind: Schema.optional(Schema.Literals(["surface", "review"])),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
});
export const PublicationPage = Schema.Struct({
  entries: Schema.Array(PresentationAttachmentSchema).check(Schema.isMaxLength(32)),
  next: Schema.optional(Schema.String),
  incomplete: Schema.Boolean,
});

/** References use the native message and call as their attachment identity. Artifact
 * revisions are content hashes; other publications use their retained revision. */
export const ActivityReferenceSchema = Schema.Struct({
  surface_id: Schema.String,
  revision: Schema.Union([Schema.Int.check(Schema.isGreaterThan(0)), ContentHash]),
  tool_call_id: Schema.optional(Schema.String),
});
export function presentationActivity(entry: typeof PresentationAttachmentSchema.Type) {
  const target = entry.target;
  const surface_id =
    target.kind === "surface"
      ? target.surface_id
      : target.kind === "review"
        ? target.review_id
        : target.request_id;
  const revision = target.kind === "artifact" ? target.hash : target.revision;
  const content = {
    surface_id,
    revision,
    ...(entry.tool_call_id && { tool_call_id: entry.tool_call_id }),
  };
  return {
    id: JSON.stringify([
      entry.session_id,
      entry.message_id,
      entry.tool_call_id,
      target.kind,
      target.kind === "artifact" ? target.issue_id : null,
      surface_id,
      revision,
    ]),
    role: "activity" as const,
    activityType: `abracode.${target.kind}`,
    content,
  };
}
