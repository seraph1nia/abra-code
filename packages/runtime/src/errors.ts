import { Data } from "effect";
import { ErrorCode } from "@abracode/contracts/identities";

export class CrewError extends Data.Error<{
  code: ErrorCode;
  message: string;
  details?: unknown;
}> {
  readonly _tag:
    | "CrewError"
    | "WorkflowError"
    | "StorageError"
    | "GitError"
    | "NativeAccessError"
    | "WorkGraphError"
    | "ConfigurationError" = "CrewError";
  override get name() {
    return this._tag;
  }
  static from(this: void, cause: unknown): CrewError {
    if (cause instanceof CrewError) return cause;
    const rawCode =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code.trim()
        : "";
    const code = rawCode.length > 0 ? rawCode : "UNEXPECTED";
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

export class WorkflowError extends CrewError {
  override readonly _tag = "WorkflowError" as const;
}

export class StorageError extends CrewError {
  override readonly _tag = "StorageError" as const;
}

export class GitError extends CrewError {
  override readonly _tag = "GitError" as const;
}

export class NativeAccessError extends CrewError {
  override readonly _tag = "NativeAccessError" as const;
}

export class WorkGraphError extends CrewError {
  override readonly _tag = "WorkGraphError" as const;
}

export class ConfigurationError extends CrewError {
  override readonly _tag = "ConfigurationError" as const;
}
