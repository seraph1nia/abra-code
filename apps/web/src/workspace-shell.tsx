import { OpenSearch } from "./search-trigger.tsx";
import { Palette } from "./palette-loader.tsx";
import { Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Application } from "./workspace.tsx";
import PhoneNavigation from "./phone-navigation.tsx";
import { useMediaQuery } from "./use-media-query.ts";

export function WorkspaceShell() {
  const workspace = useMatch({ from: "/", shouldThrow: false });
  const settings = useMatch({ from: "/settings", shouldThrow: false });
  const phone = useMediaQuery("(max-width: 760px)");
  const shell = useRef<HTMLDivElement>(null);
  const [visited, setVisited] = useState(Boolean(workspace));
  if (workspace && !visited) setVisited(true);
  const route = workspace?.search ?? {};
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const [focusChat, setFocusChat] = useState(false);
  const [finderSeed, setFinderSeed] = useState<{ query: string; sequence: number }>();
  const didFocus = useCallback(() => setFocusChat(false), []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      if (origin) {
        event.preventDefault();
        return;
      }
      if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (!event.repeat && document.activeElement instanceof HTMLElement)
        setOrigin(document.activeElement);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [origin]);
  const palette = origin
    ? {
        origin,
        close: () => setOrigin(null),
        chat: () => {
          setFocusChat(true);
          void navigate({ to: "/", search: {} });
        },
        finder: (query?: string) => {
          if (query)
            setFinderSeed((previous) => ({ query, sequence: (previous?.sequence ?? 0) + 1 }));
          void navigate({ to: "/", search: { view: "finder" } });
        },
      }
    : undefined;
  return (
    <OpenSearch.Provider value={setOrigin}>
      <div className="workspace-shell" ref={shell}>
        {phone && (workspace || settings) && (
          <PhoneNavigation shell={shell} route={route} settings={Boolean(settings)} />
        )}
        {(workspace || visited) && (
          <div className="workspace-host" hidden={!workspace}>
            <Application
              route={route}
              active={Boolean(workspace)}
              phone={phone}
              palette={palette}
              finderSeed={finderSeed}
              focusChat={focusChat}
              didFocus={didFocus}
            />
          </div>
        )}
        {!workspace && !visited && palette && <Palette {...palette} />}
        <Outlet />
      </div>
    </OpenSearch.Provider>
  );
}
