import { Schema } from "effect";
import { CheckName, Commit } from "../identities.ts";
import { NonEmpty, Positive } from "../contracts.ts";

export const CheckFields = {
  name: CheckName,
  app_id: Schema.optional(Positive),
  bucket: Schema.Literals(["pass", "fail", "pending", "skipping", "cancel"]),
};
export const CheckSource = Schema.Struct({
  kind: Schema.Literals(["check-run", "status"]),
  id: Positive,
  head: Commit,
  revision: NonEmpty,
  link: Schema.optional(Schema.String),
});
export type Check = typeof CanonicalCheck.Type;
export const CanonicalCheck = Schema.Struct({ ...CheckFields, source: CheckSource });
