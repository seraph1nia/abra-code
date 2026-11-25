import { DiagramResources } from "./diagram-resources.tsx";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorBoundary } from "./workspace-error.tsx";
import { router } from "./router.tsx";
import { RegistryProvider } from "@effect/atom-react";
import { WorkspaceToaster } from "./notifications.tsx";
import { ThemeProvider } from "./theme.tsx";
import "./theme.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <WorkspaceToaster />
        <RegistryProvider>
          <DiagramResources>
            <RouterProvider router={router} />
          </DiagramResources>
        </RegistryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
