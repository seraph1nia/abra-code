import { Schema } from "effect";
import { RequestId } from "../identities.ts";

export const MemoName = Schema.String.check(
  Schema.isPattern(/^memos\/[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u),
);
export const MemoAccount = Schema.String.check(
  Schema.isPattern(/^users\/[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u),
);
export const ThoughtReference = Schema.Struct({
  instance: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  account: MemoAccount,
  name: MemoName,
  wording_hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
export type ThoughtReference = typeof ThoughtReference.Type;
const day = Schema.String.check(Schema.isPattern(/^\d{4}-\d\d-\d\d$/u));
export const ThoughtQuery = Schema.Struct({
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  tag: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  from: Schema.optional(day),
  until: Schema.optional(day),
  cursor: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(4096))),
});
export type ThoughtQuery = typeof ThoughtQuery.Type;
export const ThoughtSummary = Schema.Struct({
  reference: ThoughtReference,
  snippet: Schema.String,
  tags: Schema.Array(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export const ThoughtDetail = Schema.Struct({
  ...ThoughtSummary.fields,
  content: Schema.String,
  url: Schema.String,
});
export const ThoughtPage = Schema.Struct({
  entries: Schema.Array(ThoughtSummary),
  next_cursor: Schema.optional(Schema.String),
});
export const ThoughtSave = Schema.Struct({ request_id: RequestId, content: Schema.NonEmptyString });
export const ThoughtSource = Schema.Struct({
  reference: ThoughtReference,
  excerpt: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
});
