import type {
  WorkspaceSnapshotSchema,
  TranscriptMessageSchema,
  SurfaceRecordSchema,
  SurfaceEntrySchema,
} from "./workspace-wire.ts";
export type WorkspaceSnapshot = typeof WorkspaceSnapshotSchema.Type;
export type TranscriptMessage = typeof TranscriptMessageSchema.Type;
export type SurfaceRecord = typeof SurfaceRecordSchema.Type;
export type SurfaceEntry = typeof SurfaceEntrySchema.Type;
export type AttentionForm = WorkspaceSnapshot["forms"][number];
export type AttentionPermission = WorkspaceSnapshot["permissions"][number];
