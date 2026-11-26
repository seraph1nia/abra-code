export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function eventually<T>(action: () => Promise<T | undefined>, timeout = 30000) {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      if (error && typeof error === "object" && "terminal" in error) throw error;
      last = error;
    }
    await delay(100);
  }
  throw Error(`Timed out: ${(last as Error)?.message ?? "condition not met"}`);
}
