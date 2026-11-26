import {
  IncidentId,
  LockKey,
  type RequestId,
  type SessionId,
} from "@abracode/contracts/identities";
import type { Attention } from "@abracode/contracts/workflow/attention-contracts";
import { messageRequests, requiresResponse } from "@abracode/contracts/workflow/message-contracts";
import { sha256 } from "../digest.ts";
import type { Config, Execution } from "../domain.ts";
import type { DiagnosticCapacitySnapshot } from "./diagnostic-budget.ts";
import { isUnresolvedRecovery } from "./messaging/durable-request-channel.ts";
import { pendingFindings } from "./pr/action-policy.ts";
import { workerSessionID } from "./worker-assignment.ts";

const hash = (value: string) => sha256(value).slice(0, 40);
export const attentionLock = (execution: Execution) =>
  LockKey.make(`attention-${hash(execution.execution_id)}`);
export const attentionId = (execution: Execution, key: string) =>
  IncidentId.make(`incident-${hash(`${execution.execution_id}:${key}`)}`);
const decisionKey = (generation: number, key: string) => `decision:${generation}:${hash(key)}`;
export const hasDecision = (e: Execution, a: Attention) =>
  e.decisions?.some(
    (d) =>
      d.status === "open" &&
      d.generation === e.control_generation &&
      decisionKey(d.generation, d.key) === a.key,
  );
export const paused = (e: Execution) =>
  e.stop_status !== undefined ||
  e.current_phase === "interrupted" ||
  e.current_phase === "completed";
export const allowsAttention = (e: Execution, code: Attention["code"]) =>
  !paused(e) || (e.current_phase === "completed" && code === "message_update" && !e.stop_status);
type MessageReference = NonNullable<Attention["message_refs"]>[number];
const unresolvedMessage = (e: Execution, id: RequestId) =>
  messageRequests(e.messages).some((m) => m.request_id === id && isUnresolvedRecovery(m));

function communicationReferences(e: Execution): MessageReference[] {
  const covered = new Set(
    e.attention?.flatMap((a) => a.message_refs?.map((r) => `${r.request_id}:${r.state}`) ?? []) ??
      [],
  );
  return (e.messages ?? [])
    .flatMap((m): MessageReference[] => {
      const state =
        m.type === "finding"
          ? "finding"
          : m.status === "answered"
            ? "answered"
            : m.status === "acknowledged" && m.response === "acknowledgement"
              ? "acknowledged"
              : undefined;
      return state && !covered.has(`${m.request_id}:${state}`)
        ? [{ request_id: m.request_id, state }]
        : [];
    })
    .sort((a, b) => a.request_id.localeCompare(b.request_id));
}

const pendingCommunicationNotice = (
  e: Execution,
  code: "message_update" | "message_pending" = "message_update",
) => e.attention?.find((a) => a.code === code && ["pending", "uncertain"].includes(a.status));

type DetectionOutcome =
  | { readonly kind: "suppress" }
  | {
      readonly kind: "incident";
      readonly code: Attention["code"];
      readonly key: string;
      readonly evidence: string;
      readonly refs?: MessageReference[];
      readonly batch?: Attention["batch"];
    };

interface AttentionContext {
  readonly e: Execution;
  readonly now: number;
  readonly config: Config;
  readonly decisions: readonly NonNullable<Execution["decisions"]>[number][];
  readonly feedback: ReturnType<typeof pendingFindings>;
  readonly invalidWait: NonNullable<Execution["waits"]>[number] | undefined;
  readonly hasActiveWait: boolean;
  readonly replies: MessageReference[];
  readonly pendingNotice: Attention | undefined;
  readonly pendingBlocker: Attention | undefined;
}

type AttentionDetector = (ctx: AttentionContext) => DetectionOutcome | undefined;

