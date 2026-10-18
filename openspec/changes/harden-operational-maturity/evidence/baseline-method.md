# Planning reconciliation probe

Executed against `d38274bb72697a92cd0fdd52bab4cd065a3688dd` on 2026-10-18. This temporary fixture-only probe did not change application code or touch live services. It seeded the in-memory test store directly for independent distributions, called the existing message service, and counted adapter/storage invocations. It used one warmup and five measured samples per case. Repeated fixture state is reset before each sample; the original native IDs are marked consumed in the fake runtime. Historical generation rows are synthetically older, not a simulated native restart.

To reproduce from this checkout, save the fenced source as `/tmp/abra-operational-baseline.mts` and run `pnpm exec tsx /tmp/abra-operational-baseline.mts`. Absolute imports target the inspected checkout; adjust the common root when replaying elsewhere. Reproduce these measurements before modifying production behavior; the permanent benchmark task adds actual API/lock/scheduler/memory instrumentation.

The fixture returns immediately from native observations. Wall times therefore include Effect and in-memory record validation/serialization, not network/service/provider latency. Missing count keys in the JSON mean zero calls. No performance improvement, real API traffic count or scheduler impact has been measured yet.

```typescript
import { Effect } from "/home/bart/projects/personal/opencrew/node_modules/effect/dist/index.js";
import { fixture } from "/home/bart/projects/personal/opencrew/tests/fixtures.ts";
import { run } from "/home/bart/projects/personal/opencrew/tests/effects.ts";
import * as Id from "/home/bart/projects/personal/opencrew/src/identities.ts";
import { messageRequests } from "/home/bart/projects/personal/opencrew/src/workflow/message-contracts.ts";
import { performance } from "node:perf_hooks";
const f = await run(fixture);
try {
  const issue = Id.IssueId.make("baseline-owner");
  f.work.add(issue);
  const initial = await run(f.controller.start(issue, Id.SessionId.make("ses_supervisor")));
  await run(
    f.controller.workMessage(
      {
        issue_id: issue,
        request_id: Id.RequestId.make("baseline-request"),
        role: "explore",
        body: "Baseline answer",
        response: "answer",
      },
      Id.SessionId.make("ses_supervisor"),
    ),
  );
  const base = await run(f.controller.get(issue));
  const original = messageRequests(base.messages)[0]!;
  const service = (f.controller as any).workflow.messages;
  let counts: Record<string, number> = {};
  for (const [owner, key, label] of [
    [f.runtime, "session", "session"],
    [f.runtime, "promptAdmission", "admission"],
    [f.runtime, "prompt", "prompt"],
    [f.records.store, "get", "storage_get"],
    [f.records.store, "set", "storage_set"],
  ] as const) {
    const fn = (owner as any)[key].bind(owner);
    (owner as any)[key] = (...args: any[]) =>
      Effect.suspend(() => {
        counts[label] = (counts[label] ?? 0) + 1;
        return fn(...args);
      });
  }
  const rows = [];
  for (const n of [1, 10, 25, 100, 200])
    for (const distribution of [
      "answered",
      "acknowledged",
      "terminal_one_pending",
      "admission_uncertain",
      "unanswered",
      "mixed_generations",
      "superseded",
    ]) {
      const samples = [];
      let first: any;
      for (let rep = 0; rep < 6; rep++) {
        const e: any = structuredClone(base);
        e.control_generation = 2;
        e.messages = Array.from({ length: n }, (_, i) => {
          let status = "answered",
            generation = 2;
          if (distribution === "acknowledged") status = "acknowledged";
          if (distribution === "terminal_one_pending" && i === n - 1) status = "pending";
          if (distribution === "admission_uncertain" && i < Math.min(3, n))
            status = "admission_uncertain";
          if (distribution === "unanswered" && i < Math.min(3, n)) status = "admitted";
          if (distribution === "mixed_generations" && i % 2 === 0) generation = 1;
          if (distribution === "superseded") status = "superseded";
          const m: any = {
            ...original,
            request_id: Id.RequestId.make(`baseline-${i}`),
            prompt_id: Id.MessageId.make(`msg_baseline${i}`),
            generation,
            status,
            response: distribution === "acknowledged" ? "acknowledgement" : "answer",
          };
          if (["answered", "acknowledged"].includes(status)) m.acknowledged_at = m.created_at;
          if (status === "answered")
            m.reply = { body: "Measured fixture reply", evidence: [], at: m.created_at };
          f.runtime.admissions.add(m.prompt_id);
          return m;
        });
        (f.records.store as any).values.set(`execution/${issue}`, structuredClone(e));
        counts = {};
        const before = performance.now();
        await run(service.reconcile(e));
        const ms = performance.now() - before;
        if (rep > 0) samples.push(ms);
        if (rep === 1) first = { ...counts };
      }
      rows.push({
        n,
        distribution,
        ...first,
        median_ms: Number(samples.sort((a, b) => a - b)[2].toFixed(3)),
        max_ms: Number(Math.max(...samples).toFixed(3)),
      });
    }
  console.log(
    JSON.stringify(
      {
        kind: "fixture-only Messages.reconcile baseline",
        date: new Date().toISOString(),
        samples_per_case: 5,
        warmup: 1,
        native_calls: "adapter calls; real API traffic not executed",
        lock_scheduler_memory: "not measured; requires controller/native harness",
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await run(f.close());
}
```
