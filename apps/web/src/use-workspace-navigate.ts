import { useNavigate, useRouterState } from "@tanstack/react-router";
import { destinationFor } from "./navigation.ts";
export function useWorkspaceNavigate() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return useNavigate({ from: destinationFor(pathname) ?? "/" });
}
