import { WorkspaceApi, queryOptions } from "./data.ts";
import { AsyncResult, Atom, Reactivity } from "effect/reactivity";
import {
  IssueId,
  FindingId,
  FindingRevisionId,
  RelativePath,
  SessionId,
  RequestId,
  ContentHash,
} from "@abracode/contracts/identities";
import type { EvidenceQuery } from "@abracode/contracts/web/worker-evidence";
import type { LeadEvidenceQuery } from "@abracode/contracts/visibility/lead-observation";
import type { WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
const workReactivity = WorkspaceApi.runtime.atom(Reactivity.Reactivity);
const ticketQuery = <A, E>(
  read: (options: {
    query: { issue_id: IssueId };
    timeToLive: "30 seconds";
  }) => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) =>
  Atom.family((issue: string) => {
    const query = read({ query: { issue_id: IssueId.make(issue) }, timeToLive: "30 seconds" });
    return Atom.transform(
      query,
      (get) => {
        const ready = get(workReactivity);
        if (!AsyncResult.isSuccess(ready)) return get(query);
        const reactivity = ready.value;
        let dirty = false;
        get.addFinalizer(
          reactivity.registerUnsafe(queryOptions(issue).reactivityKeys, () => {
            // Live observations must not cancel a slower in-flight detail read.
            // Retain one dirty refresh; explicit user refresh still delegates to query.
            if (get.once(query).waiting) dirty = true;
            else get.refresh(query);
          }),
        );
        get.subscribe(query, (value) => {
          get.setSelf(value);
          if (!value.waiting && dirty) {
            dirty = false;
            get.refresh(query);
          }
        });
        return get.once(query);
      },
      { initialValueTarget: query },
    );
  });
export const queries = {
  leads: (query: typeof LeadEvidenceQuery.Type) =>
    WorkspaceApi.query("work", "leads", {
      query,
      ...queryOptions(query.issue_id ?? `repository:${query.repository_id}`),
    }),
  find: (query: WorkDiscovery = {}) =>
    WorkspaceApi.query("work", "find", {
      query,
      reactivityKeys: ["work-finder"],
      timeToLive: "30 seconds",
    }),
  evidence: (query: EvidenceQuery) =>
    WorkspaceApi.query("work", "evidence", {
      query: { issue_id: query.issue_id, request_id: query.request_id, hash: query.hash },
      timeToLive: "30 seconds",
    }),
  verification: ticketQuery((options) => WorkspaceApi.query("work", "verification", options)),
  overview: ticketQuery((options) => WorkspaceApi.query("work", "overview", options)),
  detail: ticketQuery((options) => WorkspaceApi.query("work", "detail", options)),
  decisionPlan: (issue: IssueId, binding: string) =>
    WorkspaceApi.query("work", "detail", {
      query: { issue_id: issue },
      ...queryOptions(issue),
      reactivityKeys: [...queryOptions(issue).reactivityKeys, "decision-plan:" + binding],
    }),
  document: (issue: string, path: string) =>
    WorkspaceApi.query("work", "document", {
      query: { issue_id: IssueId.make(issue), path: RelativePath.make(path) },
      ...queryOptions(issue),
    }),
  diff: (issue: string, file: string, scope: "all" | "uncommitted") =>
    WorkspaceApi.query("work", "diff", {
      query: {
        issue_id: IssueId.make(issue),
        ...(file ? { file: RelativePath.make(file) } : {}),
        scope,
      },
      ...queryOptions(issue),
    }),
  worker: (issue: string, session: string) =>
    WorkspaceApi.query("work", "worker", {
      query: { issue_id: IssueId.make(issue), session_id: SessionId.make(session) },
      ...queryOptions(issue),
      reactivityKeys: [...queryOptions(issue).reactivityKeys, `session:${session}`],
    }),
  workerHistory: (issue: string, session: string, cursor?: string) =>
    WorkspaceApi.query("work", "worker-history", {
      query: {
        issue_id: IssueId.make(issue),
        session_id: SessionId.make(session),
        ...(cursor ? { cursor } : {}),
      },
      ...queryOptions(issue),
      reactivityKeys: [...queryOptions(issue).reactivityKeys, `session:${session}`],
    }),
  messages: (issue: string, offset = 0) =>
    WorkspaceApi.query("work", "messages", {
      query: { issue_id: IssueId.make(issue), offset },
      ...queryOptions(issue),
    }),
  feedback: (issue: string, page = 0, finding_id?: string, revision?: string) =>
    WorkspaceApi.query("work", "feedback", {
      query: {
        issue_id: IssueId.make(issue),
        page,
        ...(finding_id && revision
          ? { finding_id: FindingId.make(finding_id), revision: FindingRevisionId.make(revision) }
          : {}),
      },
      ...queryOptions(issue),
    }),
  report: (issue: string) =>
    WorkspaceApi.query("work", "report", {
      query: { issue_id: IssueId.make(issue) },
      ...queryOptions(issue),
    }),
  artifacts: (issue: string, offset = 0) =>
    WorkspaceApi.query("work", "artifacts", {
      query: { issue_id: IssueId.make(issue), offset },
      ...queryOptions(issue),
    }),
  artifactSummary: (issue: string, request: string, hash: string) =>
    WorkspaceApi.query("work", "artifactSummary", {
      query: {
        issue_id: IssueId.make(issue),
        request_id: RequestId.make(request),
        hash: ContentHash.make(hash),
      },
      ...queryOptions(issue),
    }),
  artifactDocument: (issue: string, request: string, hash: string) =>
    WorkspaceApi.query("work", "artifactDocument", {
      query: {
        issue_id: IssueId.make(issue),
        request_id: RequestId.make(request),
        hash: ContentHash.make(hash),
      },
      timeToLive: "30 seconds",
    }),
  decisions: (issue: string) =>
    WorkspaceApi.query("work", "decisions", {
      query: { issue_id: IssueId.make(issue) },
      ...queryOptions(issue),
    }),
};