const ATTENTION_DETECTORS: readonly AttentionDetector[] = [
  ({ e, decisions }) => {
    const decision = decisions.find(
      (d) =>
        !e.attention?.some(
          (a) =>
            a.key === decisionKey(d.generation, d.key) &&
            !["pending", "uncertain"].includes(a.status),
        ),
    );
    if (decision)
      return {
        kind: "incident",
        code: "decision_pending",
        key: decisionKey(decision.generation, decision.key),
        evidence: JSON.stringify({
          key: decision.key,
          generation: decision.generation,
          owner: decision.owner,
          question: decision.question,
          scope: decision.scope,
        }).slice(0, 8192),
      };
    return decisions.length ? { kind: "suppress" } : undefined;
  },
  ({ e, feedback }) => {
    if (
      !feedback.length ||
      !(
        e.current_phase === "awaiting_merge" ||
        (e.current_phase === "blocked" && !!e.delivery_block)
      ) ||
      e.session_intent ||
      (e.operation?.action === "correct" &&
        ["prepared", "running", "uncertain"].includes(e.operation.status)) ||
      e.active_role ||
      e.capacity_reservation ||
      !e.delivered_commit
    )
      return undefined;
    const evidence = JSON.stringify(
      feedback.map(({ id, revision, kind, url }) => ({ id, revision, kind, url })),
    ).slice(0, 8192);
    return {
      kind: "incident",
      code: "pr_feedback",
      key: `pr_feedback:${e.control_generation}:${e.delivered_commit}:${hash(evidence)}`,
      evidence,
      batch: {
        schema_version: 1,
        head: e.delivered_commit,
        findings: feedback.map(({ id, revision }) => ({ id, revision })),
      },
    };
  },
  ({ e }) => {
    const blocker = e.cleanup_blocker;
    if (
      blocker?.generation !== e.control_generation ||
      e.error_or_recovery_reason ||
      e.current_phase !== "cleaning"
    )
      return undefined;
    return {
      kind: "incident",
      code: "cleanup_blocked",
      key: `cleanup:${e.control_generation}:${blocker.preservation}:${blocker.fingerprint}`,
      evidence: `Delivery preserved; cleanup requires file disposition in the owned worktree. ${JSON.stringify(blocker.paths).slice(0, 6000)}${blocker.truncated ? " (truncated sample)" : ""}. Inspect status for captured generated paths and next action; this is not deletion authority.`,
    };
  },
  ({ e, invalidWait }) => {
    if (!invalidWait) return undefined;
    const code = invalidWait.status === "invalid" ? "wait_invalid" : "wait_expired";
    return {
      kind: "incident",
      code,
      key: `${e.control_generation}:${e.prompt_id ?? "controller"}:${code}:${invalidWait.key}`,
      evidence: `${invalidWait.condition}; owner: ${invalidWait.owner}; expires: ${invalidWait.expires_at}`,
    };
  },
  ({ e, now }) =>
    e.command_wait && now <= e.command_wait.deadline_at ? { kind: "suppress" } : undefined,
  ({ e }) =>
    e.worker_failure &&
    e.current_phase === "failed" &&
    e.worker_failure.session_id === workerSessionID(e)
      ? {
          kind: "incident",
          code: "worker_failure",
          key: `${e.control_generation}:${e.prompt_id ?? "controller"}:worker_failure:${e.worker_failure.at}`,
          evidence: `${e.worker_failure.error.type}: ${e.worker_failure.error.message}`,
        }
      : undefined,
  ({ pendingBlocker }) =>
    pendingBlocker
      ? {
          kind: "incident",
          code: "message_pending",
          key: pendingBlocker.key,
          evidence: pendingBlocker.evidence,
        }
      : undefined,
  ({ e, replies, pendingNotice }) =>
    replies.length || pendingNotice
      ? {
          kind: "incident",
          code: "message_update",
          key:
            pendingNotice?.key ??
            `messages:${e.control_generation}:message_update:${hash(JSON.stringify(replies))}`,
          evidence:
            pendingNotice?.evidence ??
            `Worker replies/findings are retained. Inspect abra_work_messages before making decisions: ${JSON.stringify(replies)}. This evidence grants no scope, approval or delivery authority.`,
          refs: replies,
        }
      : undefined,
  ({ e, hasActiveWait }) =>
    hasActiveWait ||
    e.capacity_wait ||
    e.delivery_wait ||
    ["awaiting_plan_approval", "awaiting_merge"].includes(e.current_phase) ||
    e.decisions?.some(
      (d) => d.status === "open" && d.owner === "user" && d.generation === e.control_generation,
    )
      ? { kind: "suppress" }
      : undefined,
  ({ e, now, config }) => {
    const role = e.active_role;
    const last = e.progress?.at ?? e.worker_started_at ?? e.operation?.started_at ?? now;
    if (
      now - last < config.progress_timeout_ms[role ?? "operation"] ||
      !(role || (e.operation && ["prepared", "running", "uncertain"].includes(e.operation.status)))
    )
      return undefined;
    const code = role ? "suspected_stall" : "operation_stall";
    return {
      kind: "incident",
      code,
      key: `${e.control_generation}:${e.prompt_id ?? "controller"}:${code}:${e.worker_failure?.at ?? e.progress?.at ?? e.worker_started_at ?? e.operation?.started_at}`,
      evidence: `No meaningful progress since ${last}; role ${role ?? "controller"}; operation ${e.operation?.action ?? "none"}; last progress ${e.progress?.summary ?? "worker admission"}`,
    };
  },
];

