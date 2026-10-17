import { type ErrorCode } from "../identities.ts";
import { type FailureCategory } from "../contracts.ts";
/** Expected external conditions are values; unsafe mutations still fail closed. */
export type OperationResult<A = void> =
  | { category: "completed"; value: A }
  | {
      category: Extract<typeof FailureCategory.Type, "waiting" | "retryable">;
      code: ErrorCode;
      reason: string;
      owner: string;
    }
  | { category: "verification" | "recovery"; code: ErrorCode; reason: string };

export type DeliveryWait = typeof import("./operation-contracts.ts").DeliveryWaitSchema.Type;
