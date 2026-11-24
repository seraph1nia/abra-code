import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CopilotKitContext,
  CopilotKitAgentIdContext,
  CopilotKitCoreReact,
} from "@copilotkit/react-core/v2/context";

/**
 * Public headless context for Abra's custom native-authoritative chat surface.
 * Uses `@copilotkit/react-core/v2/context` instead of `@copilotkit/react-core/v2`'s
 * full `CopilotKitProvider` so A2UI, KaTeX, Marked, and CopilotKit CSS stay out
 * of the initial bundle budget (`docs/verification/frontend-budget.json`).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [copilotkit] = useState(
    () =>
      new CopilotKitCoreReact({
        runtimeUrl: "/api/copilotkit",
        runtimeTransport: "rest",
        deferInitialConnection: true,
      }),
  );
  const connected = useRef(false);
  const [executingToolCallIds, setExecuting] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onToolExecutionStart: ({ toolCallId }) =>
        setExecuting((previous) => {
          if (previous.has(toolCallId)) return previous;
          const next = new Set(previous);
          next.add(toolCallId);
          return next;
        }),
      onToolExecutionEnd: ({ toolCallId }) =>
        setExecuting((previous) => {
          if (!previous.has(toolCallId)) return previous;
          const next = new Set(previous);
          next.delete(toolCallId);
          return next;
        }),
    });
    if (!connected.current) {
      connected.current = true;
      copilotkit.connect();
    }
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
