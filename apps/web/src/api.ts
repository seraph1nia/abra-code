import { IssueId, RequestId, ContentHash } from "@abracode/contracts/identities";
import { HttpApiClient } from "effect/http-api";
import { workspaceApi } from "@abracode/contracts/web/http-api";

const workspaceUrls = HttpApiClient.urlBuilder(workspaceApi);

/** Binary/HTML navigation uses the same shared endpoint definitions as query atoms. */
export const api = {
  exportURL: (issue: string, request: string, hash: string, exporter: string, download = false) => {
    const query = {
      issue_id: IssueId.make(issue),
      request_id: RequestId.make(request),
      hash: ContentHash.make(hash),
      exporter_hash: ContentHash.make(exporter),
    };
    return download
      ? workspaceUrls.work.exportDownload({ query })
      : workspaceUrls.work.exportPreview({ query });
  },
  documentURL: (issue: string, request: string, hash: string) =>
    workspaceUrls.work.downloadDocument({
      query: {
        issue_id: IssueId.make(issue),
        request_id: RequestId.make(request),
        hash: ContentHash.make(hash),
      },
    }),
};
