import { createHash } from "node:crypto";
import { canonicalJson } from "@abracode/contracts/canonical-json";

/** SHA-256 hex digest of a UTF-8 string. */
export const sha256Text = (text: string): string => createHash("sha256").update(text).digest("hex");

/** SHA-256 hex digest of raw bytes. */
export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** SHA-256 hex digest of canonical JSON. */
export const sha256Json = (value: unknown): string => sha256Text(canonicalJson(value));

/** Stable digest for controller-owned JSON evidence and semantic identities. */
export const digest = (value: unknown) => sha256Text(JSON.stringify(value));
