import { useRenderTool, useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import type { TranscriptTool } from "@abracode/contracts/web/presentation-contracts";
import { nativeToolCall, nativeToolMessage } from "@abracode/contracts/web/transcript";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { ObservationContext } from "./tool-context.ts";
import { deferred } from "../deferred.tsx";
const ObservedTool = deferred<{ toolCallId: string }>(
  () => import("./tool-body.tsx").then((module) => ({ default: module.ObservedTool })),
  "Native tool presentation",
);

/** Render-only registry: no handler, parameter registration, follow-up or model tool. */
export function useNativeToolRendering() {
  useRenderTool(
    {
      name: "*",
      render: ({ toolCallId }: { toolCallId: string }) => <ObservedTool toolCallId={toolCallId} />,
    },
    [],
  );
}
export function ToolObservation({
  messageID,
  tool,
  inspect,
  work,
  attachments,
}: {
  messageID: string;
  tool: TranscriptTool;
  inspect: Inspect;
  work: readonly WebWorkItem[];
  attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
}) {
  const render = useRenderToolCall();
  return (
    <ObservationContext.Provider value={{ tool, inspect, work, attachments }}>
      <div data-native-renderer="copilotkit">
        {render({
          toolCall: nativeToolCall(tool),
          toolMessage: nativeToolMessage(messageID, tool),
        })}
      </div>
    </ObservationContext.Provider>
  );
}
