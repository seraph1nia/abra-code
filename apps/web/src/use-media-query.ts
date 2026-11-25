import { useMemo, useSyncExternalStore } from "react";
export function useMediaQuery(query: string) {
  const store = useMemo(() => {
    const media = matchMedia(query);
    return {
      subscribe: (listener: () => void) => {
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
      },
      getSnapshot: () => media.matches,
    };
  }, [query]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
