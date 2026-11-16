import { createHash } from "node:crypto";
import { ContentHash } from "../identities.ts";
// Native storage normalizes JSON. Canonical keys keep hashes stable across readers.
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
export const presentationHash = (value: unknown) =>
  ContentHash.make(createHash("sha256").update(canonicalJSON(value)).digest("hex"));
