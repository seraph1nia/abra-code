import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { Application } from "./workspace.tsx";
import { workspaceSearch } from "./navigation.ts";

const rootRoute = createRootRoute({ component: Outlet });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: workspaceSearch,
  component: Application,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./settings.tsx"), "Settings"),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute, settingsRoute]),
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
