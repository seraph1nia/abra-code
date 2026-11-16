import { type Execution, CrewError } from "../domain.ts";
import { automation } from "../config/policy.ts";
import { type PR } from "../git/forge.ts";
import { type ActionInput } from "./feedback-contracts.ts";
import { type CurrentAction } from "./action-contracts.ts";
import { prepareAction, addressed } from "./action-policy.ts";
import { normalizeAction, targetKey } from "./action-state.ts";

export interface ActionRequirement {
  input: typeof ActionInput.Type;
  action?: CurrentAction;
  blocker?: { code: string; reason: string };
}
/** Pure policy obligations: an absent outbox entry is work, never evidence of clearance. */
export function actionPlan(e: Execution, pr: PR, now: number) {
  const required: ActionRequirement[] = [];
  const policy = automation(e.effective_policy);
  const add = (kind: CurrentAction["kind"], finding_id?: typeof ActionInput.Type.finding_id) => {
    const input = {
      issue_id: e.issue_id,
      generation: e.control_generation,
      expected_head: e.delivered_commit!,
      kind,
      finding_id,
    };
    try {
      const action = prepareAction(e, input, true, now);
      if (!required.some((r) => r.action && targetKey(r.action) === targetKey(action)))
        required.push({ input, action });
    } catch (error) {
      if (!(error instanceof CrewError)) throw error;
      required.push({ input, blocker: { code: error.code, reason: error.message } });
    }
  };
  if (policy.publication === "draft-until-verified" && pr.isDraft) add("ready");
  if (
    policy.reviewers.request === "on-ready" &&
    (policy.reviewers.users.length || policy.reviewers.teams.length) &&
    (!e.rounds?.length || policy.reviewers.rerequest_after_correction)
  ) {
    if (pr.isDraft)
      required.push({
        input: {
          issue_id: e.issue_id,
          generation: e.control_generation,
          expected_head: e.delivered_commit!,
          kind: "reviewers",
        },
        blocker: { code: "PR_DRAFT", reason: "Reviewer requests wait for the ready transition" },
      });
    else add("reviewers");
  }
  for (const f of e.feedback?.findings ?? []) {
    if (addressed(f, e.delivered_commit!)) {
      if (policy.discussion.replies === "verified") add("reply", f.id);
      if (policy.discussion.resolve_threads === "addressed" && f.thread_id && !f.resolved)
        add("resolve", f.id);
    } else if (
      f.kind === "check" &&
      f.blocking &&
      f.disposition?.status === "transient" &&
      f.disposition.head === e.delivered_commit &&
      policy.ci_retry.max_reruns > 0 &&
      policy.ci_retry.workflows.includes(f.workflow ?? "")
    )
      add("rerun", f.id);
  }
  const keys = new Set(required.flatMap((r) => (r.action ? [targetKey(r.action)] : [])));
  const stale = (e.feedback?.actions ?? [])
    .map((a) => normalizeAction(a, e))
    .filter(
      (a) =>
        a.submission.stage === "unsubmitted" &&
        a.status === "prepared" &&
        (a.head !== e.delivered_commit ||
          (a.authority === "execution-policy" &&
            !keys.has(targetKey(a)) &&
            !required.some((r) => r.blocker && r.input.kind === a.kind)) ||
          (a.kind === "reply" &&
            !e.feedback!.findings.some(
              (f) => f.id === a.target.finding && f.revision === a.target.revision,
            ))),
    );
  const staleIDs = new Set(stale.map((a) => a.id));
  const pending =
    !e.feedback?.complete ||
    required.some((r) => !r.action || r.action.status !== "confirmed") ||
    (e.feedback?.actions.some(
      (a) => !["confirmed", "superseded", "rejected"].includes(a.status) && !staleIDs.has(a.id),
    ) ??
      false);
  return { required, stale, pending };
}
