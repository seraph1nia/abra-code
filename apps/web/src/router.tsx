import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
} from "@tanstack/react-router";
import { WorkspaceShell } from "./workspace-shell.tsx";
import { workspaceSearch } from "./navigation.ts";

const rootRoute = createRootRoute({ component: WorkspaceShell });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: workspaceSearch,
  component: () => null,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./settings.tsx"), "Settings"),
});
const agentSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./settings.tsx"), "AgentSettings"),
});
const repositorySettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "repositories",
  component: lazyRouteComponent(() => import("./settings.tsx"), "RepositorySettings"),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    workspaceRoute,
    settingsRoute.addChildren([agentSettingsRoute, repositorySettingsRoute]),
  ]),
  defaultNotFoundComponent: () => (
    <main className="loading">
      <h1>Page not found</h1>
      <Link to="/">Return to AbraCode</Link>
    </main>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
