import { Effect } from "effect";
import {
  type IssueId,
  type LeadId,
  type RepositoryId,
  timestamp,
} from "@abracode/contracts/identities";
import {
  LeadAttentionSchema,
  LeadEvidencePageSchema,
  LeadEvidenceQuery,
} from "@abracode/contracts/visibility/lead-observation";
import { requiresResponse } from "@abracode/contracts/workflow/message-contracts";
import { decode } from "../../decode.ts";
import { CrewError, type Config, type Issue, type Project } from "../../domain.ts";
import { domainEffect } from "../../effect.ts";
import { diagnosticText } from "../../opencode/diagnostics.ts";
import { type Runtime } from "../../opencode/runtime.ts";
import { type Records } from "../../storage/store.ts";
import { type LeadSummary } from "../../visibility/protocol.ts";
import { nativeActivity } from "../../visibility/supervision.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { scanLeads, type LeadRecord } from "../lead-contracts.ts";
import type { CaptureFn, ReadBundle } from "./snapshot.ts";

export type LeadQueryDeps = {
  config: Config;
  records: Records;
  work: WorkGraph;
  runtime: Runtime;
  capture: CaptureFn;
  project: (id: RepositoryId) => Effect.Effect<Project | undefined, CrewError>;
  issue: (id: IssueId) => Effect.Effect<Issue, CrewError>;
};

export function observeLeadState(
  deps: Pick<LeadQueryDeps, "config" | "runtime">,
  lead: LeadRecord,
) {
  return domainEffect(
    Effect.gen(function* () {
      const observed = yield* deps.runtime.session(lead.session_id).pipe(Effect.result);
      const native = observed._tag === "Success" ? observed.success : undefined;
      const available = native?.directory === deps.config.home && native.agent === "project-lead";
      const activity = nativeActivity(native);
      const state: LeadSummary["state"] = lead.stop_pending
        ? "stopping"
        : !lead.enabled
          ? "disabled"
          : !lead.provisioned
            ? "provisioning"
            : !available
              ? "unavailable"
              : activity === "unavailable" || activity === "unobserved"
                ? "unknown"
                : activity;
      return {
        session_available: available ?? false,
        state,
        observed_at: yield* timestamp,
      };
    }),
  );
}

export function observeLead(
  deps: Pick<LeadQueryDeps, "config" | "runtime">,
  lead: LeadRecord,
  bundle: ReadBundle,
) {
  return Effect.gen(function* () {
    const latest = lead.requests
      .flatMap((r) => (r.request.reply ? [r.request.reply] : []))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    return {
      id: lead.id,
      revision: lead.revision,
      repositories: lead.repositories,
      enabled: lead.enabled,
      session_id: lead.session_id,
      parent_session_id: lead.parent_session_id,
      ...(yield* observeLeadState(deps, lead)),
      request_count: lead.requests.length,
      outstanding_count: lead.requests.filter((r) => requiresResponse(r.request)).length,
      requests: lead.requests
        .filter((r) => requiresResponse(r.request))
        .slice(0, 20)
        .map((r) => ({
          issue_id: r.issue_id,
          request_id: r.request.request_id,
          status: r.request.status,
          question: diagnosticText(r.request.body ?? "Controller request", 1500),
          reply: r.request.reply ? diagnosticText(r.request.reply.body, 1500) : undefined,
        })),
      pending_proposals: lead.proposals.filter((p) => !p.accepted).map((p) => p.request_id),
      assigned_work: bundle.issues
        .filter((i) => lead.repositories.includes(i.repository_id) && i.status !== "closed")
        .map((i) => i.id),
      latest_outcome: latest ? diagnosticText(latest.body, 1500) : undefined,
    };
  });
}

