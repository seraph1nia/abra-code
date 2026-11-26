import { CrewError } from "./errors.ts";
export { CrewError } from "./errors.ts";
import { Schema } from "effect";
import {
  ApprovalSchema,
  Identifier,
  PolicySchema,
  RoleSchema,
  WorkerModelSchema,
} from "@abracode/contracts/primitives";
export type ReadinessBlocker =
  typeof import("@abracode/contracts/primitives").ReadinessBlockerSchema.Type;
export type Policy = typeof PolicySchema.Type;
export type Role = typeof RoleSchema.Type;
export type WorkerModel = typeof WorkerModelSchema.Type;
export type WorkerError = typeof import("@abracode/contracts/primitives").WorkerErrorSchema.Type;
export type Phase = typeof import("@abracode/contracts/primitives").PhaseSchema.Type;
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type Project = Mutable<typeof import("./storage/contracts.ts").ProjectRecordSchema.Type>;
export type { Issue } from "./work/model.ts";
export type Approval = typeof ApprovalSchema.Type;
/** Validated execution snapshots. Persisted changes produce a new revision. */
type ExecutionState = Omit<
  typeof import("./storage/contracts.ts").ExecutionStateSchema.Type,
  "openspec_change"
>;
export type Execution = ExecutionState & {
  readonly setup?: false;
  readonly openspec_change: import("@abracode/contracts/identities").ChangeName;
};
export type SetupExecution = ExecutionState & {
  readonly setup: true;
  readonly openspec_change: import("@abracode/contracts/identities").ChangeName | "";
};
export type ManagedExecution = Execution | SetupExecution;
export type SavedExecution = typeof import("./storage/contracts.ts").ExecutionRecordSchema.Type;
export type Config = Mutable<typeof import("./config/contracts.ts").ConfigSchema.Type>;
export type OnboardInput = typeof import("./config/contracts.ts").ProjectInputSchema.Type;
export function ensure(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new CrewError(code, message);
}
export function identifier(value: string): typeof Identifier.Type {
  try {
    return Schema.decodeSync(Identifier)(value);
  } catch {
    throw new CrewError("INVALID_ID", "Identifier must be 1–101 safe characters");
  }
}
export const terminal = (e: Execution) => e.current_phase === "completed";
