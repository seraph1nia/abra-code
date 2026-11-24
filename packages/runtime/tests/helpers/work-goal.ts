import * as Id from "@abracode/contracts/identities";
import type { NewIssue } from "../../src/work/graph.ts";
export const goal = (id: string): NewIssue => ({
  repository_id: Id.RepositoryId.make("api"),
  request_id: Id.RequestId.make(id),
  title: `ÉTUDE ${id}`,
  description: "Retained query fixture",
  priority: 2,
  dependencies: [],
});
