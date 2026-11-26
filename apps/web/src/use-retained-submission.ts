import { useCallback, useRef, useState } from "react";
import type { Effect } from "effect";
import { useWorkspaceCall, type WorkspaceApi } from "./data.ts";

/** Reserve one submission synchronously, persist its exact retry identity, then
 * invoke the client. Each call owns its result even when another form submits. */
export function useRetainedSubmission<I, A, E>(
  call: (input: I) => Effect.Effect<A, E, WorkspaceApi>,
) {
  const invoke = useWorkspaceCall(call);
  const active = useRef(false);
  const [working, setWorking] = useState(false);
  const submit = useCallback(
    async (input: I, retain: () => boolean) => {
      if (active.current) return;
      active.current = true;
      try {
        if (!retain()) return;
        setWorking(true);
        return await invoke(input);
      } finally {
        active.current = false;
        setWorking(false);
      }
    },
    [invoke],
  );
  return { working, submit };
}
