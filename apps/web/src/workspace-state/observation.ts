/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2/headless";
import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { Effect, Exit, Schema } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { observationDecision } from "@abracode/contracts/web/observation";
import { mergeChanges, type ChangeScope } from "@abracode/contracts/web/changes";
import { WorkspaceStateJson } from "@abracode/contracts/web/workspace-wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { bootstrapQuery, invalidateWork } from "../data.ts";
import { requestError } from "../request-state.tsx";
const updates = [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnMessagesChanged];
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
  const [workspace, setWorkspace] = useState(initial);
  const [revision, setRevision] = useState(0);
  const latest = useRef(initial);
  const [stateError, setStateError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const invalidate = useAtomSet(invalidateWork, { mode: "promiseExit" });
  const pendingInvalidation = useRef<ChangeScope>({});
  const retiredEpochs = useRef(new Set<string>());
  const recover = useRef<() => void>(() => {});

  const accept = useCallback(
    (value: WorkspaceSnapshot) => {
      if (value.session_id !== initial.session_id || !Number.isFinite(Date.parse(value.at)))
        return false;
      const current = latest.current.observation,
        next = value.observation;
      if (next && retiredEpochs.current.has(next.epoch)) return true;
      const decision = observationDecision(current, next);
      if (decision === "duplicate") return true;
      if (decision === "baseline_required") {
        recover.current();
        return false;
      }
      if (current && next && current.epoch !== next.epoch) {
        retiredEpochs.current.add(current.epoch);
        if (retiredEpochs.current.size > 16)
          retiredEpochs.current.delete(retiredEpochs.current.values().next().value!);
      }
      latest.current = value;
      setWorkspace(value);
      const changes = next?.changes ?? { all: true };
      if (
        changes.all ||
        changes.work_all ||
        changes.finder ||
        changes.projects ||
        changes.issues?.length
      ) {
        pendingInvalidation.current = mergeChanges(pendingInvalidation.current, changes);
        setRevision((version) => version + 1);
      }
      return true;
    },
    [initial.session_id],
  );
  useEffect(() => {
    const receive = (state: unknown) => {
      if (!state || typeof state !== "object" || !Object.hasOwn(state, "workspace")) return;
      const result = Schema.decodeUnknownResult(WorkspaceStateJson)(state);
      if (result._tag === "Failure" || result.success.workspace.session_id !== initial.session_id) {
        setStateError("Workspace update unavailable. Showing the last valid state.");
        recover.current();
        return;
      }
      if (!accept(result.success.workspace)) {
        setStateError(
          "An older or invalid observation was received. Showing the last valid state.",
        );
        return;
      }
      setStateError("");
      setConnectionError("");
    };
    receive(agent.state);
    const subscription = agent.subscribe({
      onStateChanged: ({ state }) => receive(state),
      onCustomEvent: ({ event }) => {
        if (event.name === "abracode.freshness") {
          const value = event.value;
          const order = latest.current.observation;
          if (
            order &&
            value?.epoch === order.epoch &&
            value?.sequence === order.sequence &&
            typeof value?.at === "string" &&
            Number.isFinite(Date.parse(value.at))
          ) {
            const fresh = { ...latest.current, at: value.at };
            latest.current = fresh;
            setWorkspace(fresh);
            setConnectionError("");
          }
        }
        if (event.name === "abracode.connection" && event.value?.status === "reconnecting")
          setConnectionError(
            "Native observation unavailable. Reconnecting; showing the last valid state.",
          );
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, initial.session_id, accept]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const scope = pendingInvalidation.current;
      pendingInvalidation.current = {};
      void invalidate(scope).then((result) => {
        if (mounted.current && Exit.isFailure(result)) setError(requestError(result.cause));
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [revision, invalidate]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (!active) return;
      void agent
        .connectAgent()
        .catch(() => {
          if (active) setConnectionError("Live connection interrupted. Reconnecting…");
        })
        .finally(() => {
          if (active) timer = setTimeout(connect, 2000);
        });
    };
    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      void agent.detachActiveRun();
    };
  }, [agent, isReady]);

  const refresh = useCallback(() => {
    registry.refresh(bootstrapQuery);
    void Effect.runPromiseExit(
      AtomRegistry.getResult(registry, bootstrapQuery, { suspendOnWaiting: true }),
    ).then((result) => {
      if (!mounted.current) return;
      if (Exit.isSuccess(result)) {
        // HttpApi returns decoded values; AG-UI state must contain JSON wire values.
        if (accept(result.value))
          agent.setState(Schema.encodeSync(WorkspaceStateJson)({ workspace: latest.current }));
      } else setError(requestError(result.cause));
    });
  }, [registry, agent, accept]);

  const recovering = useRef(false);
  recover.current = () => {
    if (recovering.current) return;
    recovering.current = true;
    registry.refresh(bootstrapQuery);
    void Effect.runPromiseExit(
      AtomRegistry.getResult(registry, bootstrapQuery, { suspendOnWaiting: true }),
    ).then((result) => {
      recovering.current = false;
      if (!mounted.current) return;
      if (Exit.isSuccess(result) && accept(result.value)) {
        agent.setState(Schema.encodeSync(WorkspaceStateJson)({ workspace: latest.current }));
        setStateError("");
        setConnectionError("");
      } else if (Exit.isFailure(result)) setError(requestError(result.cause));
    });
  };
  return { workspace, isReady, stateError, connectionError, refresh };
}
