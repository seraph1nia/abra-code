import type { ReactNode } from "react";
import { Button } from "@abracode/presentation/ui/button";

export function PaginationBar({
  label,
  previous,
  next,
  previousLabel = "Previous",
  nextLabel = "Next",
  children,
}: {
  label: string;
  previous?: () => void;
  next?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  children?: ReactNode;
}) {
  return (
    <nav aria-label={label} className="finder-pagination">
      <Button variant="outline" size="sm" disabled={!previous} onClick={previous}>
        {previousLabel}
      </Button>
      {children}
      <Button variant="outline" size="sm" disabled={!next} onClick={next}>
        {nextLabel}
      </Button>
    </nav>
  );
}
