import type { Form } from "@opencode/schema/form";
import type { Permission } from "@opencode/schema/permission";
import type { SubmissionReceipt } from "./gateway.ts";
import type { ResourceSelection } from "./resources.ts";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "./report-actions.ts";
import type { ArtifactSummarySchema } from "./wire.ts";

import { type Effect, type Stream } from "effect";
import { type CrewError } from "../domain.ts";
import {
  type WorkspaceSnapshotSchema,
  type TranscriptMessageSchema,
  type PresentationPageSchema,
  type SurfaceEntrySchema,
} from "./workspace-wire.ts";
export type WorkspaceSnapshot = typeof WorkspaceSnapshotSchema.Type;
export type TranscriptMessage = typeof TranscriptMessageSchema.Type;
export type SurfaceRecord = typeof import("./workspace-wire.ts").SurfaceRecordSchema.Type;
export type SurfaceEntry = typeof SurfaceEntrySchema.Type;
export type AttentionForm = WorkspaceSnapshot["forms"][number];
export type AttentionPermission = WorkspaceSnapshot["permissions"][number];

export const workReadNames = [
  "find",
  "leads",
  "detail",
  "document",
  "diff",
  "worker",
  "worker-history",
  "messages",
  "feedback",
  "report",
  "decisions",
  "artifacts",
  "artifact-document",
  "artifact-summary",
] as const;
export type WorkReadName = (typeof workReadNames)[number];

/** The only browser-facing capability surface. No arbitrary native path or location. */
export interface WebBackend {
  readonly sessionID: string;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot, CrewError>;
  resolve(target: ResourceSelection): Effect.Effect<ResourceSelection, CrewError>;
  surface(id: string, revision: number): Effect.Effect<SurfaceEntry, CrewError>;
  history(cursor: string): Effect.Effect<
    {
      messages: readonly TranscriptMessage[];
      older?: string;
      presentations?: typeof PresentationPageSchema.Type;
    },
    CrewError
  >;
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
  exportDocument(
    input: typeof ExportDocumentSchema.Type,
  ): Effect.Effect<
    typeof import("../presentation/report-export-contract.ts").ReportExportSchema.Type,
    CrewError
  >;
  readExport(input: typeof ReadExportSchema.Type): Effect.Effect<
    typeof import("../presentation/report-export-contract.ts").ReportExportSchema.Type & {
      html: string;
    },
    CrewError
  >;
  saveSurface(
    input: typeof SaveSurfaceSchema.Type,
  ): Effect.Effect<typeof ArtifactSummarySchema.Type, CrewError>;
  artifact(
    issue: string,
    request: string,
  ): Effect.Effect<
    { readonly html: string; readonly hash: string; readonly bytes: number },
    CrewError
  >;
  readonly changes: Stream.Stream<void, CrewError>;
}
