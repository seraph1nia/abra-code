import type { ComponentProps } from "react";
import { deferred } from "@abracode/presentation/deferred";
export const Palette = deferred<ComponentProps<typeof import("./workspace-palette.tsx").default>>(
  () => import("./workspace-palette.tsx"),
  "Workspace search",
);
