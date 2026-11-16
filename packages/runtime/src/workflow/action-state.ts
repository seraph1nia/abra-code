import { digest } from "../digest.ts";
import { ensure, type ManagedExecution } from "../domain.ts";
import { type CurrentAction, type PRAction } from "./action-contracts.ts";
import { type ActionInput } from "./feedback-contracts.ts";

/** Normalize only at the boundary; the original receipt and approval identity survive. */
export function normalizeAction(a: PRAction, e: ManagedExecution): CurrentAction {
  if (a.schema_version === 2) return a;
  const pr = e.pull_request_reference ?? e.feedback?.pr;
  ensure(
    pr,
    "ACTION_IDENTITY",
    "Legacy action has no retained PR identity; inspect without sending",
  );
  ensure(
    ["manual", "execution-policy"].includes(a.authority),
    "ACTION_AUTHORITY",
    "Legacy action authority is unsupported",
  );
  const base = {
    schema_version: 2 as const,
    id: a.id,
    generation: a.generation,
    repository_id: e.repository_id,
    pr,
    head: a.head,
    status: a.status,
    created_at: a.created_at,
    updated_at: a.updated_at,
    authority: a.authority === "manual" ? ("manual" as const) : ("execution-policy" as const),
    form_id: a.form_id,
    session_id: a.session_id,
    authorized_at: a.authorized_at,
    result: a.result,
    legacy: a,
    submission:
      a.status === "confirmed"
        ? { stage: "confirmed" as const, at: a.updated_at, receipt: a.result! }
        : ["running", "uncertain"].includes(a.status)
          ? { stage: "admitted" as const, at: a.updated_at }
          : { stage: "unsubmitted" as const },
  };
  switch (a.kind) {
    case "ready":
      return { ...base, kind: a.kind, target: {} };
    case "reviewers":
      ensure(
        (a.users?.length ?? 0) + (a.teams?.length ?? 0) > 0,
        "ACTION_IDENTITY",
        "Legacy reviewer request has no explicit targets; inspect without sending",
      );
      return {
        ...base,
        kind: a.kind,
        target: { users: [...(a.users ?? [])].sort(), teams: [...(a.teams ?? [])].sort() },
      };
    case "reply":
      ensure(
        a.finding && a.revision && a.body,
        "ACTION_IDENTITY",
        "Legacy reply has incomplete source/content evidence",
      );
      if (a.thread_id)
        ensure(a.comment_id, "ACTION_IDENTITY", "Legacy inline reply has no published comment ID");
      return {
        ...base,
        kind: a.kind,
        target: {
          finding: a.finding,
          revision: a.revision,
          body: a.body,
          destination: a.thread_id
            ? { kind: "thread", thread_id: a.thread_id, comment_id: a.comment_id! }
            : { kind: "issue" },
        },
      };
    case "resolve":
      ensure(
        a.thread_id && a.finding && a.revision,
        "ACTION_IDENTITY",
        "Legacy resolution has incomplete thread evidence",
      );
      return {
        ...base,
        kind: a.kind,
        target: { thread_id: a.thread_id, revisions: [{ id: a.finding, revision: a.revision }] },
      };
    case "rerun":
      ensure(
        a.run_id && a.run_attempt && a.workflow && a.finding && a.revision,
        "ACTION_IDENTITY",
        "Legacy rerun has incomplete attempt evidence",
      );
      return {
        ...base,
        kind: a.kind,
        target: { run_id: a.run_id, run_attempt: a.run_attempt, workflow: a.workflow },
        findings: [{ id: a.finding, revision: a.revision }],
      };
  }
}

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
