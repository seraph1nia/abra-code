import { Effect } from "effect";
import {
  briefingLimit,
  type BriefingItem,
  type BriefingQuery,
  type WorkBriefing,
} from "@abracode/contracts/visibility/briefing";
import { fleetLabels, fleetState } from "./fleet.ts";
import { taskAttention } from "./attention.ts";
import type { Controller } from "../workflow/controller.ts";
import { Visibility } from "./read-model.ts";
import { timestamp } from "../identities.ts";
import type { WorkItem, WorkSnapshot } from "./protocol.ts";
import type { ReadBundle } from "../workflow/queries.ts";
import type { InboxPage } from "@abracode/contracts/visibility/github-inbox";

type Query = typeof BriefingQuery.Type;

function workSections(snapshot: WorkSnapshot, bundle: ReadBundle, scope: Query) {
  const decisions: BriefingItem[] = [],
    ongoing: BriefingItem[] = [],
    queue: BriefingItem[] = [];
  const limitations = new Set<string>();
  const executions = new Map(bundle.executions.map((e) => [e.issue_id, e]));
  const inScope = (item: Pick<WorkItem, "repository_id">) =>
    !scope.repository_id || item.repository_id === scope.repository_id;
  if (bundle.diagnostics.length) limitations.add("Some retained records could not be read.");
  const dependents = new Map<WorkItem["issue_id"], string[]>();
  for (const issue of bundle.issues.filter(inScope)) {
    if (issue.status === "closed") continue;
    for (const dependency of issue.dependencies) {
      const ids = dependents.get(dependency) ?? [];
      ids.push(issue.id);
      dependents.set(dependency, ids);
    }
  }
  for (const work of snapshot.work.filter(inScope)) {
    const state = fleetState(work);
    if (state === "completed") continue;
    const { issue_id, priority } = work;
    const e = executions.get(issue_id);
    const base = {
      issue_id,
      priority,
      repository_id: work.repository_id,
      pull_request: e?.pull_request_reference,
      title: work.title.slice(0, 200),
      observed_at: snapshot.at,
    };
    if (
      work.issue_status === "unavailable" ||
      work.error ||
      state === "unknown" ||
      (work.active_role &&
        ["unavailable", "unobserved", "unknown"].includes(work.supervision?.native_activity ?? ""))
    )
      limitations.add("Some task or native activity observations are incomplete.");
    const attention = taskAttention({
      ...work,
      decisions: e?.decisions,
      waits: e?.waits,
      attention: e?.attention,
    });
    for (const item of attention.filter((item) => item.owner === "user")) {
      const decision = e?.decisions?.find((d) => item.key === `decision:${d.key}:${d.generation}`);
      const kind =
        item.key === "merge-approval" ? "merge" : item.key === "plan-approval" ? "plan" : undefined;
      const receipt =
        kind &&
        e?.approval_receipts.findLast(
          (r) =>
            r.kind === kind &&
            !r.authorized_at &&
            !r.rejected_at &&
            r.fingerprint === (kind === "merge" ? e.delivered_commit : e.plan_fingerprint),
        );
      decisions.push({
        ...base,
        source: [issue_id, item.key, receipt?.fingerprint].filter(Boolean).join("/"),
        fact: [
          item.reason.slice(0, 512),
          dependents.has(issue_id) && "Blocks " + dependents.get(issue_id)!.slice(0, 3).join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
        form_id: receipt?.form_id ?? item.form_id,
        fingerprint: receipt?.fingerprint,
        target: decision
          ? {
              action: "open_decision",
              issue_id,
              key: decision.key,
              generation: decision.generation,
            }
          : {
              action: "open_task",
              issue_id,
              section: kind === "merge" ? "verification" : kind === "plan" ? "plan" : "summary",
            },
      });
    }
    if (attention.some((i) => i.owner === "user")) continue;
    const queued = !e || ["dependency_wait", "capacity_wait", "ready"].includes(state);
    const facts = [
      fleetLabels[state],
      work.delivery_wait?.reason,
      ...(work.waits ?? [])
        .filter((w) => w.status === "waiting" && w.generation === work.generation)
        .map((w) => w.condition),
      ...attention.map((i) => i.reason),
      ...(queued ? work.blockers : []),
    ];
    (queued ? queue : ongoing).push({
      ...base,
      source: [issue_id, work.phase ?? work.issue_status, e?.control_generation]
        .filter((x) => x !== undefined)
        .join("/"),
      fact: facts.filter(Boolean).join(" · ").slice(0, 768),
      target: { action: "open_task", issue_id, section: "summary" },
    });
  }
  const outcomes: BriefingItem[] = [];
  for (const issue of bundle.issues) {
    if (issue.status !== "closed" || !inScope(issue)) continue;
    const e = executions.get(issue.id);
    if (e && e.current_phase !== "completed") continue;
    const report = e?.report_receipt;
    const delivery = e?.delivery_receipt;
    const at = bundle.closures[issue.id] ?? e?.updated_at;
    outcomes.push({
      issue_id: issue.id,
      repository_id: issue.repository_id,
      pull_request: e?.pull_request_reference,
      title: issue.title.slice(0, 200),
      priority: issue.priority,
      observed_at: at ?? snapshot.at,
      source: [issue.id, report?.report_id ?? delivery?.commit ?? "closed"].join("/"),
      fact: report
        ? "Completed investigation · retained Markdown report"
        : delivery
          ? "Completed delivery · " + delivery.commit
          : "Closed in the work graph",
      report: report && { id: report.report_id, hash: report.hash },
      target: { action: "open_task", issue_id: issue.id, section: report ? "reports" : "summary" },
    });
  }
  outcomes.sort(
    (a, b) => b.observed_at.localeCompare(a.observed_at) || a.issue_id.localeCompare(b.issue_id),
  );
  return { decisions, outcomes, ongoing, queue, limitations: [...limitations] };
}

export function workBriefing(controller: Pick<Controller, "queries" | "inbox">, scope: Query = {}) {
  return Effect.gen(function* () {
    const [local, remote] = yield* Effect.all(
      [
        controller.queries.observe().pipe(
          Effect.flatMap((bundle) =>
            new Visibility(controller)
              .snapshot(0, bundle, false)
              .pipe(Effect.map((snapshot) => ({ snapshot, bundle }))),
          ),
          Effect.result,
        ),
        controller.inbox
          .list({
            repository_id: scope.repository_id,
            role: scope.include_open_github ? undefined : "linked",
          })
          .pipe(Effect.result),
      ],
      { concurrency: 2 },
    );
    const sections =
      local._tag === "Success"
        ? workSections(local.success.snapshot, local.success.bundle, scope)
        : {
            decisions: [],
            outcomes: [],
            ongoing: [],
            queue: [],
            limitations: ["Work graph unavailable: " + local.failure.message.slice(0, 240)],
          };
    const { limitations } = sections;
    const page: typeof InboxPage.Type =
      remote._tag === "Success" ? remote.success : { entries: [], total: 0, coverage: [] };
    if (remote._tag === "Failure") {
      // A registered local-only repository has no linked GitHub inbox to cover.
      const localOnly =
        remote.failure.code === "INBOX_PROJECT" &&
        !scope.include_open_github &&
        local._tag === "Success" &&
        local.success.bundle.projects.some((project) => project.id === scope.repository_id);
      if (!localOnly)
        limitations.push("GitHub inbox unavailable: " + remote.failure.message.slice(0, 240));
    }
    if (page.entries.slice(0, briefingLimit).some((row) => row.links.length > briefingLimit))
      limitations.push("GitHub task links are truncated.");
    const coverage = page.coverage
      .slice(0, 100)
      .map((row) => ({ ...row, message: row.message?.slice(0, 240) }));
    if (coverage.length < page.coverage.length || page.coverage.some((c) => c.status !== "current"))
      limitations.push("GitHub repository coverage is incomplete.");
    function section(label: string, rows: BriefingItem[]) {
      if (rows.length > briefingLimit)
        limitations.push(label + " truncated to " + briefingLimit + " of " + rows.length + ".");
      return { entries: rows.slice(0, briefingLimit), total: rows.length };
    }
    if (page.total > briefingLimit)
      limitations.push("GitHub items truncated to " + briefingLimit + " of " + page.total + ".");
    return {
      scope,
      observed_at: yield* timestamp,
      work_revision: local._tag === "Success" ? local.success.snapshot.work_revision : undefined,
      decisions: section("Human decisions", sections.decisions),
      outcomes: section("Recent outcomes", sections.outcomes),
      ongoing: section("Ongoing work", sections.ongoing),
      queue: section("Queue", sections.queue),
      limitations,
      github: {
        entries: page.entries
          .slice(0, briefingLimit)
          .map(
            ({
              repository_id,
              repo_node,
              item_node,
              kind,
              number,
              title,
              url,
              updated_at,
              links,
            }) => ({
              repository_id,
              repo_node,
              item_node,
              kind,
              number,
              title: title.slice(0, 200),
              url,
              updated_at,
              links: links.slice(0, briefingLimit).map((l) => l.issue_id),
            }),
          ),
        total: page.total,
        coverage,
      },
    } satisfies typeof WorkBriefing.Type;
  });
}