export function leadOverview(
  deps: Pick<LeadQueryDeps, "config" | "records" | "runtime">,
  bundle: ReadBundle,
) {
  return domainEffect(
    Effect.gen(function* () {
      const scan = yield* scanLeads(deps.records);
      const leads = yield* Effect.forEach(scan.records, (lead) => observeLead(deps, lead, bundle), {
        concurrency: 4,
      });
      const leadsById = new Map<LeadId, (typeof leads)[number]>(
        leads.map((summary) => [summary.id, summary]),
      );
      const repositories = new Map(bundle.issues.map((issue) => [issue.id, issue.repository_id]));
      const attention: Array<(typeof LeadAttentionSchema.Type.entries)[number]> = [];
      for (const lead of scan.records) {
        const scope = new Set([
          ...lead.repositories,
          ...lead.proposals.flatMap((proposal) =>
            proposal.batch.tasks.map((task) => task.repository_id),
          ),
          ...lead.requests.flatMap((request) => repositories.get(request.issue_id) ?? []),
        ]);
        const state = leadsById.get(lead.id)!.state;
        for (const repository_id of scope) {
          const unanswered = lead.requests.filter(
            (request) =>
              repositories.get(request.issue_id) === repository_id &&
              requiresResponse(request.request),
          ).length;
          const proposals = lead.proposals.filter(
            (proposal) =>
              !proposal.accepted &&
              proposal.batch.tasks.some((task) => task.repository_id === repository_id),
          ).length;
          if (unanswered || proposals)
            attention.push({
              lead_id: lead.id,
              repository_id,
              state,
              unanswered,
              proposals,
            });
        }
      }
      return {
        leads,
        diagnostics: scan.errors.map((error) => diagnosticText(error.message)),
        attention: {
          entries: attention.slice(0, 20),
          total: attention.length,
          truncated: attention.length > 20,
          diagnostic_count: scan.errors.length,
        },
      };
    }),
  );
}

