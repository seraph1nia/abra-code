import type { ComponentProps } from "react";
import { deferred } from "./deferred.tsx";

export const AttentionPanel = deferred<
  ComponentProps<typeof import("./presentation/attention-panel.tsx").AttentionPanel>
>(
  () =>
    import("./presentation/attention-panel.tsx").then((module) => ({
      default: module.AttentionPanel,
    })),
  "Current attention",
);
