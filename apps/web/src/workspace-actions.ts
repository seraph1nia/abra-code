import { createContext } from "react";
import type { DraftAttachment } from "./workspace-state/draft.ts";
import type { WorkspaceSearch } from "./navigation.ts";
export const WorkspaceActions = createContext<{
  prepare?: (text: string) => void;
  attach: (attachment: DraftAttachment) => void;
  openSurface: (surface: NonNullable<WorkspaceSearch["surface"]>) => void;
}>({ attach: () => {}, openSurface: () => {} });
