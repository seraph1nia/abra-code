import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { bindObservationThread, ownObservationRequests } from "./observation-transport.ts";
import { transcriptFromAgent } from "@abracode/contracts/web/transcript";
import { ConversationRetention, retainConversation } from "./conversation.ts";
const updates = [UseAgentUpdate.OnMessagesChanged];
export function useWorkspaceObservation(
  initial: WorkspaceSnapshot,
  setError: (message: string) => void,
) {
  const registry = useContext(RegistryContext);
  const { agent, isReady } = useAgent({
    agentId: "abra",
    updates,
    throttleMs: 50,
  });
  const [state, setState] = useState<ObservationState>({
    workspace: initial,
    stateError: "",
    connectionError: "",
    conversation: retainConversation(undefined, initial),
  });
  const owner = useRef<WorkspaceObservation | undefined>(undefined);
  const initialRef = useRef(initial);
  const [retained] = useState(() => new ConversationRetention(state.conversation));
  const invalidate = useAtomSet(invalidateWork, { mode: "promiseExit" });
  useEffect(() => {
    if (!isReady) return;
    bindObservationThread(agent, initialRef.current.session_id);
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
      retained.read(),
    );
    owner.current = observation;
    const unsubscribe = observation.subscribe(setState);
    setState(observation.current());
    return () => {
      unsubscribe();
      initialRef.current = observation.current().workspace;
      observation.dispose();
      releaseRequests();
      owner.current = undefined;
    };
  }, [agent, isReady, registry, invalidate, setError, retained]);
  const messages = agent.messages;
  const conversation = useMemo(
    () =>
      retainConversation(
        retained.read(),
        state.workspace,
        isReady ? transcriptFromAgent(messages) : [],
      ),
    [retained, messages, state.workspace, isReady],
  );
  useLayoutEffect(() => {
    retained.commit(conversation);
  }, [retained, conversation]);
  const refresh = useCallback(() => {
    void owner.current?.refresh();
  }, []);
  const activities = useMemo(
    () => ({
      recent: new Set(
        messages
          .filter((m) => m.role !== "activity")
          .map((m) =>
            typeof m.metadata?.abracode_native_message_id === "string"
              ? m.metadata.abracode_native_message_id
              : m.id,
          ),
      ),
      references: new Map(
        messages.flatMap((m) => (m.role === "activity" ? [[m.id, m] as const] : [])),
      ),
    }),
    [messages],
  );
  return { ...state, conversation, isReady, refresh, activities };
}
