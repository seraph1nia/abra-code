import { Clock, Effect, Schema } from "effect";
import { IssueId, timestamp, timestampAt } from "@abracode/contracts/identities";
import { taskAttention } from "@abracode/contracts/visibility/attention";
import { type CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { deliveryOutcome } from "../workflow/delivery-outcome.ts";
import { type Queries, type ReadBundle } from "../workflow/queries.ts";
import { fleetCounts, fleetRepositories } from "./fleet.ts";
import {
  bindRetainedWork,
  communication,
  retainedWork,
  sessions,
  supervision,
} from "./projections.ts";
import { type WorkItem, type WorkSnapshot } from "./protocol.ts";
import { supervisionSummary } from "./supervision.ts";

export function buildSnapshot(
  queries: Queries,
  closedPage?: number,
  bundle?: ReadBundle,
  includeLeads = true,
): Effect.Effect<WorkSnapshot, CrewError> {
  return domainEffect(
    Effect.gen(function* () {
      const observation = bundle ?? (yield* queries.observe());
      const { executions, issues, diagnostics } = observation;
      const ready = yield* queries.ready(observation);
      const executionsByID = new Map(executions.map((e) => [e.issue_id, e]));
      const issuesByID = new Map(issues.map((issue) => [issue.id, issue]));
      const work: WorkItem[] = ready.map((r) =>
        retainedWork(
          queries.settings.supervisionMode,
          r.issue,
          r.execution ?? executionsByID.get(r.issue.id),
          r,
        ),
      );
      const conflicts = issues.filter(
        (i) =>
          i.status === "closed" &&
          executionsByID.has(i.id) &&
          executionsByID.get(i.id)!.current_phase !== "completed",
      );
      const conflictIDs = new Set(conflicts.map((i) => i.id));
      const closed = issues
        .filter((i) => i.status === "closed" && !conflictIDs.has(i.id))
        .sort((a, b) => {
          const date = (id: IssueId) => executionsByID.get(id)?.updated_at ?? "";
          return date(b.id).localeCompare(date(a.id)) || a.id.localeCompare(b.id);
        });
      const page = Math.max(
        0,
        Math.min(Math.floor(closedPage ?? 0), Math.max(0, Math.ceil(closed.length / 50) - 1)),
      );
      const selectedClosed = closed.slice(page * 50, (page + 1) * 50);
      for (const issue of [...conflicts, ...selectedClosed]) {
        const e = executionsByID.get(issue.id);
        work.push(
          retainedWork(
            queries.settings.supervisionMode,
            issue,
            e,
            undefined,
            observation.closures[issue.id],
          ),
        );
      }
      const workByID = new Map(work.map((item) => [item.issue_id, item]));
      for (const e of executions.filter(
        (e) => e.current_phase !== "completed" && !workByID.has(e.issue_id),
      )) {
        work.push({
          issue_id: e.issue_id,
          title: e.issue_id,
          repository_id: e.repository_id,
          priority: 4,
          issue_status: "unavailable",
          ...supervision(queries.settings.supervisionMode, e),
          policy: e.workflow_policy,
          scope: e.scope,
          report: e.report_receipt,
          phase: e.current_phase,
          active_role: e.active_role,
          sessions: sessions(e),
          supervisor_session_id: e.supervisor_session_id,
          eligible: false,
          blockers: ["Active execution has no open WorkGraph issue; inspect recovery"],
        });
        workByID.set(e.issue_id, work.at(-1)!);
      }
      for (const diagnostic of diagnostics.filter((d) => d.key.startsWith("execution/"))) {
        const id = diagnostic.key.slice("execution/".length);
        if (!Schema.is(IssueId)(id)) continue;
        const item = workByID.get(id);
        if (item) {
          Object.assign(item, {
            phase: "recovery_required",
            error: diagnostic.message,
            eligible: false,
            blockers: [...item.blockers, diagnostic.message],
          });
        } else {
          work.push({
            issue_id: id,
            title: id,
            priority: 4,
            issue_status: "unavailable",
            phase: "recovery_required",
            sessions: [],
            eligible: false,
            blockers: [diagnostic.message],
            error: diagnostic.message,
          });
        }
      }
      const aggregate = yield* queries.supervisionAggregate(observation, ready);
      const leads = includeLeads ? yield* queries.leadOverview(observation) : undefined;
      const supervisionByID = new Map(aggregate.tasks.map((task) => [task.issue_id, task]));
      const observedAt = yield* Clock.currentTimeMillis;
      const observedTimestamp = timestampAt(observedAt);
      for (const item of work) {
        const execution = executionsByID.get(item.issue_id);
        const issue = issuesByID.get(item.issue_id);
        Object.assign(item, bindRetainedWork(item, execution, issue, observedAt), {
          supervision:
            supervisionByID.get(item.issue_id) ??
            supervisionSummary({
              execution,
              blockers: item.blocker_details ?? [],
              closed: issue?.status === "closed",
              observed_at: observedTimestamp,
            }),
        });
      }
      const day = observation.day;
      const completedToday = observation.completions.filter(
        (row) => !conflictIDs.has(row.issue_id),
      ).length;
      // History pagination controls rows, never fleet totals. Closed rows outside
      // the page need no session, OpenSpec or per-ticket history inspection.
      const loaded = new Set(work.map((w) => w.issue_id));
      const fleetWork: WorkItem[] = [
        ...work,
        ...closed
          .filter((i) => !loaded.has(i.id))
          .map((i) => ({
            issue_id: i.id,
            title: i.title,
            repository_id: i.repository_id,
            priority: i.priority,
            issue_status: i.status,
            ...supervision(queries.settings.supervisionMode, executionsByID.get(i.id)),
            communication: communication(executionsByID.get(i.id)),
            sessions: [],
            eligible: false,
            blockers: [],
          })),
      ];
      const nativeTasks = executions.filter(
        (e) => e.active_role && e[`${e.active_role}_session_id`] && e.current_phase !== "completed",
      );
      const attention = fleetWork.flatMap((entry) => {
        const execution = executionsByID.get(entry.issue_id);
        return taskAttention(
          execution
            ? {
                ...entry,
                phase: execution.current_phase,
                decisions: execution.decisions,
                waits: execution.waits,
                attention: execution.attention,
                outcome: deliveryOutcome(
                  execution,
                  entry.issue_status === "unavailable" ? undefined : entry.issue_status,
                  observedAt,
                ),
              }
            : entry,
        );
      });
      const fleet = {
        ...day,
        counts: fleetCounts(fleetWork),
        total: fleetWork.length,
        native_total: nativeTasks.length,
        native_observed: nativeTasks.filter((e) => {
          const task = supervisionByID.get(e.issue_id);
          return !!task && !["unobserved", "unavailable", "unknown"].includes(task.native_activity);
        }).length,
        completed_today: completedToday,
        repositories: fleetRepositories(fleetWork),
        attention: attention.slice(0, 100),
        attention_total: attention.length,
        attention_truncated: attention.length > 100,
      };
      work.sort(
        (a, b) =>
          Number(!a.phase) - Number(!b.phase) ||
          a.priority - b.priority ||
          (a.issue_id < b.issue_id ? -1 : Number(a.issue_id > b.issue_id)),
      );
      return {
        fleet,
        leads: leads?.leads,
        management: leads?.attention,
        lead_diagnostics: leads?.diagnostics,
        supervision: aggregate,
        home: queries.settings.home,
        record_diagnostics: diagnostics,
        work,
        closed_total: closed.length,
        closed_page: page,
        at: yield* timestamp,
        work_revision: observation.source.work_revision,
      };
    }),
  );
}
