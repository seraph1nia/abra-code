import { Effect, Schema } from "effect";
import { type Execution } from "../domain.ts";
import { type WorkGraph } from "../work/graph.ts";
import { timestamp } from "../identities.ts";
import {
  ReportSnapshotSchema,
  SourceReferenceSchema,
  type ReportSnapshot,
} from "../../templates/reporter/src/snapshot-data.ts";
import { researchMarkdown } from "./report-contracts.ts";
import { ensure } from "../domain.ts";
import { decode } from "../decode.ts";
const bounded = (text: string) =>
  Buffer.byteLength(text) > 12000
    ? Buffer.from(text).subarray(0, 11900).toString("utf8") + "… [truncated in snapshot]"
    : text;
/** Labels explicitly describe retained receipts, never a fresh check/run. */
export const captureReportSnapshot = (
  work: WorkGraph,
  e: Execution,
  markdown?: string,
  title?: string,
  diagrams?: ReportSnapshot["diagrams"],
) =>
  Effect.gen(function* () {
    const issue = yield* work.show(e.issue_id),
      history = yield* work.history(e.issue_id);
    const observed = yield* timestamp;
    const findings: ReportSnapshot["findings"][number][] = [];
    for (const message of e.report_intent?.evidence
      ? []
      : (e.messages ?? []).filter((m) => m.type === "finding").slice(-8))
      if (message.type === "finding")
        findings.push({
          title: `Finding · ${message.request_id}`,
          category: message.role,
          summary: message.body,
          evidence: `Retained worker finding from ${message.sender_session_id}, generation ${message.generation}. References (inert text): ${bounded(JSON.stringify(message.evidence))}`,
          references: message.evidence.slice(0, 8).flatMap((ref) => {
            const value = { path: ref.path, line: ref.line, commit: ref.base, url: ref.url };
            return Schema.is(SourceReferenceSchema)(value) ? [value] : [];
          }),
        });
    const evidence = e.report_intent?.evidence;
    if (evidence && e.report_receipt && markdown) {
      ensure(
        researchMarkdown(e, e.report_receipt.report_id, evidence) === markdown,
        "REPORT_IDENTITY",
        "Structured report input does not match the verified Markdown artifact",
      );
      findings.splice(0);
      for (const [i, finding] of evidence.findings.entries())
        findings.push({
          title: `Research finding ${i + 1}`,
          category: "Retained research report",
          summary: bounded(finding.finding),
          evidence: bounded(
            `Worker report evidence (attributed claim): ${JSON.stringify(finding.evidence)}`,
          ),
          references: finding.evidence.slice(0, 16).flatMap((ref) => {
            const value = { path: ref.path, line: ref.line, commit: ref.base, url: ref.url };
            return Schema.is(SourceReferenceSchema)(value) ? [value] : [];
          }),
        });
    }
    if (e.workflow_policy === "full-openspec" && e.openspec_change)
      findings.push({
        title: "OpenSpec identity",
        category: "Controller metadata",
        summary: e.openspec_change,
        evidence:
          "Retained change/archive identity. Specification contents were not re-read for this snapshot.",
        references: [
          {
            path: e.archive_path ?? `openspec/changes/${e.openspec_change}`,
            ...(e.archive_path && e.delivered_commit ? { commit: e.delivered_commit } : {}),
          },
        ],
      });
    if (e.delivered_commit)
      findings.push({
        title: "Git delivery identity",
        category: "Controller metadata",
        summary: e.delivered_commit,
        evidence: bounded(
          `Retained delivery receipt: ${JSON.stringify(e.delivery_receipt ?? "unavailable")}`,
        ),
        references: [{ commit: e.delivered_commit }],
      });
    const checks: ReportSnapshot["checks"][number][] = [];
    if (e.verification_receipt?.commands.length)
      checks.push({
        name: "Retained repository verification",
        status: "passed",
        at: e.verification_receipt.at,
        evidence: bounded(
          `Controller receipt for fingerprint ${e.verification_receipt.fingerprint}: ${JSON.stringify(e.verification_receipt.commands)}`,
        ),
      });
    else
      checks.push({
        name: "Repository verification",
        status: "not_run",
        evidence: "No executed-command receipt is retained in this snapshot.",
      });
    if (e.review_receipt)
      checks.push({
        name: "Retained independent Review",
        status:
          e.review_receipt.fingerprint === e.verification_receipt?.fingerprint
            ? e.review_receipt.passed
              ? "passed"
              : "failed"
            : "unavailable",
        evidence: bounded(
          `Review by ${e.review_receipt.session_id} for fingerprint ${e.review_receipt.fingerprint}: ${e.review_receipt.findings}`,
        ),
      });
    else checks.push({ name: "Independent Review", status: "unavailable" });
    const dependencies = [];
    for (const id of issue.dependencies.slice(0, 32)) dependencies.push(yield* work.show(id));
    // IDs use generated node names, while labels encode every Mermaid control
    // character. User text cannot add directives, HTML, links or executable source.
    const label = (s: string) =>
      s.slice(0, 160).replace(/[^a-zA-Z0-9 ._-]/gu, (c) => `#${c.codePointAt(0)};`);
    const relationships = `flowchart LR\n  task["${label(issue.title)}"]\n${dependencies.map((d, i) => `  dependency${i}["${label(d.title)}"] --> task`).join("\n")}\n  task --> worker["OpenCode session"]\n  worker --> evidence["Retained evidence snapshot"]`;
    return yield* decode(
      ReportSnapshotSchema,
      {
        schema_version: 1,
        issue_id: e.issue_id,
        execution_id: e.execution_id,
        title: bounded(title ?? issue.title),
        summary: bounded(evidence?.conclusions ?? issue.description),
        observed_at: observed,
        status: `${e.current_phase} · generation ${e.control_generation}`,
        provenance: `Controller-owned retained evidence for ${e.execution_id}. Worker findings/report text are attributed claims; check receipts are labelled separately. No checks were rerun for this static presentation.`,
        findings: findings.slice(-64),
        checks,
        diagrams: [
          ...(diagrams ?? evidence?.diagrams ?? []),
          { title: "Observed work relationships", source: relationships },
          {
            title: "Authority and evidence ownership",
            source:
              "flowchart TD\n  Abra[Abra supervisor] --> Controller[Deterministic controller]\n  Controller --> Graph[SQLite work graph]\n  Controller --> Native[OpenCode sessions and native queues]\n  Native --> Workers[Explore Apply Review Research]\n  Workers --> Evidence[Retained findings and check receipts]\n  Evidence --> Report[Read only report snapshot]\n  Controller --> Git[Git and OpenSpec artifacts]",
          },
        ].slice(0, 8),
        events: history.slice(-32).map((h) => ({
          label: h.kind,
          status: h.kind,
          at: h.at,
          detail:
            Buffer.byteLength(h.reason) > 512
              ? Buffer.from(h.reason).subarray(0, 480).toString("utf8") + "… [truncated]"
              : h.reason,
        })),
        excerpts: markdown
          ? [
              {
                title: "Retained research report",
                kind: "code",
                text: markdown,
                provenance: `Report ${e.report_receipt!.report_id}; SHA-256 ${e.report_receipt!.hash}; base ${e.report_receipt!.base_commit}.`,
              },
            ]
          : [],
        limitations: [
          ...(evidence?.limitations ?? []).map(bounded),
          ...(diagrams
            ? [
                "Diagram annotations were explicitly supplied for this visual revision. They are explanatory context, not check or approval evidence.",
              ]
            : []),
          "Snapshot only; later workflow or filesystem changes are not reflected.",
          "Findings are retained worker evidence and do not authorize scope, approval or delivery changes.",
          "Long labels, history and reference text may be truncated for presentation. At most eight independent message findings and 32 lifecycle events are shown; full history remains in the controller. Invalid links remain inert evidence text.",
          ...(e.report_intent ? [] : ["No retained research report was available."]),
          ...(issue.dependencies.length > 32
            ? ["Dependency diagram limited to the first 32 direct dependencies."]
            : []),
        ],
      },
      "Controller report snapshot",
    );
  });
