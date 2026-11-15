import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { Application } from "./workspace.tsx";

const rootRoute = createRootRoute({ component: Outlet });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Application,
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute]),
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
