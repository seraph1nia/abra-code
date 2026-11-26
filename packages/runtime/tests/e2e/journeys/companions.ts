import { nativeObservation } from "../../helpers/native-observation.ts";
import { reportJourney } from "../reports.ts";
import { modelDispatchJourney } from "../model-dispatch.ts";
import * as Id from "@abracode/contracts/identities";

import assert from "node:assert/strict";
import { join } from "node:path";
import { replyRecoveryJourney } from "../reply-recovery.ts";
import { idleResources, compilerRunning } from "../../operational/resources.ts";
import { type NativeHarness } from "../native-harness.ts";
import { delay, eventually } from "../native-timing.ts";
export function companionJourneys(h: NativeHarness) {
  const {
    evidenceDirectory,
    root,
    engineeringEvidence,
    home,
    client,
    api,
    loc,
    observer,
    observeWork,
    supervisor,
    invoke,
    restart,
  } = h;
  const { providerRequests, leads, parallel, acceptance, controls } = h.mock;
  const runParallel = () =>
    parallel.run({
      supervisor: Id.SessionId.make(supervisor.id),
      workerQuestion: async (session, args) =>
        (
          (await api.invoke(
            { tool: "abra_worker_question", args, session: Id.SessionId.make(session) },
            loc,
          )) as any
        ).result,
      root,
      home,
      client,
      invoke,
      eventually,
      restart,
    });
  const runModels = () =>
    modelDispatchJourney({
      root,
      home,
      invoke,
      eventually,
      restart,
      hold: () => {
        controls.holdModelWorker = true;
        controls.modelWorkerHeld = false;
      },
      held: () => controls.modelWorkerHeld,
      release: () => controls.releaseModelWorker?.(),
    });
  const runLeads = () =>
    leads.run({
      observe: (value) => engineeringEvidence.push(value),
      snapshot: () => nativeObservation(() => observer.snapshot({}, loc)),
      leadEvidence: (query) => nativeObservation(() => observer.leads(query, loc)),
      root,
      home,
      client,
      supervisor: supervisor.id,
      invoke,
      eventually,
      leadTool: async (session, tool, args) =>
        ((await api.invoke({ tool, args, session }, loc)) as any).result,
      restart,
    });
  const runReports = () =>
    reportJourney({
      observe: (value) => engineeringEvidence.push(value),
      compilerRunning:
        process.env.ABRACODE_TEST_METRICS === "1" && process.platform === "linux"
          ? () =>
              compilerRunning(
                h.nativePid(),
                home,
                join(evidenceDirectory!, "report-process-progress.jsonl"),
              )
          : undefined,
      root,
      home,
      client,
      supervisor: supervisor.id,
      invoke,
      eventually,
      workerTool: async (session, tool, args) =>
        ((await api.invoke({ tool, args, session }, loc)) as any).result,
      restart,
    });
  const runAcceptance = () => {
    controls.failFirstExplore = false;
    return acceptance.run({
      root,
      home,
      client,
      supervisor: supervisor.id,
      invoke,
      eventually,
      work: observeWork,
      quietSample: async () => {
        const settling = performance.now();
        const initial = { ...providerRequests };
        let prior = JSON.stringify(providerRequests),
          stableAt = performance.now();
        // First route meaningful completion/decision notifications. Measure
        // an unchanged fleet only after it and the provider are quiescent.
        await eventually(async () => {
          const current = JSON.stringify(providerRequests);
          if (
            current !== prior ||
            Object.keys(await client.session.active()).length ||
            (await client.session.inbox.list({ sessionID: supervisor.id })).length
          ) {
            prior = current;
            stableAt = performance.now();
          }
          return performance.now() - stableAt >= 2200 ? true : undefined;
        }, 15000);
        const before = { ...providerRequests };
        const observation = await idleResources(h.nativePid(), async () => {
          await delay(Number(process.env.ABRACODE_TEST_IDLE_MS ?? 2200));
        });
        assert.deepEqual(
          providerRequests,
          before,
          "Human-gated idle work must admit no extra provider request",
        );
        return {
          ...observation,
          provider_requests_added: 0,
          settling_ms: performance.now() - settling - observation.sample_ms,
          provider_requests_during_settling:
            Object.values(before).reduce((a, b) => a + b, 0) -
            Object.values(initial).reduce((a, b) => a + b, 0),
        };
      },
      restart,
    });
  };
  const runReplyRecovery = () => {
    controls.failFirstExplore = false;
    return replyRecoveryJourney({
      root,
      supervisor: supervisor.id,
      client,
      invoke,
      eventually,
      holdExplore: () => {
        controls.holdExplore = true;
        controls.exploreHeld = false;
      },
      held: () => controls.exploreHeld,
      releaseExplore: () => controls.releaseExplore?.(),
      observe: (value) => engineeringEvidence.push(value),
      restart,
    });
  };
  return { runParallel, runModels, runLeads, runReports, runAcceptance, runReplyRecovery };
}
export type CompanionJourneys = ReturnType<typeof companionJourneys>;
