import { readdir, readFile } from "node:fs/promises";

/** Linux fixture-tree RSS sampling. Reads process identities/statistics only. */
export async function sampleFixtureMemory() {
  let peak = 0,
    baseline = 0,
    samples = 0;
  let pending: Promise<void> | undefined;
  const sample = async () => {
    const entries = await readdir("/proc");
    const rows = (
      await Promise.all(
        entries
          .filter((entry) => /^\d+$/.test(entry))
          .map(async (id) => {
            try {
              const status = await readFile(`/proc/${id}/status`, "utf8");
              return {
                pid: Number(id),
                parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
                rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
              };
            } catch {
              return undefined;
            }
          }),
      )
    ).filter((row) => row !== undefined);
    const owned = new Set([process.pid]);
    for (let pass = 0; pass < rows.length; pass++) {
      const before = owned.size;
      for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
      if (owned.size === before) break;
    }
    const bytes = rows.filter((row) => owned.has(row.pid)).reduce((n, row) => n + row.rss, 0);
    if (samples++ === 0) baseline = bytes;
    peak = Math.max(peak, bytes);
  };
  await sample();
  const timer = setInterval(() => {
    if (!pending)
      pending = sample().finally(() => {
        pending = undefined;
      });
  }, 50);
  return async () => {
    clearInterval(timer);
    await pending;
    await sample();
    return {
      scope: "test-worker-and-descendants",
      baseline_bytes: baseline,
      peak_rss_bytes: peak,
      sample_interval_ms: 50,
      samples,
    };
  };
}
