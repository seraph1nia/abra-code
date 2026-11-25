import { digest } from "../digest.ts";
import { type ManagedExecution } from "../domain.ts";
import { type CurrentAction } from "@abracode/contracts/workflow/action-contracts";
import { type ActionInput } from "@abracode/contracts/workflow/feedback-contracts";

export function targetKey(a: CurrentAction) {
  return digest([a.repository_id, a.pr, a.head, a.kind, a.target]);
}

/** Revalidate a prepared target using its original payload, never caller-supplied replacements. */
export function preparedInput(a: CurrentAction, e: ManagedExecution): typeof ActionInput.Type {
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: a.head,
    kind: a.kind,
  };
  switch (a.kind) {
    case "ready":
      return input;
    case "reviewers":
      return { ...input, users: a.target.users, teams: a.target.teams };
    case "reply":
      return { ...input, finding_id: a.target.finding, body: a.target.body };
    case "resolve":
      return { ...input, finding_id: a.target.revisions[0].id };
    case "rerun":
      return {
        ...input,
        finding_id:
          a.findings.find((s) => e.feedback?.findings.some((f) => f.id === s.id))?.id ??
          a.findings[0].id,
      };
  }
}

export function confirmedAction(a: CurrentAction, receipt: string, at: number): CurrentAction {
  return {
    ...a,
    status: "confirmed",
    updated_at: at,
    result: receipt,
    submission: { stage: "confirmed", receipt, at },
    preflight: undefined,
  };
}
