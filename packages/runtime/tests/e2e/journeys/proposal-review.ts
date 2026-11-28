import assert from "node:assert/strict";
import { portableRpc } from "../../helpers/portable-rpc.ts";
import { webGateway } from "../../../src/web/protocol.ts";
import type { NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";

export async function proposalReviewJourney(h: NativeHarness) {
  const { invoke, client, supervisor, loc } = h;
  await invoke("abra_project_onboard", {
    id: "reader",
    path: h.projects[0],
    action: "register",
    delivery: "branch",
    verification: [[process.execPath, "--version"]],
    plan_approval: true,
  });
  const { issue } = await invoke("abra_work_create", {
    repository_id: "reader",
    title: "Review the sample proposal",
    description: "AUTHOR_CONTEXT_ONLY",
    request_id: "native-proposal-reader",
    proposal_review: "user",
  });
  await invoke("abra_work_start", { issue_id: issue.id });
  const wait = (prior?: string) =>
    eventually(async () => {
      const e = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      const r = e.proposal_reviews?.find((v: any) => v.fingerprint === e.plan_fingerprint);
      if (r?.status === "unavailable" || ["failed", "recovery_required"].includes(e.current_phase))
        throw Object.assign(
          Error(JSON.stringify({ reason: r?.reason, error: e.error_or_recovery_reason })),
          { terminal: true },
        );
      return r?.status === "completed" &&
        r.fingerprint !== prior &&
        e.decisions?.some((d: any) => d.generation === e.control_generation && d.form_observed)
        ? e
        : undefined;
    }, 90000);
  const first = await wait();
  const a = first.proposal_reviews[0];
  const origin = { issue_id: issue.id, fingerprint: a.fingerprint };
  const publish = async (fingerprint: string) => {
    const text =
      "AbraCode workspace operation " +
      JSON.stringify({
        tool: "abra_render_ui",
        args: {
          surface_id: "proposal-findings",
          proposal_review: { issue_id: issue.id, fingerprint },
        },
      });
    await client.session.prompt({ sessionID: supervisor.id, text });
    await client.session.wait({ sessionID: supervisor.id });
    const history = await client.session.context({ sessionID: supervisor.id });
    const index = history.findLastIndex((m) => m.type === "user" && m.text === text);
    assert.ok(index >= 0);
    const call = history
      .slice(index + 1)
      .flatMap((m) => (m.type === "assistant" ? m.content : []))
      .find((p) => p.type === "tool" && p.name === "abra_render_ui");
    assert.ok(call?.type === "tool" && call.state.status === "completed", JSON.stringify(call));
    const output = call.state.content.find((p) => p.type === "text");
    assert.ok(output?.type === "text");
    return JSON.parse(output.text).result;
  };
  const saved = await publish(origin.fingerprint);
  const gateway = client.rpc(portableRpc(webGateway));
  const target = {
    session_id: supervisor.id,
    surface_id: saved.surface_id,
    revision: saved.revision,
  };
  const original = await gateway.surface(target, loc);
  assert.equal(first.apply_session_id, undefined);
  assert.equal(a.report.findings[0].owner, "human");
  const decision = first.decisions.find((d: any) => d.proposal_fingerprint === a.fingerprint);
  await client.session.form.reply({
    sessionID: supervisor.id,
    formID: decision.form_id,
    answer: { answer: "Final responses only." },
  });
  await invoke("abra_work_decision", {
    issue_id: issue.id,
    key: decision.key,
    generation: decision.generation,
    action: "collect",
  });
  await invoke("abra_work_control", {
    issue_id: issue.id,
    action: "replan",
    request_id: "native-proposal-revision",
    text: "Clarify the sample acceptance checks.",
  });
  const second = await wait(a.fingerprint);
  const b = second.proposal_reviews.at(-1);
  assert.notEqual(b.session, a.session);
  await publish(b.fingerprint);
  await h.restart();
  const reopened = await gateway.surface(target, loc);
  assert.deepEqual(reopened, original);
  await assert.rejects(
    invoke("abra_work_decision", {
      issue_id: issue.id,
      key: decision.key,
      generation: decision.generation,
      action: "collect",
    }),
    /stale|superseded/i,
  );
  const after = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
  assert.equal(after.plan_fingerprint, b.fingerprint);
  assert.equal(after.apply_session_id, undefined);
  h.engineeringEvidence.push({
    selected: first.proposal_review,
    reviewed: a.fingerprint,
    current: b.fingerprint,
    reading: a.report.reading,
    decision: decision.question,
    answer: "Final responses only.",
    snapshot: original,
    identical_after_restart: true,
    stale_action_refused: true,
  });
}
