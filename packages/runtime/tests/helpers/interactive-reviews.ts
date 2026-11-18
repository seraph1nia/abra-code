import { Schema } from "effect";
import { ReviewDefinitionSchema } from "@abracode/contracts/web/reviews";
import { IssueId, RelativePath } from "../../src/identities.ts";
import { presentationHash } from "../../src/presentation/identity.ts";

export const previewPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
export function reviewDefinition() {
  return Schema.decodeSync(ReviewDefinitionSchema)({
    review_id: "plan-feedback",
    title: "Choose the first release",
    source: {
      kind: "plan",
      issue_id: IssueId.make("abra-web"),
      path: RelativePath.make("proposal.md"),
      generation: 0,
      hash: presentationHash("Plan"),
    },
    fields: [
      {
        component: "SingleSelect",
        id: "direction",
        label: "Direction",
        required: true,
        options: [
          { value: "simple", label: "Simple" },
          { value: "complete", label: "Complete" },
        ],
      },
      {
        component: "MultiSelect",
        id: "features",
        label: "Features",
        options: [
          { value: "email", label: "Email login" },
          { value: "reset", label: "Password reset" },
        ],
      },
      { component: "CommentField", id: "comments", label: "Comments" },
    ],
  });
}
