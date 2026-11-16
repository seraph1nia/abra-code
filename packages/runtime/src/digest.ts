import { createHash } from "node:crypto";
/** Stable digest for controller-owned JSON evidence and semantic identities. */
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
