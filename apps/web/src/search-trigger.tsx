import { createContext, useContext } from "react";
import { Button } from "@abracode/presentation/ui/button";

export const OpenSearch = createContext<(origin: HTMLElement) => void>(() => {});

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const open = useContext(OpenSearch);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Search"
      aria-haspopup="dialog"
      className="search-trigger"
      onClick={(event) => open(event.currentTarget)}
    >
      Search{" "}
      {!compact && (
        <kbd aria-hidden="true" className="text-xs text-muted-foreground">
          {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
        </kbd>
      )}
    </Button>
  );
}
