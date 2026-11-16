import { DiagramLoaderContext } from "@abracode/presentation/diagrams";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { Schema } from "effect";
const loadDiagrams = async (
  selection: import("@abracode/contracts/web/diagram-actions").PrepareDiagramSelection,
  signal: AbortSignal,
) => {
  const response = await fetch("/api/diagrams/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
    signal,
  });
  if (!response.ok) throw new Error("Diagram preparation unavailable");
  return Schema.decodeUnknownSync(DiagramPreparationSchema)(await response.json());
};
/* oxlint-disable effecttsgo/unstable-api-usage -- Registry lifetime is scoped to the browser application. */
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.tsx";
import { RegistryProvider } from "@effect/atom-react";
import { TooltipProvider } from "@abracode/presentation/ui/tooltip";
import { ThemeProvider } from "./theme.tsx";
import "./theme.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <DiagramLoaderContext.Provider value={loadDiagrams}>
    <ThemeProvider>
      <RegistryProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </RegistryProvider>
    </ThemeProvider>
  </DiagramLoaderContext.Provider>,
);
