import type { AttentionForm } from "@abracode/contracts/web/contracts";
import { createContext } from "react";
import type { TranscriptTool } from "@abracode/contracts/web/presentation-contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
export const ObservationContext = createContext<
  | {
      tool: TranscriptTool;
      inspect: Inspect;
      work: readonly WebWorkItem[];
      attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
    }
  | undefined
>(undefined);

export const TranscriptData = createContext<{
  work: readonly WebWorkItem[];
  forms: readonly AttentionForm[];
}>({ work: [], forms: [] });

export function attachmentKey(attachment: typeof PresentationAttachmentSchema.Type): string {
  const { target } = attachment;
  const targetKey =
    target.kind === "review"
      ? `review:${target.review_id}:${target.revision}`
      : target.kind === "surface"
        ? `surface:${target.surface_id}:${target.revision}`
        : `artifact:${target.issue_id}:${target.request_id}:${target.hash}`;
  return `${attachment.session_id}:${attachment.message_id}:${attachment.tool_call_id ?? ""}:${attachment.source}:${targetKey}`;
}
