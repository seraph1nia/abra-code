import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRenderTool, useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import type { TranscriptTool } from "@abracode/contracts/web/presentation-contracts";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { ObservationContext } from "./tool-context.ts";
import { deferred } from "@abracode/presentation/deferred";

import { nativeToolCall, nativeToolMessage } from "@abracode/contracts/web/transcript";
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
const ToolRenderer = createContext<ReturnType<typeof useRenderToolCall> | null>(null);
export function ToolRenderingProvider({ children }: { children: ReactNode }) {
  const render = useRenderToolCall();
  useNativeToolRendering();
  return <ToolRenderer.Provider value={render}>{children}</ToolRenderer.Provider>;
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
  const render = useContext(ToolRenderer);
  const observation = useMemo(
    () => ({ tool, inspect, work, attachments }),
    [tool, inspect, work, attachments],
  );
  const toolCall = useMemo(() => nativeToolCall(tool), [tool]);
  const toolMessage = useMemo(() => nativeToolMessage(messageID, tool), [messageID, tool]);
  return (
    <ObservationContext.Provider value={observation}>
      <div data-native-renderer="copilotkit">{render?.({ toolCall, toolMessage })}</div>
    </ObservationContext.Provider>
  );
}
