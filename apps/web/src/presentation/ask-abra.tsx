import { useContext } from "react";
import { selectionLabel } from "@abracode/contracts/web/resources";
import { Button } from "@abracode/presentation/ui/button";
import { snippetDraft } from "../workspace-commands.ts";
import {
  PrepareSurfaceMessage,
  AttachSelection,
  type DraftAttachment,
} from "../workspace-state/draft.ts";

export function AskAbra({
  selection,
  excerpt,
  disabled,
}: DraftAttachment & { disabled?: boolean }) {
  const insert = useContext(PrepareSurfaceMessage);
  const attach = useContext(AttachSelection);
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
