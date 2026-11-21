import { DiagramResources } from "./diagram-resources.tsx";
/* oxlint-disable effecttsgo/unstable-api-usage -- Registry lifetime is scoped to the browser application. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.tsx";
import { RegistryProvider } from "@effect/atom-react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "./theme.tsx";
import "./theme.css";
import "./style.css";

function WorkspaceToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-right"
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 52px)" }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <WorkspaceToaster />
      <RegistryProvider>
        <DiagramResources>
          <RouterProvider router={router} />
        </DiagramResources>
      </RegistryProvider>
    </ThemeProvider>
  </StrictMode>,
);
