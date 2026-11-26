import { sha256 } from "../digest.ts";
import { IssueId, ReportId, ContentHash, Fingerprint } from "@abracode/contracts/identities";
import { Schema } from "effect";
import { NonEmpty } from "@abracode/contracts/primitives";
const text = NonEmpty.check(Schema.isMaxLength(8192));
const list = Schema.Array(text).check(Schema.isMaxLength(64));
export const ScopeDraftSchema = Schema.Struct({
  goal: Schema.optional(text),
  acceptance: Schema.optional(list),
  constraints: Schema.optional(list),
});
export const ScopeSchema = Schema.Struct({
  goal: text,
  acceptance: list.check(Schema.isMinLength(1)),
  constraints: list,
});
export type Scope = typeof ScopeSchema.Type;
export const scopeIdentity = (revision: number, contract: Scope) =>
  Fingerprint.make(sha256(JSON.stringify({ revision, contract })));
export const ScopeRecordSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  contract: ScopeSchema,
  fingerprint: Fingerprint,
}).check(
  Schema.makeFilter(
    (scope) =>
      scope.fingerprint === scopeIdentity(scope.revision, scope.contract) ||
      "Scope fingerprint does not match the retained contract revision",
  ),
);
export const ReportReferenceSchema = Schema.Struct({
  issue_id: IssueId,
  report_id: ReportId,
  hash: ContentHash,
});
export const completeScope = Schema.is(ScopeSchema);
