import { useSyncExternalStore } from "react";
import { useTheme } from "./theme.tsx";

type Notifications = typeof import("sonner");
let loaded: Notifications | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => loaded;

async function notify(
  kind: "error" | "success",
  args: Parameters<Notifications["toast"]["error"]>,
) {
  const module = await import("sonner");
  if (!loaded) {
    loaded = module;
    for (const listener of listeners) listener();
  }
  // Sonner replays active notices when the first Toaster subscribes.
  module.toast[kind](...args);
}

export const toast = {
  error: (...args: Parameters<Notifications["toast"]["error"]>) => void notify("error", args),
  success: (...args: Parameters<Notifications["toast"]["success"]>) => void notify("success", args),
  dismiss: (id: string) => loaded?.toast.dismiss(id),
};

export function WorkspaceToaster() {
  const module = useSyncExternalStore(subscribe, snapshot);
  const { resolved } = useTheme();
  return module ? (
    <module.Toaster
      theme={resolved}
      position="top-right"
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 52px)" }}
    />
  ) : null;
}
