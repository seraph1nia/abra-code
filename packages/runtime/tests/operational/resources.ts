import { readFile, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

/** Read only children of the recorded disposable service, never host-wide PIDs. */
export async function compilerRunning(pid: number, home: string, progressFile?: string) {
  // Linux assigns a child to its creating thread. Bun/Node may spawn through a
  // service thread other than the main task; this remains confined to one owner.
  const children = new Set<string>();
  for (const thread of (await readdir(`/proc/${pid}/task`)).slice(0, 1024)) {
    try {
      for (const child of (await readFile(`/proc/${pid}/task/${thread}/children`, "utf8"))
        .trim()
        .split(/\s+/)
        .filter(Boolean))
        children.add(child);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const child of children) {
    try {
      const args = (await readFile(`/proc/${child}/cmdline`, "utf8")).split("\0");
      const directory = args.find((arg) =>
        arg.startsWith(join(home, ".abracode/reports/.scratch") + "/"),
      );
      if (args.includes("build") && directory) {
        if (!progressFile) return true;
        try {
          return (await readFile(progressFile, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .some(
              (p) =>
                p.pid === pid && p.directory === directory && p.stdout_bytes + p.stderr_bytes > 0,
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

/** Linux observations of the fixture's own native service, never a name lookup. */
export async function idleResources(pid: number, wait: () => Promise<void>) {
  const sample = async () => {
    const [raw, status] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/status`, "utf8"),
    ]);
    const columns = raw
      .slice(raw.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    return {
      user: Number(columns[11]),
      system: Number(columns[12]),
      start: columns[19],
      rss_kib: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]),
    };
  };
  let before: Awaited<ReturnType<typeof sample>> | undefined;
  let ticks = 0;
  try {
    ticks = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }));
    before = await sample();
  } catch {
    /* Measurement unavailable; the quiet-turn assertion still runs. */
  }
  const started = performance.now();
  await wait();
  const ms = performance.now() - started;
  if (!before || !ticks) return { status: "unavailable" as const, sample_ms: ms };
  try {
    const after = await sample();
    if (after.start !== before.start) return { status: "process_changed" as const, sample_ms: ms };
    const cpu = ((after.user - before.user + (after.system - before.system)) * 1000) / ticks;
    return {
      status: "observed" as const,
      sample_ms: ms,
      cpu_ms: cpu,
      cpu_percent: (cpu * 100) / ms,
      rss_before_kib: before.rss_kib,
      rss_after_kib: after.rss_kib,
      coverage: "Native service process only; excludes tool/flock/browser child CPU",
    };
  } catch {
    return { status: "unavailable" as const, sample_ms: ms };
  }
}

/** Byte counts only; no contents, symlinks or unbounded traversal in telemetry. */
export async function retainedBytes(roots: readonly string[]) {
  let files = 0,
    bytes = 0;
  const pending = [...roots];
  while (pending.length && files < 100000) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(directory, entry.name));
      else if (entry.isFile()) {
        files++;
        bytes += (await stat(join(directory, entry.name))).size;
      }
    }
  }
  return {
    files,
    bytes,
    complete: pending.length === 0,
    coverage:
      "Native data/state and central .abracode only; excludes source, dependency cache and worktree source bytes",
  };
}
