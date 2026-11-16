import { communicationSummary } from "./presentation-contracts.ts";
import { artifactSummary } from "./artifacts.ts";
import { Schema } from "effect";
import { toolOutputs } from "../opencode/tool-contracts.ts";
import { nativeActivity } from "../visibility/supervision.ts";
import { IssueId, type Timestamp } from "../identities.ts";
import type { Issue } from "../work/model.ts";
import type { Execution } from "../domain.ts";
import {
  SurfacePublicationSchema,
  ToolPresentationSchema,
  type ToolPresentation,
} from "./presentation-contracts.ts";

function read<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | undefined {
  const parsed = Schema.decodeUnknownResult(schema, { reportInput: false })(input);
  return parsed._tag === "Success" ? parsed.success : undefined;
}
type ExecutionObservation = Pick<
  Execution,
  "issue_id" | "current_phase" | "control_generation" | "workflow_policy" | "progress"
>;
function task(issue: Issue | undefined, execution?: ExecutionObservation) {
  return {
    issue_id: issue?.id ?? execution!.issue_id,
    title: issue?.title,
    issue_status: issue?.status,
    phase: execution?.current_phase,
    policy: issue?.workflow_policy ?? execution?.workflow_policy,
    generation: execution?.control_generation,
    progress: execution?.progress,
  };
}

/** Decode the actual native tool schema, then keep only exercised, bounded display fields.
 * This function performs no live reads and grants no tool execution capability. */
export function toolPresentation(
  name: string,
  input: unknown,
  content: readonly { type: string; text?: string }[],
  observedAt: Timestamp | undefined,
): ToolPresentation | undefined {
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  if (new TextEncoder().encode(text).length > 1024 * 1024) return undefined;
  const envelope = read(
    Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true), result: Schema.Unknown })),
    text,
  );
  if (!envelope) return undefined;
  const raw = envelope.result;
  const selected = read(Schema.Struct({ issue_id: IssueId }), input)?.issue_id;
  let presentation: unknown;
  switch (name) {
    case "abra_work_status": {
      const value = read(toolOutputs.work_status, raw);
      if (value)
        presentation = {
          kind: "tasks",
          tasks: [
            {
              ...task(value.issue, value.execution),
              supervision: value.supervision,
              outcome: value.outcome,
            },
          ],
          total: 1,
          limited: false,
        };
      break;
    }
    case "abra_work_list": {
      const value = read(toolOutputs.work_list, raw);
      if (value)
        presentation = {
          kind: "tasks",
          tasks: value.issues.slice(0, 20).map((issue) => ({
            ...task(
              issue,
              value.executions.find((execution) => execution.issue_id === issue.id),
            ),
            supervision: value.supervision.tasks.find((item) => item.issue_id === issue.id),
          })),
          total: value.issues.length,
          limited: value.issues.length > 20,
        };
      break;
    }
    case "abra_work_create": {
      const value = read(toolOutputs.work_create, raw);
      if (value)
        presentation = {
          kind: "tasks",
          tasks: [task(value.issue, value.readiness?.execution)],
          total: 1,
          limited: false,
        };
      break;
    }
    case "abra_work_start": {
      const value = read(toolOutputs.work_start, raw);
      if (value)
        presentation = { kind: "tasks", tasks: [task(undefined, value)], total: 1, limited: false };
      break;
    }
    case "abra_work_decision": {
      const value = read(toolOutputs.work_decision, raw);
      if (value) presentation = { kind: "decision", issue_id: selected, decision: value };
      break;
    }
    case "abra_work_messages": {
      const value = read(toolOutputs.work_messages, raw);
      if (value && selected)
        presentation = {
          kind: "communication",
          issue_id: selected,
          total: value.total,
          outstanding: value.outstanding,
          limited:
            value.entries.length > 20 ||
            value.entries.some(
              ({ record }) =>
                (record.body?.length ?? 0) > 1500 ||
                (record.type !== "finding" && (record.reply?.body.length ?? 0) > 1500),
            ),
          entries: value.entries.slice(0, 20).map(communicationSummary),
        };
      break;
    }
    case "abra_work_feedback_status": {
      const value = read(toolOutputs.work_feedback_status, raw);
      if (value && selected)
        presentation = {
          kind: "findings",
          issue_id: selected,
          findings: value.findings.map((finding) => ({
            ...finding,
            text: finding.text.slice(0, 1500),
          })),
          total: value.finding_total,
          limited: value.findings.some((finding) => finding.text.length > 1500),
        };
      break;
    }
    case "abra_work_diagnostics": {
      const value = read(toolOutputs.work_diagnostics, raw);
      if (value)
        presentation = {
          kind: "sessions",
          issue_id: value.issue_id,
          total: value.sessions.length,
          sessions: value.sessions.slice(0, 20).map((session) => ({
            id: session.id,
            role: session.role,
            model: session.model,
            configured_model: session.configured_model,
            model_source: session.model_source,
            native_activity:
              session.busy === undefined
                ? "unknown"
                : nativeActivity({ busy: session.busy, executing: session.executing }),
            outcome: session.outcome,
            observed_at: observedAt,
            note: session.diagnostic_error ?? "Native session observation",
          })),
        };
      break;
    }
    case "abra_work_report": {
      const value = read(toolOutputs.work_report, raw);
      if (value && typeof value !== "string" && selected) {
        const reports = Array.isArray(value) ? value : [value];
        presentation = {
          kind: "artifacts",
          issue_id: selected,
          total: reports.length,
          artifacts: reports.slice(0, 20).map(artifactSummary),
        };
      }
      break;
    }
    case "abra_render_ui": {
      const value = read(SurfacePublicationSchema, raw);
      if (value) presentation = { kind: "surface", ...value };
      break;
    }
  }
  const value = read(ToolPresentationSchema, presentation);
  return value && new TextEncoder().encode(JSON.stringify(value)).length <= 64 * 1024
    ? value
    : undefined;
}
