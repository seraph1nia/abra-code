import { Link } from "@tanstack/react-router";
import { useLayoutEffect, type RefObject } from "react";
import { resourceFromSearch, type WorkspaceSearch } from "./navigation.ts";

export default function PhoneNavigation({
  route,
  settings,
  shell,
}: {
  route: WorkspaceSearch;
  settings: boolean;
  shell: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const element = shell.current;
    if (!viewport || !element) return;
    const fit = () => {
      // Pinch zoom retains the browser's native panning and layout.
      if (viewport.scale === 1) {
        element.style.setProperty("--phone-height", viewport.height + "px");
        element.style.setProperty("--phone-top", viewport.offsetTop + "px");
      } else {
        element.style.removeProperty("--phone-height");
        element.style.removeProperty("--phone-top");
      }
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      element.style.removeProperty("--phone-height");
      element.style.removeProperty("--phone-top");
    };
  }, [shell]);
  const canvas = Boolean(route.surface || resourceFromSearch(route) || route.view);
  return (
    <nav className="phone-navigation" aria-label="Workspace">
      <Link
        to="/"
        search={{}}
        aria-current={!settings && !canvas ? "page" : undefined}
        activeOptions={{ exact: true }}
      >
        Chat
      </Link>
      <Link
        to="/"
        search={canvas ? route : { view: "canvas" }}
        aria-current={canvas ? "page" : undefined}
        activeOptions={{ exact: true }}
      >
        Canvas
      </Link>
      <Link to="/settings">Settings</Link>
    </nav>
  );
}
