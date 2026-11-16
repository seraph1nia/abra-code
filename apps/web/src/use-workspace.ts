import { useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { useWorkspaceObservation } from "./workspace-state/observation.ts";
import { useWorkspaceAdmission } from "./workspace-state/admission.ts";
import { useWorkspaceDraft } from "./workspace-state/draft.ts";
import { useWorkspaceHistory } from "./workspace-state/history.ts";

/** Compose independent owners for one fixed native session. */
export function useWorkspace(initial: WorkspaceSnapshot) {
  const [error, setError] = useState("");
  const observation = useWorkspaceObservation(initial, setError);
  const draft = useWorkspaceDraft(initial.session_id);
  const admission = useWorkspaceAdmission({ ...observation, ...draft, setError });
  const history = useWorkspaceHistory(observation.workspace, setError);
  return { ...observation, ...draft, ...admission, ...history, error, setError };
}
