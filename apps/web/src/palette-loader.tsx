import type { ComponentProps } from "react";
import { deferred } from "./deferred.tsx";
export const Palette = deferred<ComponentProps<typeof import("./workspace-palette.tsx").default>>(
  () => import("./workspace-palette.tsx"),
  "Workspace search",
);
