import { setTimeout } from "node:timers/promises";

/** Successful read assertions may wait for a short commit to release, never replay commands. */
export async function nativeObservation<A>(read: () => Promise<A>): Promise<A> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      const transient =
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "resource_unavailable" &&
        "data" in error &&
        error.data &&
        typeof error.data === "object" &&
        "code" in error.data &&
        error.data.code === "OBSERVATION_UNAVAILABLE";
      if (!transient) throw error;
      if (Date.now() >= deadline)
        throw new Error("Native retained observation stayed unavailable for five seconds", {
          cause: error,
        });
      await setTimeout(50);
    }
  }
}
