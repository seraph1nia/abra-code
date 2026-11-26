export const browserVisibility = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  subscribe: (listener: () => void) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
