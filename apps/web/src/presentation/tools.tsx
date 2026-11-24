import { useMemo } from "react";
import { useRenderTool, useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import type { TranscriptTool } from "@abracode/contracts/web/presentation-contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { ObservationContext } from "./tool-context.ts";
import { deferred } from "../deferred.tsx";

type RenderToolCallInput = Parameters<ReturnType<typeof useRenderToolCall>>[0];
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
  const observation = useMemo(
    () => ({ tool, inspect, work, attachments }),
    [tool, inspect, work, attachments],
  );
  const toolCall = useMemo<RenderToolCallInput["toolCall"]>(
    () => ({
      id: tool.id,
      type: "function",
      function: { name: tool.name, arguments: "{}" },
    }),
    [tool.id, tool.name],
  );
  const toolMessage = useMemo<RenderToolCallInput["toolMessage"]>(
    () =>
      tool.status === "completed" || tool.status === "error"
        ? {
            id: `${messageID}:tool:${tool.id}:result`,
            role: "tool",
            toolCallId: tool.id,
            content: "",
          }
        : undefined,
    [messageID, tool.id, tool.status],
  );
  return (
    <ObservationContext.Provider value={observation}>
      <div data-native-renderer="copilotkit">{render({ toolCall, toolMessage })}</div>
    </ObservationContext.Provider>
  );
}
