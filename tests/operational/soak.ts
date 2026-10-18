import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";

const { values } = parseArgs({
  options: {
    cycles: { type: "string", default: "2" },
    concurrency: { type: "string", default: "1" },
    seed: { type: "string", default: "1" },
    "deadline-seconds": { type: "string", default: "1800" },
    "idle-seconds": { type: "string", default: "10" },
    profile: { type: "string", default: "full" },
    output: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
function integer(name: string, raw: string, min: number, max: number) {
  const n = Number(raw);
  assert.ok(Number.isSafeInteger(n) && n >= min && n <= max, `${name} must be ${min}..${max}`);
  return n;
}
const cycles = integer("cycles", values.cycles!, 1, 100);
const concurrency = integer("concurrency", values.concurrency!, 1, 4);
const seed = integer("seed", values.seed!, 0, 0xffffffff);
const deadline = integer("deadline-seconds", values["deadline-seconds"]!, 30, 86400);
const idleSeconds = integer("idle-seconds", values["idle-seconds"]!, 3, 120);
const profiles = [
  "full",
  "communication",
  "parallel",
  "reports",
  "acceptance",
  "crash-windows",
] as const;
type Profile = (typeof profiles)[number];
assert.ok(
  values.profile === "mixed" || profiles.includes(values.profile as Profile),
  "Unknown profile",
);
let randomState = seed || 1;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState >>> 0;
};
const faultSchedule = Array.from({ length: cycles }, (_, cycle) => ({
  cycle: cycle + 1,
  profile: (values.profile === "mixed"
    ? profiles[random() % profiles.length]
    : values.profile) as Profile,
}));
const declaration = {
  schema_version: 1,
  kind: "isolated-native-soak",
  seed,
  cycles,
  concurrency,
  deadline_seconds: deadline,
  idle_seconds: idleSeconds,
  fault_schedule: faultSchedule,
  runtime: { node: process.version, opencode: "2.0.28", provider: "deterministic loopback only" },
  coverage: {
    full: "Existing complete native journey: provider failure/retry, queued/reply/notification restart, parallel scheduling, decisions, findings, Review, reports, delivery and cleanup",
    communication:
      "Deliberately omitted worker/lead replies, one reminder, one escalation, idle restart and explicit stop",
    parallel:
      "Capacity/dependency waits, fair admission, user decision across restart and pause/resume",
    reports: "Existing portable report publication and artifact assertions",
    acceptance:
      "Three-task parallel maintenance, findings, human plan approval, restart, report, Review and verified branch delivery",
    "crash-windows":
      "Service loss before/after original native admission and after lead-parent notice commit; no replacement identities",
  },
  real_provider: "not run; separate authorization and credentials required",
};
if (values["dry-run"]) {
  process.stdout.write(JSON.stringify(declaration, null, 2) + "\n");
} else {
  assert.ok(values.output, "--output must name a new external evidence directory");
  const output = resolve(values.output);
  await mkdir(output); // Fail on an existing path rather than reuse an old receipt.
  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];
  const activeGroups = new Set<number>();
  let cancelled = false;
  const signalGroup = (pid: number, signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const cancel = () => {
    cancelled = true;
    for (const pid of activeGroups) signalGroup(pid, "SIGTERM");
    setTimeout(() => {
      for (const pid of activeGroups) signalGroup(pid, "SIGKILL");
    }, 5000).unref();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  let next = 0;
  const summary = () =>
    writeFile(
      join(output, "soak.json"),
      JSON.stringify(
        {
          ...declaration,
          revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          observed_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          result:
            results.length === cycles && results.every((r) => r.result === "pass")
              ? "pass"
              : "fail",
          runs: [...results].sort((a, b) => Number(a.cycle) - Number(b.cycle)),
          limitations: [
            "Fixture postconditions, not autonomous model judgment",
            "No trustworthy billable-token/cost usage",
            "Task/intervention metrics cover only explicitly instrumented subscenarios",
            "No report-publication crash-window or long idle resource guarantee is inferred from a clean teardown",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  await summary();
  async function cycle(index: number, profile: Profile) {
    const dir = join(output, `cycle-${index}`);
    await mkdir(dir);
    const elapsed = Date.now();
    const remaining = deadline * 1000 - (elapsed - started);
    if (remaining <= 0 || cancelled) {
      results.push({
        cycle: index,
        profile,
        result: "fail",
        reason: cancelled ? "cancelled_before_launch" : "deadline_before_launch",
      });
      await summary();
      return;
    }
    const journey = profile === "communication" ? "reply-recovery" : profile;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ABRACODE_TEST_EVIDENCE_DIR: dir,
      ABRACODE_TEST_METRICS: "1",
      ABRACODE_TEST_IDLE_MS: String(idleSeconds * 1000),
      ABRACODE_TEST_OPERATIONAL: "1",
    };
    if (profile === "full") delete env.ABRACODE_TEST_JOURNEY;
    else Object.assign(env, { ABRACODE_TEST_JOURNEY: journey });
    const child = spawn(
      process.execPath,
      [
        "node_modules/vite-plus/bin/vp",
        "test",
        "run",
        "--project",
        "e2e",
        "tests/e2e/native.test.ts",
      ],
      {
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.pid) activeGroups.add(child.pid);
    let timedOut = false;
    const statuses: string[] = [];
    // Keep only runner summaries; raw stdout may contain prompts or provider
    // bodies on assertion failure and is intentionally not retained as telemetry.
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n"))
        if (/^\s*(Test Files|Tests|Duration|Start at)\s/.test(line) && statuses.length < 16)
          statuses.push(line.trim().slice(0, 200));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const killOwnedGroup = (signal: NodeJS.Signals) => {
      if (child.pid) signalGroup(child.pid, signal);
    };
    let force: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      killOwnedGroup("SIGTERM");
      force = setTimeout(() => killOwnedGroup("SIGKILL"), 5000);
    }, remaining);
    const exit = await new Promise<number | null>((done) => {
      child.once("error", () => done(null));
      child.once("exit", (code) => done(code));
    }).finally(() => {
      clearTimeout(timeout);
    });
    if (timedOut || cancelled) {
      await new Promise<void>((done) => setTimeout(done, 5000));
      killOwnedGroup("SIGKILL");
    }
    if (force) clearTimeout(force);
    if (child.pid) activeGroups.delete(child.pid);
    type Receipt = {
      result?: string;
      cleanup_complete?: boolean;
      observations?: Array<Record<string, any>>;
      metrics?: Record<string, unknown>;
    };
    type Resources = { fixture_root: string; native_children: number[]; cleanup: string };
    const directories =
      profile === "full" ? [dir, join(dir, "reply-recovery"), join(dir, "crash-windows")] : [dir];
    const receipts: Array<Receipt | undefined> = [];
    const resources: Resources[] = [];
    let measurements: Record<string, any> | undefined;
    const segments: Array<{
      pid: number;
      observations: Record<string, { count: number; total_ms: number; max_ms: number }>;
    }> = [];
    let measuredDirectories = 0;
    const reportProcesses: Array<{
      parent_pid: number;
      child_pid?: number;
      group_id?: number;
      start_ticks?: string;
      ready?: boolean;
    }> = [];
    let trackedDirectories = 0;
    for (const directory of directories) {
      try {
        receipts.push(
          JSON.parse(await readFile(join(directory, "native-engineering.json"), "utf8")),
        );
      } catch {
        receipts.push(undefined);
      }
      try {
        resources.push(JSON.parse(await readFile(join(directory, "resources.json"), "utf8")));
      } catch {
        /* Missing ownership evidence cannot pass cleanup. */
      }
      try {
        const rows = (await readFile(join(directory, "report-child-processes.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        if (rows.some((row) => row.ready === true)) trackedDirectories++;
        reportProcesses.push(...rows);
      } catch {
        /* Missing compiler ownership evidence cannot pass cleanup. */
      }
      try {
        const content = await readFile(join(directory, "measurements.jsonl"), "utf8");
        segments.push(
          ...content
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line)),
        );
        measuredDirectories++;
      } catch {
        /* Failed/unavailable stays explicit. */
      }
    }
    if (segments.length) {
      measurements = {
        processes: new Set(segments.map((s) => s.pid)).size,
        segments: segments.length,
        complete: measuredDirectories === directories.length,
        observations: {},
      };
      for (const segment of segments)
        for (const [name, item] of Object.entries(segment.observations)) {
          const total = measurements.observations[name] ?? { count: 0, total_ms: 0, max_ms: 0 };
          total.count += item.count;
          total.total_ms += item.total_ms;
          total.max_ms = Math.max(total.max_ms, item.max_ms);
          measurements.observations[name] = total;
        }
    }
    const observations = receipts.flatMap((receipt) => receipt?.observations ?? []);
    let rootExists = resources.length !== directories.length;
    for (const resource of resources) {
      try {
        await access(resource.fixture_root);
        rootExists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") rootExists = true;
      }
    }
    const alive = resources
      .flatMap((resource) => resource.native_children)
      .filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
      });
    const cleanupComplete = receipts.every((receipt) => receipt?.cleanup_complete === true);
    const nativeParents = new Set(resources.flatMap((resource) => resource.native_children));
    const reportChildren = reportProcesses.filter((row) => row.child_pid !== undefined);
    const reportTrackingComplete =
      trackedDirectories === directories.length &&
      reportProcesses.every((row) => nativeParents.has(row.parent_pid)) &&
      reportChildren.every(
        (row) =>
          Number.isSafeInteger(row.child_pid) &&
          row.child_pid! > 1 &&
          row.group_id === row.child_pid &&
          !!row.start_ticks,
      );
    const aliveReportGroups = [
      ...new Set(
        reportChildren
          .filter((row) => row.child_pid === row.group_id && row.group_id! > 1)
          .map((row) => row.group_id!),
      ),
    ].filter((group) => {
      try {
        process.kill(-group, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
    });
    const communication = observations.find((o) => o.reply_recovery === "pass");
    const accepted = observations.find((o) => o.feature === "final-product-acceptance");
    const parallel = observations.find((o) => o.parallel_batch);
    const crashes = observations.find((o) => o.communication_crash_windows === "pass");
    const expected =
      profile === "communication"
        ? !!communication
        : profile === "full"
          ? !!communication && !!accepted && !!parallel && !!crashes
          : profile === "acceptance"
            ? !!accepted
            : profile === "crash-windows"
              ? !!crashes
              : profile === "parallel"
                ? !!parallel
                : observations.length > 0;
    const passed =
      exit === 0 &&
      !cancelled &&
      !timedOut &&
      receipts.every((receipt) => receipt?.result === "pass") &&
      cleanupComplete &&
      expected &&
      resources.length === directories.length &&
      resources.every((resource) => resource.cleanup === "removed") &&
      !rootExists &&
      alive.length === 0 &&
      reportTrackingComplete &&
      aliveReportGroups.length === 0 &&
      measurements?.complete === true &&
      (measurements?.observations?.controller_lock_held?.count ?? 0) > 0;
    const result = {
      cycle: index,
      profile,
      result: passed ? "pass" : "fail",
      exit_code: exit,
      timed_out: timedOut,
      duration_ms: Date.now() - elapsed,
      child_pid: child.pid,
      cleanup_complete: cleanupComplete,
      required_scenario_receipts: expected,
      resource_postconditions: {
        fixture_root_present: rootExists,
        alive_native_children: alive,
        report_process_tracking_complete: reportTrackingComplete,
        recorded_report_groups: reportChildren.length,
        alive_report_groups: aliveReportGroups,
      },
      metrics: {
        verified_task_completions:
          (accepted ? Object.keys(accepted.tasks).length : 0) + (parallel?.completed ?? 0),
        completion_coverage:
          "Only final-product-acceptance and parallel task sets; other native tasks excluded",
        recovery_attempts: communication?.attempts ?? null,
        answered_recovery_requests: communication?.answered ?? null,
        escalated_response_obligations: communication?.escalated ?? null,
        duplicate_admissions: communication
          ? [
              ...Object.values(communication.native_instruction_counts),
              communication.lead_recovery.native_instruction_counts,
            ].some((c: any) => c.original !== 1 || c.reminder !== 1)
            ? 1
            : 0
          : null,
        billable_tokens: null,
        cost: null,
        recovery_coverage: "Only the three deliberately omitted worker/lead requests",
        unanswered_before_explicit_stop: communication?.escalated ?? null,
        native_measurements: receipts.map((receipt) => receipt?.metrics ?? null),
        idle_observation: accepted?.idle_observation ?? null,
        measurements: measurements ?? null,
        unmeasured: [
          "human_interventions",
          "native_model_turns",
          "scheduler_wait_ms",
          "decision_delay_ms",
          "completion_notification_ms",
          "idle_cpu",
          "retained_state_bytes",
        ],
        residual_resources:
          cleanupComplete && !rootExists && alive.length === 0
            ? "Disposable root and owned server/provider removed by fixture"
            : "unknown; inspect retained fixture resource receipt",
      },
    };
    results.push(result);
    await writeFile(
      join(dir, "runner.json"),
      JSON.stringify({ ...result, summaries: statuses }, null, 2) + "\n",
    );
    await summary();
    process.stdout.write(`Cycle ${index}/${cycles} ${profile}: ${result.result}\n`);
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cycles) }, async () => {
      while (next < cycles) {
        const item = faultSchedule[next++]!;
        await cycle(item.cycle, item.profile);
      }
    }),
  );
  await summary();
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  if (!results.every((r) => r.result === "pass")) process.exitCode = 1;
}