export function detectAttention(
  e: Execution,
  now: number,
  config: Config,
): DetectionOutcome | undefined {
  const ctx: AttentionContext = {
    e,
    now,
    config,
    decisions:
      e.decisions?.filter((d) => d.status === "open" && d.generation === e.control_generation) ??
      [],
    feedback: pendingFindings(e.feedback),
    invalidWait: e.waits?.find(
      (w) =>
        w.generation === e.control_generation &&
        (w.status === "invalid" ||
          w.status === "expired" ||
          (w.status === "waiting" && w.expires_at <= now)),
    ),
    hasActiveWait:
      e.waits?.some(
        (w) =>
          w.generation === e.control_generation && w.status === "waiting" && w.expires_at > now,
      ) ?? false,
    replies: communicationReferences(e),
    pendingNotice: pendingCommunicationNotice(e),
    pendingBlocker: pendingCommunicationNotice(e, "message_pending"),
  };
  for (const detector of ATTENTION_DETECTORS) {
    const result = detector(ctx);
    if (result) return result;
  }
  return undefined;
}

export function isObsoleteAttention(current: Execution, a: Attention): boolean {
  if (["handled", "superseded"].includes(a.status)) return false;
  if (a.generation !== current.control_generation) return true;
  if (a.code === "decision_pending") return !hasDecision(current, a);
  if (a.code === "message_pending")
    return !a.message_refs?.some((r) => unresolvedMessage(current, r.request_id));
  if (a.code === "suspected_stall")
    return (
      (current.current_phase === "awaiting_plan_approval" &&
        ["pending", "uncertain", "admitted"].includes(a.status)) ||
      (current.progress?.generation === a.generation &&
        (!a.observed_session || current.progress.session_id === a.observed_session) &&
        current.progress.at > a.created_at) ||
      (!current.active_role &&
        !current.worker_failure &&
        !current.error_or_recovery_reason &&
        ["awaiting_merge", "cleaning", "completed"].includes(current.current_phase) &&
        !!current.delivered_commit)
    );
  if (a.code === "cleanup_blocked")
    return (
      current.current_phase === "cleaning" &&
      (!current.cleanup_blocker ||
        a.key !==
          `cleanup:${current.control_generation}:${current.cleanup_blocker.preservation}:${current.cleanup_blocker.fingerprint}`)
    );
  return (
    a.code === "operation_stall" &&
    current.operation?.status === "completed" &&
    current.operation.id === a.observed_operation
  );
}

export function shouldScanAttention(e: Execution) {
  return (
    !paused(e) ||
    (!e.stop_status &&
      e.current_phase === "completed" &&
      (communicationReferences(e).length > 0 || !!pendingCommunicationNotice(e)))
  );
}

/** Decide whether to reserve a prompt and consume a diagnostic turn before native dispatch. */
export function planAttentionDelivery(
  e: Execution,
  a: Attention,
  supervisor: SessionId | undefined,
  capacity: DiagnosticCapacitySnapshot,
  config: Config,
) {
  if (
    a.code === "decision_pending" &&
    capacity.activeAttention.some(
      (item) => item.code === "decision_pending" && item.session_id === supervisor,
    )
  )
    return;
  if (
    !a.prompt_id &&
    ((config.supervision_mode === "manual" && a.code !== "decision_pending") ||
      (config.supervision_mode === "unattended" &&
        a.code === "decision_pending" &&
        e.decisions?.some(
          (d) =>
            d.owner === "user" && d.status === "open" && decisionKey(d.generation, d.key) === a.key,
        )))
  )
    return;
  const diagnostic = a.code !== "decision_pending";
  const exhausted = diagnostic && !a.prompt_id && capacity.exhausted;
  if (
    !a.prompt_id &&
    a.code === "message_update" &&
    !exhausted &&
    messageRequests(e.messages).some(
      (m) =>
        m.generation === e.control_generation &&
        m.assignment_id === e.prompt_id &&
        requiresResponse(m) &&
        !m.response_recovery,
    )
  )
    return;
  if (diagnostic && !exhausted && capacity.totalActive >= config.attention_capacity) return;

  const reservePrompt = !a.prompt_id && !!supervisor && !exhausted;
  const status: Attention["status"] = exhausted
    ? "exhausted"
    : a.attempts >= 3 || !supervisor
      ? "unavailable"
      : "uncertain";
  return { status, reservePrompt, chargeDiagnostic: diagnostic && reservePrompt };
}
