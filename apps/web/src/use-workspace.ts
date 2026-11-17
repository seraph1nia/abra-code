import { useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { useWorkspaceObservation } from "./workspace-state/observation.ts";
import { useWorkspaceHistory } from "./workspace-state/history.ts";

/** Compose independent owners for one fixed native session. */
export function useWorkspace(initial: WorkspaceSnapshot) {
  const [error, setError] = useState("");
  const observation = useWorkspaceObservation(initial, setError);
  const history = useWorkspaceHistory(observation.workspace, setError, observation.conversation);
  return { ...observation, ...history, error, setError };
}
