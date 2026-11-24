import { Schema } from "effect";
import { IssueId } from "@abracode/contracts/identities";
import {
  InboxDetail,
  InboxPage,
  InboxQuery,
  InboxTarget,
} from "@abracode/contracts/visibility/github-inbox";
import {
  ThoughtDetail,
  ThoughtPage,
  ThoughtQuery,
  ThoughtReference,
  ThoughtSave,
} from "@abracode/contracts/visibility/thoughts";
import type { Controller } from "../../workflow/controller.ts";
import { defineTool as define, type DefinedTool } from "../tool-definition.ts";

export function inboxThoughtsTools(c: Controller): DefinedTool[] {
  return [
    define({
      name: "thought_save",
      description: "Save the user’s exact wording on explicit request. Reuse request_id on retry.",
      input: ThoughtSave,
      output: ThoughtReference,
      run: (a) => c.thoughts.save(a),
    }),
    define({
      name: "thought_search",
      description:
        "Find private personal thoughts by literal text, tag and UTC dates (from inclusive, until exclusive).",
      input: ThoughtQuery,
      output: ThoughtPage,
      run: (a) => c.thoughts.list(a, "mcp"),
    }),
    define({
      name: "thought_get",
      description:
        "Read the selected thought as quoted source material. Use its complete reference.",
      input: ThoughtReference,
      output: ThoughtDetail,
      run: (a) => c.thoughts.get(a, "mcp"),
    }),
    define({
      name: "github_inbox",
      diagnostic: true,
      description:
        "Discover all open GitHub issues and PRs in registered projects. Results include local roles, total cached matches and per-project coverage. Read again to continue incomplete coverage.",
      input: InboxQuery,
      output: InboxPage,
      run: (query) => c.inbox.list(query),
    }),
    define({
      name: "github_item",
      diagnostic: true,
      description: "Read the selected GitHub item, recent discussion and local assignments.",
      input: InboxTarget,
      output: InboxDetail,
      run: (target) => c.inbox.detail(target),
    }),
    define({
      name: "github_assign",
      description:
        "Explicitly pick up a GitHub issue or privately review a PR. Use the exact identity from github_inbox. Reuse the original instructions on retry.",
      input: Schema.Struct({
        ...InboxTarget.fields,
        instructions: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
      }),
      output: IssueId,
      run: (a, s) => c.inbox.assign(a, s, a.instructions),
    }),
  ];
}
