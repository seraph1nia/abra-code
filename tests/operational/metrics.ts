import { Effect } from "effect";
import { performance } from "node:perf_hooks";
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { createWorkflow } from "../../src/opencode/application.ts";
import type { NativeRuntime, Runtime } from "../../src/opencode/runtime.ts";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Records } from "../../src/storage/store.ts";
import type { Locks } from "../../src/storage/lock.ts";
import type { Messages } from "../../src/workflow/messages.ts";
import type { AttentionService } from "../../src/workflow/attention.ts";
import type { Execution } from "../../src/domain.ts";
import type { LockKey } from "../../src/identities.ts";
import { installCommunicationFaults, installReportFault } from "./faults.ts";
import type { ReportRenderer } from "../../src/workflow/report-build.ts";
import type { Runner } from "../../src/process.ts";

/** Injected only into the disposable ProcessRunner, after its scoped spawn. */
export function recordReportChild(child: number, file: string, args: readonly string[]) {
  if (!file.endsWith("/vp") || args[0] !== "build") return;
  const output = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!output || !Number.isSafeInteger(child) || child <= 1)
    throw Error("Owned report child identity required");
  let columns: string[] = [];
  try {
    const raw = readFileSync(`/proc/${child}/stat`, "utf8");
    columns = raw
      .slice(raw.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  appendFileSync(
    join(output, "report-child-processes.jsonl"),
    JSON.stringify({
      schema_version: 1,
      parent_pid: process.pid,
      child_pid: child,
      group_id: columns.length ? Number(columns[2]) : undefined,
      start_ticks: columns[19],
    }) + "\n",
  );
}

type Measurement = { count: number; total_ms: number; max_ms: number };
type Snapshot = {
  schema_version: 1;
  pid: number;
  segment: string;
  observations: Record<string, Measurement>;
};
let snapshot: Snapshot | undefined;
const clients = new WeakSet<object>();
/** Installed only into disposable source copies by the opt-in native harness.
 * No production import, service, authority cache or persisted prompt is added. */
export function measureApplication(application: ReturnType<typeof createWorkflow>) {
  const output = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!output) throw Error("Operational metrics require external fixture evidence");
  if (!snapshot) {
    const path = join(output, "measurements.jsonl");
    snapshot = { schema_version: 1, pid: process.pid, segment: randomUUID(), observations: {} };
    appendFileSync(
      join(output, "report-child-processes.jsonl"),
      JSON.stringify({
        schema_version: 1,
        parent_pid: process.pid,
        ready: true,
      }) + "\n",
    );
    // Plugins can load distinct module instances. Append independent bounded
    // segments so their exit hooks cannot overwrite another application's counts.
    process.once("exit", () => appendFileSync(path, JSON.stringify(snapshot) + "\n"));
  }
  const measured =
    <Args extends unknown[], A, E, R>(
      name: string,
      fn: (...args: Args) => Effect.Effect<A, E, R>,
    ) =>
    (...args: Args): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        const start = performance.now();
        return fn(...args).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              const elapsed = performance.now() - start;
              const current = snapshot!.observations[name] ?? { count: 0, total_ms: 0, max_ms: 0 };
              current.count++;
              current.total_ms += elapsed;
              current.max_ms = Math.max(current.max_ms, elapsed);
              snapshot!.observations[name] = current;
            }),
          ),
        );
      });
  const workflow = (
    application.controller as unknown as {
      workflow: {
        runtime: Runtime;
        records: Records;
        messages: Messages;
        coordination: { locks: Locks };
        reports: { visual: { renderer: ReportRenderer } };
        attention: AttentionService;
      };
    }
  ).workflow;
  const runtime = workflow.runtime;
  installCommunicationFaults(runtime);
  installReportFault(workflow.records);
  const renderer = workflow.reports.visual.renderer;
  const runner = (renderer as unknown as { runner: Runner }).runner;
  const command = runner.run.bind(runner);
  runner.run = (file, args, cwd, env, options) => {
    if (!file.endsWith("/vp") || args[0] !== "build") return command(file, args, cwd, env, options);
    return command(file, args, cwd, env, {
      ...options,
      onProgress: (progress) =>
        Effect.sync(() => {
          appendFileSync(
            join(output, "report-process-progress.jsonl"),
            JSON.stringify({
              pid: process.pid,
              directory: args[1],
              at: progress.at,
              stdout_bytes: progress.stdout_bytes,
              stderr_bytes: progress.stderr_bytes,
            }) + "\n",
          );
        }).pipe(Effect.andThen(options?.onProgress?.(progress) ?? Effect.void)),
    });
  };
  const render = measured("report_build", renderer.render.bind(renderer));
  renderer.render = (snapshot, fingerprint) =>
    Effect.sync(() => {
      appendFileSync(
        join(output, "report-builds.jsonl"),
        JSON.stringify({ pid: process.pid, template: fingerprint }) + "\n",
      );
    }).pipe(Effect.andThen(render(snapshot, fingerprint)));
  const native = runtime as NativeRuntime;
  const client = native.client.bind(native);
  native.client = () =>
    client().pipe(
      Effect.tap((api) =>
        Effect.sync(() => {
          if (clients.has(api)) return;
          clients.add(api);
          api.session.active = measured("api_active", api.session.active.bind(api.session));
          api.session.inbox.list = measured(
            "api_inbox",
            api.session.inbox.list.bind(api.session.inbox),
          );
          api.session.context = measured("api_context", api.session.context.bind(api.session));
          api.session.message.get = measured(
            "api_exact_message",
            api.session.message.get.bind(api.session.message),
          );
          api.message.list = measured("api_history", api.message.list.bind(api.message));
        }),
      ),
    );
  const target = runtime as unknown as { ctx: Context };
  const ctx = target.ctx;
  target.ctx = {
    ...ctx,
    session: {
      ...ctx.session,
      get: measured("plugin_session_get", ctx.session.get.bind(ctx.session)),
      context: measured("plugin_context", ctx.session.context.bind(ctx.session)),
    },
  };
  runtime.session = measured("session_observation", runtime.session.bind(runtime));
  runtime.promptAdmission = measured(
    "single_admission_observation",
    runtime.promptAdmission.bind(runtime),
  );
  runtime.promptAdmissions = measured(
    "batch_admission_observation",
    runtime.promptAdmissions.bind(runtime),
  );
  runtime.prompt = measured("native_prompt_submission", runtime.prompt.bind(runtime));
  runtime.notify = measured("native_notice_submission", runtime.notify.bind(runtime));
  const store = workflow.records.store;
  let traceCount = 0;
  const trace = (value: unknown) => {
    if (traceCount++ < 256)
      appendFileSync(
        join(output, "communication-trace.jsonl"),
        JSON.stringify({ at: Date.now(), pid: process.pid, value }) + "\n",
      );
  };
  const incident = workflow.attention.responseIncident.bind(workflow.attention);
  workflow.attention.responseIncident = (...args) =>
    incident(...args).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (args[1].request_id.startsWith("native-recovery-"))
            trace({
              incident: args[1].request_id,
              reason: args[2],
              native: args[3] && {
                busy: args[3].busy,
                executing: args[3].executing,
                outcome: args[3].outcome,
                assignment: args[3].assignment,
              },
            });
        }),
      ),
    );
  const save = store.set.bind(store);
  store.set = (key, value) =>
    save(key, value).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (!key.startsWith("execution/") || !value || typeof value !== "object") return;
          const e = value as unknown as Execution;
          if (!e.messages?.some((m) => m.request_id.startsWith("native-recovery-"))) return;
          trace({
            committed: e.issue_id,
            turns: e.attention_turns,
            messages: e.messages.map((m) => ({
              id: m.request_id,
              status: m.type === "finding" ? "finding" : m.status,
              recovery: m.type === "finding" ? undefined : m.response_recovery?.status,
            })),
            attention: e.attention?.map((a) => ({
              code: a.code,
              status: a.status,
              id: a.id,
              prompt_id: a.prompt_id,
            })),
          });
        }),
      ),
    );
  store.get = measured("controller_storage_get", store.get.bind(store));
  store.set = measured("controller_storage_set", store.set.bind(store));
  store.entries = measured("controller_storage_entries", store.entries.bind(store));
  workflow.messages.reconcile = measured(
    "message_reconciliation",
    workflow.messages.reconcile.bind(workflow.messages),
  );
  application.controller.reconcile = measured(
    "execution_reconciliation",
    application.controller.reconcile.bind(application.controller),
  );
  application.scheduler.tick = measured(
    "scheduler_tick",
    application.scheduler.tick.bind(application.scheduler),
  );
  const locks = workflow.coordination.locks;
  const withLock = locks.with.bind(locks);
  locks.with = <A, E, R>(
    key: LockKey,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number },
  ) =>
    Effect.suspend(() => {
      const start = performance.now();
      return withLock(
        key,
        () => {
          if (key !== "controller") return action();
          const elapsed = performance.now() - start;
          const wait = snapshot!.observations.controller_lock_wait ?? {
            count: 0,
            total_ms: 0,
            max_ms: 0,
          };
          wait.count++;
          wait.total_ms += elapsed;
          wait.max_ms = Math.max(wait.max_ms, elapsed);
          snapshot!.observations.controller_lock_wait = wait;
          return measured("controller_lock_held", action)();
        },
        options,
      );
    });
}
