import { createHash } from "node:crypto";
import { canonicalJson } from "@abracode/contracts/canonical-json";
import { ContentHash } from "@abracode/contracts/identities";
// Native storage normalizes JSON. Canonical keys keep hashes stable across readers.
export const canonicalJSON = canonicalJson;
export const presentationHash = (value: unknown) =>
  ContentHash.make(createHash("sha256").update(canonicalJSON(value)).digest("hex"));
