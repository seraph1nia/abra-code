import { type StorageKey } from "@abracode/contracts/identities";
import { ensure } from "../domain.ts";

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isLegacyRecord(raw: unknown): raw is Record<string, unknown> {
  return isRecordObject(raw) && raw.schema_version === undefined;
}

/** Read-only v0→v1 normalization. Only a coordinated save writes a migration and its original. */
export function normalizeRecord(key: StorageKey, raw: unknown): Record<string, unknown> {
  ensure(isRecordObject(raw), "INVALID_RECORD", `${key}: Expected a record`);
  ensure(
    raw.schema_version === undefined || raw.schema_version === 1,
    "UNSUPPORTED_RECORD_VERSION",
    `${key}: Unsupported record version; preserve data and use a compatible runtime`,
  );
  const expectedID = key.slice(key.indexOf("/") + 1);
  ensure(
    (key.startsWith("project/")
      ? raw.id
      : key.startsWith("setup/")
        ? raw.repository_id
        : raw.issue_id) === expectedID,
    "RECORD_IDENTITY",
    `${key}: Record identity does not match its key`,
  );
  if (key.startsWith("project/")) {
    return {
      diagnostic_turns: 1,
      repair_rounds: 0,
      generated_paths: [],
      merge_method: "merge",
      ci_policy: "all-reported",
      allow_no_checks: false,
      max_executions: raw.max_workers,
      branch_policy: "fixed",
      managed: false,
      ...raw,
      ...(raw.schema_version === undefined ? { schema_version: 1, revision: 1 } : {}),
    };
  }
  if (raw.schema_version === 1) return raw;
  const setup = key.startsWith("setup/");
  return {
    ...raw,
    schema_version: 1,
    revision: 1,
    control_generation: 0,
    ...(setup ? { plan_approval_required: false } : {}),
    effective_policy: {
      verification: isRecordObject(raw.verification_receipt)
        ? raw.verification_receipt.commands
        : [],
      delivery: raw.delivery_policy,
      plan_approval: setup ? false : raw.plan_approval_required,
      merge_approval: raw.merge_approval_required,
      merge_method: "merge",
      ci_policy: "all-reported",
      allow_no_checks: false,
      generated_paths: [],
      diagnostic_turns: 1,
      repair_rounds: 0,
    },
  };
}
