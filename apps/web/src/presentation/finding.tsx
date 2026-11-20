import { Schema } from "effect";
import { ResourcePathSchema, type ResourceSelection } from "@abracode/contracts/web/resources";
import { retainedFinding } from "@abracode/contracts/workflow/feedback-contracts";
import { FindingCard, type Inspect } from "@abracode/presentation/cards";
import { Button } from "@abracode/presentation/ui/button";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";

export function SelectedFinding({
  target,
  inspect,
}: {
  target: Extract<ResourceSelection, { action: "open_finding" }>;
  inspect: Inspect;
}) {
  return (
    <RequestState query={queries.feedback(target.issue_id, 0, target.finding_id, target.revision)}>
      {(page) => {
        const finding =
          page.issue_id === target.issue_id &&
          retainedFinding(page, target.finding_id, target.revision);
        if (!finding) return <output>This finding revision is unavailable for this task.</output>;
        const path = Schema.decodeUnknownOption(ResourcePathSchema)(finding.path);
        const head = finding.original_head ?? finding.head;
        return (
          <FindingCard issue={target.issue_id} finding={finding}>
            <small>Revision {finding.revision}</small>
            {path._tag === "Some" ? (
              <RequestState query={queries.diff(target.issue_id, "", "all")}>
                {(diff) =>
                  diff.head === head && diff.files.some((entry) => entry.path === path.value) ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        inspect({
                          action: "open_changes",
                          issue_id: target.issue_id,
                          head,
                          file: path.value,
                        })
                      }
                    >
                      Open {path.value} in diff
                    </Button>
                  ) : (
                    <p>No matching changed file at the reported revision.</p>
                  )
                }
              </RequestState>
            ) : (
              <p>No attributable changed file was reported.</p>
            )}
          </FindingCard>
        );
      }}
    </RequestState>
  );
}
