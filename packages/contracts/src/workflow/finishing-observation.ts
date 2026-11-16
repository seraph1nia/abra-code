import { Schema } from "effect";
import { Count, NonEmpty } from "../primitives.ts";
import { OperationId, Commit, Fingerprint } from "../identities.ts";
import { DirectoryIdentitySchema, CleanupPathsSchema } from "../git/retirement-contracts.ts";
const identity = { schema_version: Schema.Literal(1), generation: Count };
export const CleanupPreflightSchema = Schema.Struct({
  ...identity,
  operation_id: OperationId,
  head: Commit,
  content: Fingerprint,
  published: Commit,
  worktree: DirectoryIdentitySchema,
  authorization_revision: Count,
  observed_at: Count,
  status: Schema.Literals(["ready", "blocked", "unavailable"]),
  paths: CleanupPathsSchema,
  truncated: Schema.Boolean,
  fingerprint: Schema.optional(Fingerprint),
  reason: Schema.optional(NonEmpty.check(Schema.isMaxLength(8192))),
}).check(
  Schema.makeFilter(
    (p) =>
      p.status !== "ready" ||
      (!p.truncated && p.paths.length === 0 && p.head === p.published) ||
      "Ready preflight requires complete clean synchronized evidence",
  ),
);
