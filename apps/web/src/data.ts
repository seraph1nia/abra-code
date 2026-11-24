import type { BindingSelection } from "@abracode/contracts/web/bindings";
import { workInvalidationKeys, type ChangeScope } from "@abracode/contracts/web/changes";
import type {
  SaveSurfaceSchema,
  ExportDocumentSchema,
} from "@abracode/contracts/web/report-actions";
/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4 HTTP atoms are the browser query boundary. */
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom, AtomHttpApi, Reactivity } from "effect/reactivity";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { workspaceApi } from "@abracode/contracts/web/http-api";
import { IssueId } from "@abracode/contracts/identities";
import { PrepareDiagramSelectionSchema } from "@abracode/contracts/web/diagram-actions";

export class WorkspaceApi extends AtomHttpApi.Service<WorkspaceApi>()("WorkspaceApi", {
  api: workspaceApi,
  httpClient: FetchHttpClient.layer,
}) {}

const workKey = (issue: string) => `work:${issue}`;
export const queryOptions = (issue: string) => ({
  reactivityKeys: ["work-observed", workKey(issue)],
  timeToLive: "30 seconds" as const,
});
export const bootstrapQuery = WorkspaceApi.query("workspace", "bootstrap", {});
export const agentsQuery = WorkspaceApi.query("workspace", "agents", { timeToLive: "30 seconds" });
export const memoryEnabledQuery = WorkspaceApi.query("workspace", "memoryEnabled", {
  timeToLive: "30 seconds",
});
export const repositoriesQuery = WorkspaceApi.query("workspace", "repositories", {});
/** An uncached exact read; missing admission evidence must be checked afresh. */
export const readReceipt = WorkspaceApi.runtime.fn((request_id: string) =>
  Effect.flatMap(WorkspaceApi, (client) => client.workspace.receipt({ query: { request_id } })),
);
export const selectedReceiptQuery = (request_id: string, issue: string) =>
  WorkspaceApi.query("workspace", "receipt", { query: { request_id }, ...queryOptions(issue) });
export const historyQuery = (cursor: string) =>
  WorkspaceApi.query("workspace", "history", { query: { cursor }, timeToLive: "30 seconds" });
export const surfaceQuery = (
  id: string,
  revision: number,
  session?: import("@abracode/contracts/identities").SessionId,
) =>
  WorkspaceApi.query("workspace", "surface", {
    query: { surface_id: id, revision, ...(session ? { session_id: session } : {}) },
    timeToLive: "30 seconds",
  });
/** Exact preparation is a read, even though its typed endpoint takes a POST body. */
export const diagramQuery = Atom.family((key: string) =>
  WorkspaceApi.runtime
    .atom(
      Effect.gen(function* () {
        const selection = yield* Schema.decodeEffect(
          Schema.fromJsonString(PrepareDiagramSelectionSchema),
        )(key);
        const client = yield* WorkspaceApi;
        return yield* client.workspace.prepareDiagrams({ payload: selection });
      }),
    )
    .pipe(Atom.setIdleTTL(0)),
);
const bindingQueryFamily = Atom.family((key: string) => {
  const [mode, rawIds = ""] = key.split(":");
  const unfiltered = mode === "all";
  const ids = rawIds ? rawIds.split(",") : [];
  return WorkspaceApi.query("work", "binding", {
    query: {
      issue_ids: ids.map((id) => IssueId.make(id)),
      include_population: unfiltered,
    },
    reactivityKeys: ["work-observed", ...(unfiltered ? ["work-finder"] : []), ...ids.map(workKey)],
    timeToLive: "0 seconds",
  });
});
export const bindingQuery = (selection: BindingSelection) => {
  const ids = [...new Set(selection.ids)].sort();
  return bindingQueryFamily(`${selection.unfiltered ? "all" : "ids"}:${ids.join(",")}`);
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
export const submitMutation = WorkspaceApi.mutation("workspace", "submit");
export const resolveResource = WorkspaceApi.mutation("work", "resolve");
export const saveSurface = Atom.family((_request: string) =>
  WorkspaceApi.runtime.fn<typeof SaveSurfaceSchema.Type>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.work.saveSurface({ payload })),
  ),
);
export const invalidateWork = WorkspaceApi.runtime.fn((scope: ChangeScope) => {
  const keys = [
    ...workInvalidationKeys(scope),
    ...(scope.all ||
    scope.presentations ||
    scope.admissions ||
    scope.work_all ||
    scope.issues?.length
      ? ["reviews-observed"]
      : []),
  ];
  return keys.length ? Reactivity.invalidate(keys) : Effect.void;
});

export const exportDocument = Atom.family((_identity: string) =>
  WorkspaceApi.runtime.fn<typeof ExportDocumentSchema.Type>()((payload) =>
    Effect.flatMap(WorkspaceApi, (client) => client.work.exportDocument({ payload })),
  ),
);
