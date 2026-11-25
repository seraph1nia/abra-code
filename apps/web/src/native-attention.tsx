import type { ComponentProps } from "react";
import { deferred } from "@abracode/presentation/deferred";

// Keep lazy identities outside the frequently refreshed workspace shell so its
// HMR does not replace mounted binding-owned editors.
export const NativeForm = deferred<ComponentProps<typeof import("./attention.tsx").NativeForm>>(
  () => import("./attention.tsx").then((module) => ({ default: module.NativeForm })),
  "Native answer form",
);
export const NativePermission = deferred<
  ComponentProps<typeof import("./attention.tsx").NativePermission>
>(
  () => import("./attention.tsx").then((module) => ({ default: module.NativePermission })),
  "Native permission",
);
