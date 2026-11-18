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
