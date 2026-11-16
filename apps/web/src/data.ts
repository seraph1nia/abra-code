import type { LeadEvidenceQuery } from "../../../src/visibility/lead-observation.ts";
import type { SaveSurfaceSchema, ExportDocumentSchema } from "../../../src/web/report-actions.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4 HTTP atoms are the browser query boundary. */
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom, AtomHttpApi, Reactivity } from "effect/reactivity";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { workspaceApi } from "../../../src/web/http-api.ts";
import {
  IssueId,
  RelativePath,
  SessionId,
  RequestId,
  ContentHash,
} from "../../../src/identities.ts";
import type { WorkDiscovery } from "../../../src/visibility/discovery-contracts.ts";

export class WorkspaceApi extends AtomHttpApi.Service<WorkspaceApi>()("WorkspaceApi", {
  api: workspaceApi,
  httpClient: FetchHttpClient.layer,
}) {}

const workKey = (issue: string) => `work:${issue}`;
const queryOptions = (issue: string) => ({
  reactivityKeys: ["work-observed", workKey(issue)],
  timeToLive: "30 seconds" as const,
});
export const bootstrapQuery = WorkspaceApi.query("workspace", "bootstrap", {});
export const historyQuery = (cursor: string) =>
  WorkspaceApi.query("workspace", "history", { query: { cursor }, timeToLive: "30 seconds" });
export const surfaceQuery = (id: string, revision: number) =>
  WorkspaceApi.query("workspace", "surface", {
    query: { surface_id: id, revision },
    timeToLive: "30 seconds",
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
  detail: (issue: string) =>
    WorkspaceApi.query("work", "detail", {
      query: { issue_id: IssueId.make(issue) },
      ...queryOptions(issue),
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
    }),
  workerHistory: (issue: string, session: string, cursor?: string) =>
    WorkspaceApi.query("work", "worker-history", {
      query: {
        issue_id: IssueId.make(issue),
        session_id: SessionId.make(session),
        ...(cursor ? { cursor } : {}),
      },
      ...queryOptions(issue),
    }),
  messages: (issue: string, offset = 0) =>
    WorkspaceApi.query("work", "messages", {
      query: { issue_id: IssueId.make(issue), offset },
      ...queryOptions(issue),
    }),
  feedback: (issue: string, page = 0) =>
    WorkspaceApi.query("work", "feedback", {
      query: { issue_id: IssueId.make(issue), page },
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

// A separate mutation per observed binding prevents concurrent forms sharing results.
export const formReply = Atom.family((_binding: string) =>
  WorkspaceApi.runtime.fn<{
    id: Form.ID;
    binding: string;
    answer: Form.Answer;
  }>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.workspace.replyForm({ payload })),
  ),
);
export const permissionReply = Atom.family((_binding: string) =>
  WorkspaceApi.runtime.fn<{
    id: Permission.ID;
    binding: string;
    decision: Permission.Reply;
  }>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.workspace.replyPermission({ payload })),
  ),
);
export const stopMutation = WorkspaceApi.mutation("workspace", "stop");
export const resolveResource = WorkspaceApi.mutation("work", "resolve");
export const saveSurface = Atom.family((_request: string) =>
  WorkspaceApi.runtime.fn<typeof SaveSurfaceSchema.Type>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.work.saveSurface({ payload })),
  ),
);
export const invalidateWork = WorkspaceApi.runtime.fn((issues: readonly string[]) =>
  Reactivity.invalidate(["work-observed", "work-finder", ...issues.map(workKey)]),
);

export const exportDocument = Atom.family((_identity: string) =>
  WorkspaceApi.runtime.fn<typeof ExportDocumentSchema.Type>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.work.exportDocument({ payload })),
  ),
);
