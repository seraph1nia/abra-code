import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { ownObservationRequests } from "@abracode/web/observation-transport";

test("observation cleanup aborts owned HTTP reads, preserves SDK cancellation and permits fresh setup", async () => {
  const reads: { url: string; signal?: AbortSignal | null }[] = [];
  const original = async (url: string, request: RequestInit) => {
    reads.push({ url, signal: request.signal });
    return new Response("");
  };
  const agent = { fetch: original };
  const release = ownObservationRequests(agent);
  const sdk = new AbortController();
  await agent.fetch("/api/copilotkit/agent/abra/connect", { signal: sdk.signal });
  assert.equal(reads[0].signal?.aborted, false);
  sdk.abort();
  assert.equal(reads[0].signal?.aborted, true);
  await agent.fetch("/api/copilotkit/agent/abra/connect", {});
  release();
  assert.equal(reads[1].signal?.aborted, true);
  assert.equal(agent.fetch, original);
  const replay = ownObservationRequests(agent);
  await agent.fetch("/api/copilotkit/agent/abra/connect", {});
  assert.equal(reads[2].signal?.aborted, false);
  replay();
  assert.equal(reads[2].signal?.aborted, true);
  assert.ok(
    reads.every((read) => read.url.endsWith("/connect")),
    "cleanup never sends Stop or admission",
  );
});

test("releasing an observer never cancels a concurrent native Stop", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const agent = {
    fetch: async (_url: string, request: RequestInit) => {
      signals.push(request.signal);
      return new Response();
    },
  };
  const release = ownObservationRequests(agent);
  const native = new AbortController();
  await agent.fetch("/api/copilotkit/agent/abra/run", {});
  await agent.fetch("/api/copilotkit/agent/abra/stop/ses_abra", { signal: native.signal });
  release();
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1], native.signal);
  assert.equal(native.signal.aborted, false);
});
