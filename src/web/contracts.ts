import type { Form } from "@opencode/schema/form";
import type { Permission } from "@opencode/schema/permission";
import type { SubmissionReceipt } from "./gateway.ts";

import { type Effect, type Stream } from "effect";
import { type CrewError } from "../domain.ts";
import { type WorkspaceSnapshotSchema, type TranscriptMessageSchema } from "./http-api.ts";
export type WorkspaceSnapshot = typeof WorkspaceSnapshotSchema.Type;
export type TranscriptMessage = typeof TranscriptMessageSchema.Type;
export type SurfaceRecord = WorkspaceSnapshot["surfaces"][number];
export type AttentionForm = WorkspaceSnapshot["forms"][number];
export type AttentionPermission = WorkspaceSnapshot["permissions"][number];

export const workReadNames = [
  "detail",
  "document",
  "diff",
  "worker",
  "messages",
  "feedback",
  "report",
  "decisions",
  "artifacts",
] as const;
export type WorkReadName = (typeof workReadNames)[number];

/** The only browser-facing capability surface. No arbitrary native path or location. */
export interface WebBackend {
  readonly sessionID: string;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, CrewError>;
  history(
    cursor: string,
  ): Effect.Effect<{ messages: readonly TranscriptMessage[]; older?: string }, CrewError>;
  submit(input: {
    request_id: string;
    text: string;
    delivery: "queue" | "steer";
  }): Effect.Effect<SubmissionReceipt, CrewError>;
  readonly stop: Effect.Effect<boolean, CrewError>;
  read(name: WorkReadName, input: Record<string, string>): Effect.Effect<unknown, CrewError>;
  replyForm(input: {
    id: string;
    binding: string;
    answer: Form.Answer;
  }): Effect.Effect<void, CrewError>;
  replyPermission(input: {
    id: string;
    binding: string;
    decision: Permission.Reply;
  }): Effect.Effect<void, CrewError>;
  artifact(
    issue: string,
    request: string,
  ): Effect.Effect<
    { readonly html: string; readonly hash: string; readonly bytes: number },
    CrewError
  >;
  readonly changes: Stream.Stream<void, CrewError>;
}
