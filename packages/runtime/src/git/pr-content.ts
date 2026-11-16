import { type Commit } from "../identities.ts";
import { ensure, type ManagedExecution, type Project } from "../domain.ts";
import { verificationCommand } from "../config/contracts.ts";

const start = "<!-- abracode:summary:start -->",
  end = "<!-- abracode:summary:end -->";
export function prContent(p: Project, e: ManagedExecution, commit: Commit) {
  const title = (
    e.setup ? `Initialize OpenSpec for ${p.id}` : (e.intent?.title ?? `Work ${e.issue_id}`)
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const checks = e.verification_receipt?.commands
    .map((c) => JSON.stringify(verificationCommand(c).argv))
    .join("\n");
  const lines = [
    start,
    "## Requested change",
    title,
    "",
    e.setup
      ? "Initialize repository-local OpenSpec configuration while preserving existing agent instructions and skills."
      : (e.intent?.description ??
        "Request context is unavailable; inspect the retained planning artifacts."),
    "",
    `Issue: ${e.issue_id}`,
    `Workflow: ${e.workflow_policy}`,
    `Source commit: ${commit}`,
    `Delivery gates: ${e.verification_receipt && e.review_receipt?.passed && (e.workflow_policy !== "full-openspec" || e.archive_path) ? "verification, independent Review and required archival complete" : "pending; provisional publication is not final delivery"}`,
    ...(e.scope
      ? [
          `Scope revision ${e.scope.revision}: ${e.scope.contract.goal}`,
          ...e.scope.contract.acceptance.map((criterion) => `- ${criterion}`),
          ...e.scope.contract.constraints.map((constraint) => `Constraint: ${constraint}`),
        ]
      : []),
    ...(e.archive_path ? [`OpenSpec archive: ${e.archive_path}`] : []),
    "",
    "## Recorded evidence",
    ...(e.verification_receipt
      ? [`Verification passed at ${e.verification_receipt.at}.`, "```json", checks ?? "", "```"]
      : ["No repository check receipt recorded."]),
    ...(e.review_receipt
      ? [
          `Independent Review: ${e.review_receipt.passed ? "passed" : "failed"}.`,
          e.review_receipt.findings.slice(0, 8192),
        ]
      : ["No independent worker Review receipt recorded."]),
    end,
  ];
  const body = [
    start,
    ...lines
      .slice(1, -1)
      .map((line) =>
        line
          .replaceAll(start, "[AbraCode summary start marker]")
          .replaceAll(end, "[AbraCode summary end marker]"),
      ),
    end,
  ].join("\n");
  ensure(
    Buffer.byteLength(body) <= 64 * 1024,
    "PR_CONTENT_LIMIT",
    "Controller PR summary exceeds its bounded size; shorten request context explicitly",
  );
  return { title, body };
}
/** Replace only a complete, unambiguous owned section; preserve every outside byte. */
export function updateSummary(existing: string, owned: string) {
  const a = existing.indexOf(start),
    b = existing.indexOf(end);
  if (a === -1 && b === -1)
    return existing ? `${existing}${existing.endsWith("\n") ? "\n" : "\n\n"}${owned}` : owned;
  ensure(
    a >= 0 && b > a && existing.lastIndexOf(start) === a && existing.lastIndexOf(end) === b,
    "PR_BODY_AMBIGUOUS",
    "Controller summary markers are incomplete or duplicated; preserve the PR body for inspection",
  );
  return existing.slice(0, a) + owned + existing.slice(b + end.length);
}
