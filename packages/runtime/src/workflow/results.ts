import { type ErrorCode } from "@abracode/contracts/identities";
import { type FailureCategory } from "@abracode/contracts/primitives";
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

export type DeliveryWait =
  typeof import("@abracode/contracts/workflow/operation-contracts").DeliveryWaitSchema.Type;
