import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import {
  CopilotKitContext,
  CopilotKitAgentIdContext,
  CopilotKitCoreReact,
} from "@copilotkit/react-core/v2/context";

/** Public headless context for Abra's custom native-authoritative chat surface. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [copilotkit] = useState(
    () =>
      new CopilotKitCoreReact({
        runtimeUrl: "/api/copilotkit",
        runtimeTransport: "rest",
        deferInitialConnection: true,
      }),
  );
  const [executingToolCallIds, setExecuting] = useState<ReadonlySet<string>>(() => new Set());
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onRenderToolCallsChanged: () => render(),
      onToolExecutionStart: ({ toolCallId }) =>
        setExecuting((previous) => new Set([...previous, toolCallId])),
      onToolExecutionEnd: ({ toolCallId }) =>
        setExecuting((previous) => {
          const next = new Set(previous);
          next.delete(toolCallId);
          return next;
        }),
    });
    copilotkit.connect();
    return () => subscription.unsubscribe();
  }, [copilotkit]);
  const value = useMemo(
    () => ({ copilotkit, executingToolCallIds, showIntelligenceIndicator: false }),
    [copilotkit, executingToolCallIds],
  );
  return (
    <CopilotKitContext.Provider value={value}>
      <CopilotKitAgentIdContext.Provider value="abra">{children}</CopilotKitAgentIdContext.Provider>
    </CopilotKitContext.Provider>
  );
}
