import { isDeepStrictEqual } from "node:util";
import { type StorageKey } from "@abracode/contracts/identities";
import {
  MessageIntentsSchema,
  messageHistoryError,
} from "@abracode/contracts/workflow/message-contracts";
import { Effect } from "effect";
import { decode } from "../decode.ts";
import {
  CrewError,
  type ManagedExecution,
  type Role,
  type SavedExecution,
  type SetupExecution,
} from "../domain.ts";
import { PlanningSchema, planningHistoryError } from "../workflow/planning-contracts.ts";
import { visualReportHistoryError } from "../reporting/report-contracts.ts";

export type SavedManagedRecord = SavedExecution | SetupExecution;

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (!jsonEqual(left[i], right[i])) return false;
    }
    return true;
  }
  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObj).filter((k) => leftObj[k] !== undefined);
  const rightKeys = Object.keys(rightObj).filter((k) => rightObj[k] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightObj, key)) return false;
    if (!jsonEqual(leftObj[key], rightObj[key])) return false;
  }
  return true;
}

function hasAppendOnlyPrefix<T>(prior: readonly T[], next: readonly T[] | undefined): boolean {
  if (!Array.isArray(next) || next.length < prior.length) return false;
  for (let i = 0; i < prior.length; i++) {
    if (!jsonEqual(prior[i], next[i])) return false;
  }
  return true;
}

function validateControlAndRevision(
  key: StorageKey,
  prior: SavedManagedRecord,
  next: ManagedExecution,
  control: boolean,
): CrewError | undefined {
  const expectedGeneration = control ? prior.control_generation + 1 : prior.control_generation;
  if (expectedGeneration !== next.control_generation) {
    return new CrewError(
      "STALE_OPERATION",
      `${key}: Control generation changed; discard stale result`,
    );
  }
  if (!control && prior.operation && next.operation) {
    const sameOperation =
      prior.operation.id === next.operation.id &&
      prior.operation.fingerprint === next.operation.fingerprint &&
      prior.operation.generation === next.operation.generation;
    const preparedAtSameRevision =
      next.operation.status === "prepared" && next.revision === prior.revision;
    if (!sameOperation && !preparedAtSameRevision) {
      return new CrewError(
        "STALE_OPERATION",
        `${key}: Operation identity changed; discard stale result`,
      );
    }
  }
  if (next.revision !== prior.revision) {
    return new CrewError(
      "STALE_REVISION",
      `${key}: Record revision changed; reread or commit only explicitly owned fields`,
    );
  }
  return undefined;
}

function validateSchemaAndPolicy(
  key: StorageKey,
  prior: SavedManagedRecord,
  next: ManagedExecution,
  control: boolean,
): CrewError | undefined {
  if (prior.openspec_schema !== next.openspec_schema) {
    return new CrewError("SCHEMA_REBIND", `${key}: Captured schema selection is immutable`);
  }
  const before = prior.openspec_schema_binding;
  const after = next.openspec_schema_binding;
  if (
    (before === undefined && after !== undefined) ||
    (before !== undefined &&
      (before.state === "bound"
        ? !isDeepStrictEqual(before, after)
        : !after || before.selection_source !== after.selection_source))
  ) {
    return new CrewError(
      "SCHEMA_REBIND",
      `${key}: Schema binding cannot be removed, rebound or fabricated for a legacy execution`,
    );
  }
  if (!control && !jsonEqual(prior.effective_policy, next.effective_policy)) {
    return new CrewError(
      "POLICY_DRIFT",
      `${key}: Effective execution policy is immutable without an explicit revision`,
    );
  }
  if (
    prior.configuration_snapshot !== undefined &&
    (!next.configuration_snapshot ||
      !jsonEqual(prior.configuration_snapshot, next.configuration_snapshot))
  ) {
    return new CrewError(
      "CONFIG_SNAPSHOT",
      "Captured execution model selections cannot be rewritten or removed",
    );
  }
  return undefined;
}

const externalIdentityFields = [
  "nonce",
  "submitted_head",
  "intent_digest",
  "validation_generation",
  "preflight",
] as const;

function validateRetainedHistories(
  prior: SavedManagedRecord,
  next: ManagedExecution,
): CrewError | undefined {
  if (prior.rounds && !hasAppendOnlyPrefix(prior.rounds, next.rounds)) {
    return new CrewError("ROUND_HISTORY", "Correction history cannot be rewritten or removed");
  }
  if (
    prior.external_history &&
    !hasAppendOnlyPrefix(prior.external_history, next.external_history)
  ) {
    return new CrewError("EXTERNAL_HISTORY", "External run history cannot be rewritten or removed");
  }
  if (prior.external_validation && prior.external_validation.custody !== "returned") {
    const nextExternal = next.external_validation;
    for (const field of externalIdentityFields) {
      if (!nextExternal || !jsonEqual(nextExternal[field], prior.external_validation[field])) {
        return new CrewError(
          "EXTERNAL_IDENTITY",
          "Active external launch cannot be rebound or removed",
        );
      }
    }
  }
  if (
    prior.feedback?.history &&
    !hasAppendOnlyPrefix(prior.feedback.history, next.feedback?.history)
  ) {
    return new CrewError(
      "FEEDBACK_HISTORY",
      "Retained feedback history cannot be removed or rewritten",
    );
  }
  if (prior.visual_reports) {
    const error = visualReportHistoryError(prior.visual_reports, next.visual_reports);
    if (error) return new CrewError("REPORT_HISTORY", error);
  }
  return undefined;
}

export function validateExecutionTransition(
  key: StorageKey,
  prior: SavedManagedRecord,
  next: ManagedExecution,
  control: boolean,
): Effect.Effect<void, CrewError> {
  return Effect.gen(function* () {
    const syncFailure =
      validateControlAndRevision(key, prior, next, control) ??
      validateSchemaAndPolicy(key, prior, next, control) ??
      validateRetainedHistories(prior, next);
    if (syncFailure) return yield* syncFailure;

    if (prior.messages) {
      const nextMessages = yield* decode(MessageIntentsSchema, next.messages, "Message history");
      const error = messageHistoryError(prior.messages, nextMessages);
      if (error) return yield* new CrewError("MESSAGE_HISTORY", error);
    }
    if (prior.planning) {
      const nextPlanning = yield* decode(PlanningSchema, next.planning, "Planning history");
      const error = planningHistoryError(prior.planning, nextPlanning);
      if (error) return yield* new CrewError("PLANNING_HISTORY", error);
    }
  });
}

export function newWorkerFailureRole(
  prior: SavedManagedRecord | undefined,
  decoded: SavedManagedRecord,
): Role | undefined {
  const failure = decoded.worker_failure;
  if (!failure?.role) return undefined;
  const previous = prior?.worker_failure;
  if (
    !previous ||
    previous.session_id !== failure.session_id ||
    previous.prompt_id !== failure.prompt_id ||
    previous.role !== failure.role ||
    !jsonEqual(previous.error, failure.error)
  ) {
    return failure.role;
  }
  return undefined;
}
