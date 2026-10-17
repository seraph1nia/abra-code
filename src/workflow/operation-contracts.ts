import {
  OperationAction,
  ErrorCode,
  OperationId,
  Fingerprint,
  SessionId,
  MessageId,
} from "../identities.ts";

import { Schema } from "effect";
import { Count, NonEmpty, Commit, Positive } from "../contracts.ts";
export const OperationIntentSchema = Schema.Struct({
  id: OperationId,
  generation: Count,
  fingerprint: Fingerprint,
  action: OperationAction,
  status: Schema.Literals([
    "prepared",
    "running",
    "uncertain",
    "completed",
    "stop_requested",
    "stopped",
  ]),
  expected: NonEmpty,
  started_at: Count,
  deadline_at: Schema.optional(Count),
  session_id: Schema.optional(SessionId),
  prompt_id: Schema.optional(MessageId),
});
export const DeliveryWaitSchema = Schema.Struct({
  category: Schema.Literals(["waiting", "retryable"]),
  code: ErrorCode,
  reason: NonEmpty,
  owner: NonEmpty,
  fingerprint: Commit,
  attempts: Positive,
  observed_at: Count,
  next_check_at: Count,
});
