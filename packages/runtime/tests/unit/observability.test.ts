import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Metric, Logger, References } from "effect";
import * as Id from "../../src/identities.ts";
import {
  observerRequest,
  observerRequests,
  providerFailures,
  reconcileDuration,
  measureReconcile,
  correlate,
} from "../../src/observability.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

test("observations use finite labels, safe retained correlation and count distinct committed worker failures", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const metric = providerFailures.pipe(Metric.withAttributes({ role: "explore" }));
  const before = await run(Metric.value(metric));
  const failure = { type: "provider.authentication", message: "Bearer private-token", status: 403 };
  await run(f.controller.recordWorkerFailure(e.explore_session_id!, failure));
  await run(f.controller.recordWorkerFailure(e.explore_session_id!, failure));
  assert.equal((await run(Metric.value(metric))).count, before.count + 1);
  const requestMetric = observerRequests.pipe(Metric.withAttributes({ method: "detail" }));
  const requests = await run(Metric.value(requestMetric));
  await run(observerRequest("detail"));
  assert.equal((await run(Metric.value(requestMetric))).count, requests.count + 1);
  const durations = await run(Metric.value(reconcileDuration));
  await run(measureReconcile(Effect.void));
  assert.equal((await run(Metric.value(reconcileDuration))).count, durations.count + 1);
  const logs: unknown[] = [];
  const logger = Logger.make((entry) => {
    logs.push({
      message: entry.message,
      annotations: entry.fiber.getRef(References.CurrentLogAnnotations),
    });
  });
  await run(
    correlate(Effect.log("Retained operation"), e).pipe(Effect.provide(Logger.layer([logger]))),
  );
  const serialized = JSON.stringify(logs);
  assert.match(serialized, /issue_id|abra-1/);
  assert.doesNotMatch(serialized, /private-token|Bearer/);
});
