import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
} from "@tanstack/react-router";
import { WorkspaceShell } from "./workspace-shell.tsx";
import { workspaceSearch } from "./navigation.ts";

const rootRoute = createRootRoute({ component: WorkspaceShell, validateSearch: workspaceSearch });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});
function collectionRoute<
  const P extends "/work" | "/github" | "/thoughts" | "/attention" | "/more",
>(path: P) {
  return createRoute({ getParentRoute: () => rootRoute, path, component: () => null });
}
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
const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "appearance",
  component: lazyRouteComponent(() => import("./settings.tsx"), "AppearanceSettings"),
});
const aboutRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "about",
  component: lazyRouteComponent(() => import("./settings.tsx"), "AboutSettings"),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    workspaceRoute,
    collectionRoute("/work"),
    collectionRoute("/github"),
    collectionRoute("/thoughts"),
    collectionRoute("/attention"),
    collectionRoute("/more"),

    settingsRoute.addChildren([
      agentSettingsRoute,
      repositorySettingsRoute,
      appearanceRoute,
      aboutRoute,
    ]),
  ]),
  scrollRestoration: true,
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