export function leadEvidence(deps: LeadQueryDeps, input: typeof LeadEvidenceQuery.Type) {
  return domainEffect(
    Effect.gen(function* () {
      const query = yield* decode(LeadEvidenceQuery, input, "Lead evidence query");
      const { repository_id, issues, scan } = yield* deps.capture(() =>
        Effect.gen(function* () {
          const issue = query.issue_id ? yield* deps.issue(query.issue_id) : undefined;
          const repository_id = issue?.repository_id ?? query.repository_id!;
          if (!issue && !(yield* deps.project(repository_id)))
            return yield* new CrewError("NOT_FOUND", "Repository is not registered");
          // A ticket list only needs that ticket. Detail also shows related repository work.
          const issues =
            issue && !query.lead_id
              ? [issue]
              : yield* deps.work.repositoryIssueSummaries(repository_id);
          return { repository_id, issues, scan: yield* scanLeads(deps.records) };
        }),
      );
      const scopedIssueIDs = new Set(
        query.issue_id ? [query.issue_id] : issues.map((task) => task.id),
      );
      const requestsFor = (lead: LeadRecord) =>
        lead.requests.filter((request) => scopedIssueIDs.has(request.issue_id));
      const proposalsFor = (lead: LeadRecord) =>
        lead.proposals.filter((proposal) =>
          proposal.batch.tasks.some((task) => task.repository_id === repository_id),
        );
      const scoped = scan.records
        .filter(
          (lead) =>
            lead.repositories.includes(repository_id) ||
            requestsFor(lead).length > 0 ||
            proposalsFor(lead).length > 0 ||
            lead.proposals.some((proposal) =>
              proposal.accepted?.tasks.some((task) => task.issue.repository_id === repository_id),
            ),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const scopedById = new Map<LeadId, LeadRecord>(scoped.map((lead) => [lead.id, lead]));
      const selected = query.lead_id ? scopedById.get(query.lead_id) : undefined;
      if (query.lead_id && !selected)
        return yield* new CrewError(
          "INVALID_SELECTION",
          "This lead has no configured or retained relationship to the selected task",
        );
      const offset = query.offset ?? 0;
      const entries = yield* Effect.forEach(
        selected ? [selected] : scoped.slice(offset, offset + 20),
        (lead) =>
          Effect.gen(function* () {
            const observation = yield* observeLeadState(deps, lead);
            const requests = requestsFor(lead);
            const proposals = proposalsFor(lead);
            return {
              id: lead.id,
              revision: lead.revision,
              repositories: lead.repositories,
              enabled: lead.enabled,
              session_id: lead.session_id,
              ...observation,
              model: lead.model,
              request_count: requests.length,
              outstanding_count: requests.filter((request) => requiresResponse(request.request))
                .length,
              proposal_count: proposals.length,
              pending_proposal_count: proposals.filter((proposal) => !proposal.accepted).length,
              scope: lead.repositories.includes(repository_id)
                ? ("configured_repository" as const)
                : ("retained_history" as const),
            };
          }),
        { concurrency: 4 },
      );
      let detail: typeof LeadEvidencePageSchema.Type.detail;
      if (selected) {
        const requests = requestsFor(selected);
        const proposals = proposalsFor(selected);
        const request_offset = query.request_offset ?? 0;
        const proposal_offset = query.proposal_offset ?? 0;
        const captured = new Set([
          ...(query.issue_id ? [query.issue_id] : []),
          ...requests.map((request) => request.issue_id),
          ...proposals.flatMap(
            (proposal) =>
              proposal.accepted?.tasks
                .filter((task) => task.issue.repository_id === repository_id)
                .map((task) => task.issue.id) ?? [],
          ),
        ]);
        const related = issues.filter(
          (task) => selected.repositories.includes(repository_id) || captured.has(task.id),
        );
        detail = {
          lead_id: selected.id,
          retired_sessions: selected.retired_sessions,
          requests: requests
            .slice(request_offset, request_offset + 10)
            .map(({ issue_id, request }) => ({
              issue_id,
              request_id: request.request_id,
              generation: request.generation,
              recipient_session_id: request.recipient_session_id,
              body: request.body,
              response: request.response,
              source: request.source,
              status: request.status,
              created_at: request.created_at,
              acknowledged_at: request.acknowledged_at,
              reply: request.reply,
              recovery: request.response_recovery?.status,
            })),
          request_limit: 10,
          request_total: requests.length,
          request_offset,
          request_next: request_offset + 10 < requests.length ? request_offset + 10 : undefined,
          proposals: proposals.slice(proposal_offset, proposal_offset + 5).map((proposal) => {
            const acceptedByKey = new Map(
              proposal.accepted?.tasks.map((accepted) => [accepted.client_key, accepted.issue.id]),
            );
            return {
              request_id: proposal.request_id,
              revision: proposal.revision,
              accepted: !!proposal.accepted,
              tasks: proposal.batch.tasks
                .filter((task) => task.repository_id === repository_id)
                .map((task) => ({
                  key: task.client_key,
                  title: diagnosticText(task.title, 256),
                  description: diagnosticText(task.description, 1500),
                  repository_id: task.repository_id,
                  policy: task.workflow_policy,
                  priority: task.priority,
                  dependencies: (task.dependencies ?? []).slice(0, 32),
                  accepted_issue_id: acceptedByKey.get(task.client_key),
                  limited:
                    task.title.length > 256 ||
                    task.description.length > 1500 ||
                    (task.dependencies?.length ?? 0) > 32,
                })),
            };
          }),
          proposal_total: proposals.length,
          proposal_offset,
          proposal_next: proposal_offset + 5 < proposals.length ? proposal_offset + 5 : undefined,
          related_work: related
            .slice(0, 50)
            .map((task) => ({ issue_id: task.id, title: task.title, issue_status: task.status })),
          related_total: related.length,
        };
      }
      return yield* decode(
        LeadEvidencePageSchema,
        {
          issue_id: query.issue_id,
          repository_id,
          observed_at: yield* timestamp,
          entries,
          total: scoped.length,
          offset,
          next_offset: !selected && offset + 20 < scoped.length ? offset + 20 : undefined,
          diagnostics: scan.errors.map((error) => diagnosticText(error.message)).slice(0, 20),
          detail,
        },
        "Lead evidence page",
      );
    }),
  );
}
