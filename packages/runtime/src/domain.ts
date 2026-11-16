import { ErrorCode } from "./identities.ts";
import { Data, Schema } from "effect";
import {
  ApprovalSchema,
  Identifier,
  PolicySchema,
  RoleSchema,
  WorkerModelSchema,
} from "./contracts.ts";
export type ReadinessBlocker = typeof import("./contracts.ts").ReadinessBlockerSchema.Type;
export type Policy = typeof PolicySchema.Type;
export type Role = typeof RoleSchema.Type;
export type WorkerModel = typeof WorkerModelSchema.Type;
export type WorkerError = typeof import("./contracts.ts").WorkerErrorSchema.Type;
export type Phase = typeof import("./contracts.ts").PhaseSchema.Type;
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type Project = Mutable<typeof import("./storage/contracts.ts").ProjectRecordSchema.Type>;
export type { Issue } from "./work/model.ts";
export type Approval = Mutable<typeof ApprovalSchema.Type>;
/** Current-version working state. Persistence additionally validates phase evidence. */
type ExecutionState = Mutable<
  Omit<
    typeof import("./storage/contracts.ts").ExecutionStateSchema.Type,
    "approval_receipts" | "openspec_change"
  >
> & { approval_receipts: Approval[] };
export type Execution = ExecutionState & {
  setup?: false;
  openspec_change: import("./identities.ts").ChangeName;
};
export type SetupExecution = ExecutionState & {
  setup: true;
  openspec_change: import("./identities.ts").ChangeName | "";
};
export type ManagedExecution = Execution | SetupExecution;
export type SavedExecution = Mutable<
  typeof import("./storage/contracts.ts").ExecutionRecordSchema.Type
>;
export type Config = Mutable<typeof import("./config/contracts.ts").ConfigSchema.Type>;
export type OnboardInput = typeof import("./config/contracts.ts").ProjectInputSchema.Type;
export class CrewError extends Data.TaggedError("CrewError")<{
  code: ErrorCode;
  message: string;
  details?: unknown;
}> {
  static from(this: void, cause: unknown): CrewError {
    if (cause instanceof CrewError) return cause;
    const code =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code
        : "UNEXPECTED";
    const message =
      typeof cause === "object" &&
      cause !== null &&
      "message" in cause &&
      typeof cause.message === "string"
        ? cause.message
        : String(cause);
    return new CrewError(code, message, cause);
  }
  constructor(code: string, message: string, details?: unknown) {
    super({ code: ErrorCode.make(code), message, details });
  }
}
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
