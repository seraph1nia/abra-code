import { Schema } from "effect";
import { RepositoryId, RequestId } from "../identities.ts";
import { ThoughtReference } from "./thoughts.ts";

const bounded = (n: number) => Schema.NonEmptyString.check(Schema.isMaxLength(n));
const checksum = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const MemoryScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shared") }),
  Schema.Struct({ kind: Schema.Literal("repository"), repository_id: RepositoryId }),
]);
export type MemoryScope = typeof MemoryScope.Type;
export const MemoryReference = Schema.Struct({
  scope: MemoryScope,
  path: bounded(1024),
  revision: checksum,
});
export type MemoryReference = typeof MemoryReference.Type;
export const MemorySearch = Schema.Struct({
  query: bounded(512),
  cursor: Schema.optional(bounded(512)),
});
export const MemoryRead = Schema.Struct({
  reference: MemoryReference,
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export const ScopedMemorySearch = Schema.Struct({
  ...MemorySearch.fields,
  repository_id: Schema.optional(RepositoryId),
});
export const ScopedMemoryRead = Schema.Struct({
  ...MemoryRead.fields,
  repository_id: Schema.optional(RepositoryId),
});
export const MemoryPage = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({ reference: MemoryReference, title: Schema.String, excerpt: Schema.String }),
  ),
  next_cursor: Schema.optional(Schema.String),
});
export const MemoryBody = Schema.Struct({
  reference: MemoryReference,
  body: Schema.String,
  complete: Schema.Boolean,
  next_offset: Schema.optional(Schema.Int),
});
export const MemoryPublication = Schema.Struct({
  request_id: RequestId,
  destination: MemoryScope,
  content: bounded(8192),
  source: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("thought"), reference: ThoughtReference }),
    Schema.Struct({ kind: Schema.Literals(["observation", "verified-procedure"]) }),
  ]),
  corrects: Schema.optional(MemoryReference),
});
export type MemoryPublication = typeof MemoryPublication.Type;
