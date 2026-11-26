import { useContext } from "react";
import { selectionLabel } from "@abracode/contracts/web/resources";
import { Button } from "@abracode/presentation/ui/button";
import { snippetDraft } from "../workspace-commands.ts";
import { type DraftAttachment } from "../workspace-state/draft.ts";

import { WorkspaceActions } from "../workspace-actions.ts";
export function AskAbra({
  selection,
  excerpt,
  disabled,
}: DraftAttachment & { disabled?: boolean }) {
  const { prepare: insert, attach } = useContext(WorkspaceActions);
  return (
    <div className="selection-action">
      {!disabled && (
        <small>
          {selection.issue_id} · {selectionLabel(selection)}
        </small>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => attach({ selection, excerpt })}
      >
        Ask Abra
      </Button>
      {insert && selection.kind !== "region" && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            insert(snippetDraft(excerpt, selection.issue_id + " · " + selectionLabel(selection)))
          }
        >
          Insert snippet in chat
        </Button>
      )}
    </div>
  );
}
