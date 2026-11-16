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
