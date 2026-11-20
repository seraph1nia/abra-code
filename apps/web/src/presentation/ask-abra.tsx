import { useContext } from "react";
import { selectionLabel } from "@abracode/contracts/web/resources";
import { Button } from "@abracode/presentation/ui/button";
import { AttachSelection, type DraftAttachment } from "../workspace-state/draft.ts";

export function AskAbra({
  selection,
  excerpt,
  disabled,
}: DraftAttachment & { disabled?: boolean }) {
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
    </div>
  );
}
