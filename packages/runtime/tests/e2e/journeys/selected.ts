import { thoughtsJourney } from "../memos-thoughts.ts";
import { inboxJourney } from "../github-inbox.ts";
import { cockpitJourney } from "../cockpit.ts";
import { simplifyLoopJourney } from "../simplify-loop.ts";
import { planningRecoveryJourney } from "../planning-recovery.ts";
import { workspaceJourney } from "../workspace.ts";
import * as Id from "@abracode/contracts/identities";

import { communicationCrashJourney } from "../crash-windows.ts";
import { type NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";
import { type CompanionJourneys } from "./companions.ts";
export async function runSelectedJourney(h: NativeHarness, companions: CompanionJourneys) {
  const {
    journey,
    inboxFixture,
    evidenceDirectory,
    root,
    engineeringEvidence,
    home,
    projects,
    forgeState,
    port,
    password,
    client,
    api,
    loc,
    observeWork,
    supervisor,
    invoke,
    restart,
  } = h;
  const { providerRequests, memory, streamProof, releaseStreamProof, controls } = h.mock;
  const { runParallel, runModels, runLeads, runReports, runAcceptance, runReplyRecovery } =
    companions;
  if (journey === "planning-recovery") {
    controls.failFirstExplore = false;
    engineeringEvidence.push(
      await planningRecoveryJourney({
        root,
        supervisor: supervisor.id,
        client,
        invoke,
        eventually,
        work: observeWork,
        holdExplore: () => {
          controls.holdExplore = true;
          controls.exploreHeld = false;
        },
        held: () => controls.exploreHeld,
        releaseExplore: () => {
          controls.holdExplore = false;
          controls.releaseExplore?.();
        },
        restart,
      }),
    );
    return true;
  }
  if (journey === "simplify-loop") {
    controls.failFirstExplore = false;
    engineeringEvidence.push(
      await simplifyLoopJourney({
        root,
        home,
        forgeState,
        supervisor: supervisor.id,
        client,
        invoke,
        eventually,
        work: observeWork,
        observe: (value) => engineeringEvidence.push(value),
        restart,
      }),
    );
    return true;
  }
  if (journey === "crash-windows") {
    controls.failFirstExplore = false;
    engineeringEvidence.push(
      await communicationCrashJourney({
        root,
        evidence: evidenceDirectory!,
        observe: (value) => engineeringEvidence.push(value),
        client,
        supervisor: supervisor.id,
        invoke,
        eventually,
        holdExplore: () => {
          controls.holdExplore = true;
          controls.exploreHeld = false;
        },
        held: () => controls.exploreHeld,
        releaseExplore: () => controls.releaseExplore?.(),
        restart: () => restart(5000),
      }),
    );
    return true;
  }
  if (journey === "reply-recovery") {
    engineeringEvidence.push(await runReplyRecovery());
    return true;
  }
  if (memory) {
    engineeringEvidence.push(
      await memory.run({
        client,
        root,
        home,
        projects,
        session: supervisor.id,
        evidence: evidenceDirectory,
        invoke,
        restart: () => restart(5000),
        eventually,
        endpoint: {
          url: `http://127.0.0.1:${port}`,
          auth: { type: "basic", username: "opencode", password },
        },
      }),
    );
    return true;
  }
  if (journey === "memos-thoughts") {
    engineeringEvidence.push(
      await thoughtsJourney({
        home,
        project: projects[1],
        session: supervisor.id,
        evidence: evidenceDirectory,
        invoke,
        endpoint: {
          url: `http://127.0.0.1:${port}`,
          auth: { type: "basic", username: "opencode", password },
        },
      }),
    );
    return true;
  }
  if (inboxFixture) {
    controls.failFirstExplore = false;
    engineeringEvidence.push(
      await inboxJourney({
        briefing: journey === "work-briefing",
        releaseProject: projects[0],
        root,
        home,
        project: projects[1],
        session: supervisor.id,
        endpoint: {
          url: `http://127.0.0.1:${port}`,
          auth: { type: "basic", username: "opencode", password },
        },
        evidence: evidenceDirectory,
        invoke,
        restart,
        eventually,
      }),
    );
    return true;
  }
  if (journey === "cockpit") {
    controls.failFirstExplore = false;
    try {
      engineeringEvidence.push(
        await cockpitJourney({
          home,
          project: projects[0],
          session: supervisor.id,
          invoke,
          eventually,
          evidence: evidenceDirectory,
          endpoint: {
            url: `http://127.0.0.1:${port}`,
            auth: { type: "basic", username: "opencode", password },
          },
          question: (session, args) =>
            api.invoke(
              { tool: "abra_worker_question", args, session: Id.SessionId.make(session) },
              loc,
            ),
          waitSession: (session) => client.session.wait({ sessionID: Id.SessionId.make(session) }),
          holdWorker: () => {
            controls.holdExplore = true;
            controls.exploreHeld = false;
          },
          held: () => controls.exploreHeld,
          releaseWorker: () => controls.releaseExplore?.(),
          holdAbra: async () => {
            await client.session.prompt({
              sessionID: supervisor.id,
              text: "Hold the cockpit supervisor turn",
            });
            await eventually(async () => (controls.releaseCockpit ? true : undefined));
          },
          releaseAbra: () => controls.releaseCockpit?.(),
        }),
      );
    } finally {
      controls.releaseExplore?.();
      controls.releaseCockpit?.();
    }
    return true;
  }
  if (journey === "workspace") {
    controls.failFirstExplore = false;
    engineeringEvidence.push(
      await workspaceJourney({
        home,
        project: projects[0],
        session: supervisor.id,
        client,
        providerCount: () => providerRequests.supervisor ?? 0,
        streaming: {
          hold: () => {
            streamProof.tool = true;
            streamProof.text = true;
          },
          release: (kind) => releaseStreamProof[kind]?.(),
        },
        restart,
        endpoint: {
          url: `http://127.0.0.1:${port}`,
          auth: { type: "basic", username: "opencode", password },
        },
        readStatus: (id) => invoke("abra_work_status", { issue_id: id }),
        evidence: evidenceDirectory,
      }),
    );
    return true;
  }
  if (journey === "acceptance") {
    engineeringEvidence.push(await runAcceptance());
    return true;
  }
  if (journey === "reports") {
    engineeringEvidence.push(await runReports());
    return true;
  }
  if (journey === "leads") {
    engineeringEvidence.push(await runLeads());
    return true;
  }
  if (journey === "models") {
    engineeringEvidence.push(await runModels());
    return true;
  }
  if (journey === "parallel") {
    engineeringEvidence.push(await runParallel());
    return true;
  }
  return false;
}
