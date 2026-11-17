import { useMemo, useSyncExternalStore } from "react";

// A local external clock. It never requests or invents native observations.
const passed = (deadline: number) => Date.now() > deadline;
export function useDeadline(deadline: number) {
  const clock = useMemo(
    () => ({
      read: () => passed(deadline),
      subscribe: (changed: () => void) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const check = () => {
          if (passed(deadline)) {
            changed();
            return;
          }
          timer = setTimeout(
            check,
            Math.min(2_147_483_647, Math.max(1, deadline - Date.now() + 1)),
          );
        };
        check();
        return () => clearTimeout(timer);
      },
    }),
    [deadline],
  );
  return useSyncExternalStore(clock.subscribe, clock.read, clock.read);
}
