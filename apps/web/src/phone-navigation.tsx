import { Link } from "@tanstack/react-router";
import { useLayoutEffect, type RefObject } from "react";
import { destinations, type CollectionState } from "./navigation.ts";

export default function PhoneNavigation({
  saved,
  more,
  shell,
}: {
  saved: Partial<Record<string, CollectionState>>;
  more: boolean;
  shell: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const element = shell.current?.ownerDocument.documentElement;
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
  return (
    <nav className="phone-navigation" aria-label="Workspace">
      {(["/", "/work", "/thoughts", "/more"] as const).map((to) => (
        <Link
          key={to}
          to={to}
          search={{ collection: saved[to] }}
          activeOptions={{ exact: true, includeSearch: false }}
          aria-current={to === "/more" && more ? "page" : undefined}
        >
          {destinations[to]}
        </Link>
      ))}
    </nav>
  );
}
