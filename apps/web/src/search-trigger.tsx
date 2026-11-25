import { createContext, useContext } from "react";
import { Search } from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";

export const OpenSearch = createContext<(origin: HTMLElement, source?: "memory") => void>(() => {});

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const open = useContext(OpenSearch);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Search"
      aria-haspopup="dialog"
      className={compact ? "search-trigger is-compact" : "search-trigger"}
      onClick={(event) => open(event.currentTarget)}
    >
      <Search aria-hidden="true" />
      <span className="search-trigger-label">Search</span>
      {!compact && (
        <kbd aria-hidden="true" className="search-kbd">
          {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
        </kbd>
      )}
    </Button>
  );
}
