import { Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { Permission } from "@opencode/schema/permission";
import { IssueId, RelativePath, SessionId, RequestId } from "../../../src/identities.ts";
import { makeWorkspaceClient, workspaceUrls } from "../../../src/web/client.ts";
import type { WorkReadName } from "../../../src/web/contracts.ts";

const client = Effect.runSync(makeWorkspaceClient(window.location.origin));
/** React's only Promise boundary. The shared HttpApiClient owns wire validation. */
function promise<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.result(effect)).then((result) => {
    if (result._tag === "Success") return result.success;
    const error = result.failure;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      "message" in error &&
      typeof error.message === "string"
    )
      throw new Error(`${error.code}: ${error.message}`);
    throw new Error("Workspace request could not be confirmed. Refresh before retrying.");
  });
}
export const api = {
  reportURL: (issue: string, request: string, download = false) => {
    const query = { issue_id: IssueId.make(issue), request_id: RequestId.make(request) };
    return download
      ? workspaceUrls.work.download({ query })
      : workspaceUrls.work.preview({ query });
  },
  bootstrap: () => promise(client.workspace.bootstrap()),
  history: (cursor: string) => promise(client.workspace.history({ query: { cursor } })),
  stop: () => promise(client.workspace.stop({ payload: {} })),
  replyForm: (input: { id: string; binding: string; answer: Form.Answer }) =>
    promise(client.workspace.replyForm({ payload: { ...input, id: Form.ID.make(input.id) } })),
  replyPermission: (input: { id: string; binding: string; decision: Permission.Reply }) =>
    promise(
      client.workspace.replyPermission({ payload: { ...input, id: Permission.ID.make(input.id) } }),
    ),
  read(name: WorkReadName, issue: string, input: Record<string, string> = {}): Promise<unknown> {
    const issue_id = IssueId.make(issue);
    switch (name) {
      case "detail":
        return promise(client.work.detail({ query: { issue_id } }));
      case "document":
        return promise(
          client.work.document({ query: { issue_id, path: RelativePath.make(input.path) } }),
        );
      case "diff":
        return promise(
          client.work.diff({
            query: {
              issue_id,
              ...(input.file ? { file: RelativePath.make(input.file) } : {}),
              scope: input.scope === "uncommitted" ? "uncommitted" : "all",
            },
          }),
        );
      case "worker":
        return promise(
          client.work.worker({ query: { issue_id, session_id: SessionId.make(input.session_id) } }),
        );
      case "messages":
        return promise(
          client.work.messages({ query: { issue_id, offset: Number(input.offset ?? 0) } }),
        );
      case "feedback":
        return promise(
          client.work.feedback({ query: { issue_id, page: Number(input.page ?? 0) } }),
        );
      case "report":
        return promise(client.work.report({ query: { issue_id } }));
      case "artifacts":
        return promise(client.work.artifacts({ query: { issue_id } }));
      case "decisions":
        return promise(client.work.decisions({ query: { issue_id } }));
    }
  },
};
