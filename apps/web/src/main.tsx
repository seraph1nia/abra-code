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
  <ThemeProvider>
    <RegistryProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </RegistryProvider>
  </ThemeProvider>,
);
