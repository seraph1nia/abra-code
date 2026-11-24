/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2/headless";
import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { Effect, Exit, Schema } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { WorkspaceStateJson } from "@abracode/contracts/web/workspace-wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { bootstrapQuery, invalidateWork } from "../data.ts";
import { requestError } from "../request-error.ts";
import { WorkspaceObservation, type ObservationState } from "./observation-client.ts";
import { HttpAgent } from "@ag-ui/client";
import { ownObservationRequests } from "./observation-transport.ts";
import { retainConversation } from "./conversation.ts";
const updates = [UseAgentUpdate.OnStateChanged];
export function useWorkspaceObservation(
  initial: WorkspaceSnapshot,
  setError: (message: string) => void,
) {
  const registry = useContext(RegistryContext);
  const { agent, isReady } = useAgent({
    agentId: "abra-workspace",
    runtimeAgentId: "abra",
    threadId: initial.session_id,
    updates,
  });
  const [state, setState] = useState<ObservationState>({
    workspace: initial,
    stateError: "",
    connectionError: "",
    conversation: retainConversation(undefined, initial),
  });
  const owner = useRef<WorkspaceObservation | undefined>(undefined);
  const initialRef = useRef(initial);
  const retained = useRef(state.conversation);
  const invalidate = useAtomSet(invalidateWork, { mode: "promiseExit" });
  useEffect(() => {
    if (!isReady) return;
    const releaseRequests = agent instanceof HttpAgent ? ownObservationRequests(agent) : () => {};
    let publishedState: unknown;
    const observation = new WorkspaceObservation(
      initialRef.current,
      {
        transport: {
          current: () => agent.state,
          subscribe: (listener) => {
            const subscription = agent.subscribe({
              onStateChanged: ({ state }) => {
                if (state === publishedState) {
                  publishedState = undefined;
                  return;
                }
                listener.state(state);
              },
              onCustomEvent: ({ event }) => listener.custom(event),
            });
            return () => subscription.unsubscribe();
          },
          connect: () => agent.connectAgent().then(() => undefined),
          detach: () => {
            void agent.detachActiveRun();
          },
          publish: (workspace) => {
            const encoded = Schema.encodeSync(WorkspaceStateJson)({ workspace });
            publishedState = encoded;
            agent.setState(encoded);
          },
        },
        baseline: async (signal) => {
          registry.refresh(bootstrapQuery);
          const result = await Effect.runPromiseExit(
            AtomRegistry.getResult(registry, bootstrapQuery, { suspendOnWaiting: true }),
            { signal },
          );
          if (Exit.isFailure(result)) throw new Error(requestError(result.cause));
          return result.value;
        },
        invalidate: async (scope) => {
          const result = await invalidate(scope);
          if (Exit.isFailure(result)) throw new Error(requestError(result.cause));
        },
        error: setError,
      },
      retained.current,
    );
    owner.current = observation;
    const unsubscribe = observation.subscribe(setState);
    setState(observation.current());
    return () => {
      unsubscribe();
      initialRef.current = observation.current().workspace;
      retained.current = observation.current().conversation;
      observation.dispose();
      releaseRequests();
      owner.current = undefined;
    };
  }, [agent, isReady, registry, invalidate, setError]);
  const refresh = useCallback(() => {
    void owner.current?.refresh();
  }, []);
  return { ...state, isReady, refresh };
}
