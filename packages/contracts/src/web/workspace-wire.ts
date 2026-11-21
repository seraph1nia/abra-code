import { ThoughtReference } from "../visibility/thoughts.ts";
import { LinkedCheckSchema } from "../workflow/message-contracts.ts";
import { WorkSelectionSchema } from "./resources.ts";
import { BindingCoverageSchema } from "./bindings.ts";
import { ObservationSchema } from "./changes.ts";
import { PresentationPageSchema } from "../presentation/contracts.ts";
export { PresentationAttachmentSchema, PresentationPageSchema } from "../presentation/contracts.ts";
import { Schema } from "effect";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { SessionMessage } from "@opencode/schema/session-message";
import { SessionId, MessageId } from "../identities.ts";
import { WorkSnapshotSchema, DecisionSchema, DeclaredWaitSchema, ArtifactsSchema } from "./wire.ts";
import { SurfaceSchema } from "./surfaces.ts";
import { TranscriptPartSchema, TranscriptToolSchema } from "./presentation-contracts.ts";

/** Application wire contracts, shared by HTTP, native RPC and AG-UI. */
export const CapturedSelectionSchema = Schema.Struct({
  selection: WorkSelectionSchema,
  excerpt: Schema.String.check(Schema.isMaxLength(8192)),
});
export const SelectionFollowupSchema = Schema.Struct({
  request_id: Schema.String,
  role: Schema.String,
  status: Schema.String,
  acknowledged_at: Schema.optional(Schema.String),
  answer: Schema.optional(Schema.String),
  check: Schema.optional(LinkedCheckSchema),
});
export type SelectionFollowup = typeof SelectionFollowupSchema.Type;
export const selectionMarker = "\n\nSelected work (captured source)\n";
export function selectedQuestion(text: string) {
  const index = text.lastIndexOf(selectionMarker);
  if (index < 0) return;
  try {
    const source = Schema.decodeUnknownSync(
      Schema.Struct({
        request_id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/)),
        ...CapturedSelectionSchema.fields,
      }),
    )(JSON.parse(text.slice(index + selectionMarker.length)));
    return { text: text.slice(0, index), ...source };
  } catch {
    return;
  }
}
export const ReceiptSchema = Schema.Struct({
  request_id: Schema.String,
  message_id: SessionMessage.ID,
  answer: Schema.optionalKey(Schema.String),
  followups: Schema.optionalKey(Schema.Array(SelectionFollowupSchema)),
  capture: Schema.optionalKey(CapturedSelectionSchema),
  thought: Schema.optionalKey(ThoughtReference),
  native_text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32768))),
  text: Schema.String,
  delivery: Schema.Literals(["queue", "steer"]),
  status: Schema.Literals(["submitted", "admitted", "uncertain"]),
  at: Schema.String,
});
export type SubmissionReceipt = typeof ReceiptSchema.Type;
export const ReceiptLookupSchema = Schema.NullOr(ReceiptSchema);
export const TranscriptMessageSchema = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  at: Schema.String,
  files: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.optional(Schema.Array(TranscriptToolSchema)),
  parts: Schema.optional(Schema.Array(TranscriptPartSchema)),
});
export const CheckpointSchema = Schema.Struct({
  active: Schema.Boolean,
  issue_id: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["plan", "merge", "decision"])),
  fingerprint: Schema.optional(Schema.String),
  identity: Schema.optional(Schema.String),
  generation: Schema.optional(Schema.Int),
  finishing_target: Schema.optional(Schema.String),
});
export const SurfaceRecordSchema = Schema.Struct({
  session_id: Schema.String,
  tool_call_id: Schema.String,
  message_id: Schema.optional(MessageId),
  history: Schema.optional(Schema.Literals(["immutable", "latest-only"])),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  at: Schema.String,
  surface: SurfaceSchema,
  snapshot: WorkSnapshotSchema.fields.work.check(Schema.isMaxLength(100)),
  coverage: Schema.optionalKey(BindingCoverageSchema),
});
export const UnavailableSurfaceSchema = Schema.Struct({
  surface_id: Schema.String,
  unavailable: Schema.String,
});
export const SurfaceEntrySchema = Schema.Union([SurfaceRecordSchema, UnavailableSurfaceSchema]);
export const SurfaceReferenceSchema = Schema.Struct({
  surface_id: Schema.String,
  revision: SurfaceRecordSchema.fields.revision,
  at: SurfaceRecordSchema.fields.at,
  history: SurfaceRecordSchema.fields.history,
});
/** Full records remain a compatibility input; current native feeds emit references only. */
export const SurfaceIndexEntrySchema = Schema.Union([SurfaceEntrySchema, SurfaceReferenceSchema]);
export const ProjectsSchema = Schema.Array(
  Schema.Struct({ id: Schema.String, name: Schema.String, path: Schema.optional(Schema.String) }),
);
export const SubmissionSchema = Schema.Struct({
  thought: Schema.optionalKey(ThoughtReference),
  selection: Schema.optionalKey(WorkSelectionSchema),
  request_id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/)),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32768)),
  delivery: Schema.Literals(["queue", "steer"]),
});
export type Submission = typeof SubmissionSchema.Type;
export const ReceiptQuerySchema = Schema.Struct({
  request_id: SubmissionSchema.fields.request_id,
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
export const SubmissionOptionsSchema = Schema.Struct({
  thought: SubmissionSchema.fields.thought,
  selection: SubmissionSchema.fields.selection,
  request_id: SubmissionSchema.fields.request_id,
  delivery: Schema.optionalKey(SubmissionSchema.fields.delivery),
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
export const WorkspaceSnapshotSchema = Schema.Struct({
  observation: Schema.optional(ObservationSchema),
  session_id: SessionId,
  agent_id: Schema.Literal("abra"),
  at: Schema.String,
  busy: Schema.Boolean,
  outcome: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  messages: Schema.Array(TranscriptMessageSchema),
  older: Schema.optional(Schema.String),
  inbox: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String, delivery: Schema.String }),
  ),
  receipts: Schema.Array(ReceiptSchema),
  forms: Schema.Array(
    Schema.Struct({
      form: Form.Info,
      binding: Schema.String,
      active: Schema.Boolean,
      checkpoint: Schema.optional(CheckpointSchema),
    }),
  ),
  permissions: Schema.Array(Schema.Struct({ request: Permission.Request, binding: Schema.String })),
  projects: ProjectsSchema,
  work: WorkSnapshotSchema,
  work_unavailable: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  surfaces: Schema.Array(SurfaceIndexEntrySchema),
  presentations: Schema.optional(PresentationPageSchema),
});
export const WorkspaceStateSchema = Schema.Struct({ workspace: WorkspaceSnapshotSchema });
export const WorkspaceStateJson = Schema.toCodecJson(WorkspaceStateSchema);
export const NativeHistorySchema = Schema.Struct({
  decisions: Schema.Array(DecisionSchema),
  waits: Schema.Array(DeclaredWaitSchema),
  ...ArtifactsSchema.fields,
});
