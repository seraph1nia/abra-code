import { createHash } from "node:crypto";
import { canonicalJson } from "@abracode/contracts/canonical-json";

/** Hash UTF-8 text or the exact bytes supplied by its owner. */
export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

/** SHA-256 hex digest of canonical JSON. */
export const sha256Json = (value: unknown): string => sha256(canonicalJson(value));

/** Stable digest for controller-owned JSON evidence and semantic identities. */
export const digest = (value: unknown) => sha256(JSON.stringify(value));
