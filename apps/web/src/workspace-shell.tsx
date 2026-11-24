import { RunCommand, type ComposerCommand } from "./workspace-commands.ts";
import { OpenSearch } from "./search-trigger.tsx";
import { Palette } from "./palette-loader.tsx";
import {
  Outlet,
  Link,
  useRouter,
  useRouterState,
  useSearch,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application } from "./workspace.tsx";
import {
  destinations,
  workspaceSearch,
  destinationFor,
  type CollectionState,
} from "./navigation.ts";
import { SearchTrigger } from "./search-trigger.tsx";
import PhoneNavigation from "./phone-navigation.tsx";
import { useMediaQuery } from "./use-media-query.ts";

export function WorkspaceShell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const destination = destinationFor(path);
  const workspace = Boolean(destination);
  const raw = useSearch({ from: "__root__" });
  const route = useMemo(() => workspaceSearch(raw), [raw]);
  const router = useRouter();
  const [savedByDestination, setSavedByDestination] = useState<
    Partial<Record<string, CollectionState>>
  >(() => (destination ? { [destination]: route.collection } : {}));
  const [visited, setVisited] = useState(workspace);
  useEffect(
    () =>
      router.subscribe("onResolved", ({ fromLocation, toLocation }) => {
        const updates: [string, CollectionState | undefined][] = [];
        for (const location of [fromLocation, toLocation]) {
          if (!location) continue;
          const target = destinationFor(location.pathname);
          if (target)
            updates.push([
              target,
              workspaceSearch(location.search as Record<string, unknown>).collection,
            ]);
        }
        if (toLocation && destinationFor(toLocation.pathname)) setVisited(true);
        if (!updates.length) return;
        setSavedByDestination((previous) => {
          let changed = false;
          const next = { ...previous };
          for (const [target, collection] of updates) {
            if (JSON.stringify(previous[target]) !== JSON.stringify(collection)) {
              next[target] = collection;
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      }),
    [router],
  );
  const saved = useMemo(
    () =>
      destination ? { ...savedByDestination, [destination]: route.collection } : savedByDestination,
    [savedByDestination, destination, route.collection],
  );
  const hasWorkspace = workspace || visited;
  const tablet = useMediaQuery("(max-width: 1250px)");
  const settings = useMatch({ from: "/settings", shouldThrow: false });
  const phone = useMediaQuery("(max-width: 760px)");
  const shell = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const [search, setSearch] = useState<{ origin: HTMLElement; source?: "memory" }>();
  const origin = search?.origin;
  const openSearch = useCallback(
    (origin: HTMLElement, source?: "memory") => setSearch({ origin, source }),
    [],
  );
  const [command, setCommand] = useState<{ action: ComposerCommand }>();
  const consumed = useCallback(() => setCommand(undefined), []);
  const [focusChat, setFocusChat] = useState(false);

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
      if (
        document.querySelector(
          'dialog[open], [role="dialog"]:not(.inspector-sheet), [role="alertdialog"]',
        )
      )
        return;
      event.preventDefault();
      if (!event.repeat && document.activeElement instanceof HTMLElement)
        openSearch(document.activeElement);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [origin, openSearch]);
  const palette = origin
    ? {
        origin,
        initialSource: search.source,
        close: () => setSearch(undefined),
        chat: () => {
          setFocusChat(true);
          void navigate({ to: "/", search: {} });
        },
        finder: (query?: string) => {
          void navigate({
            to: "/work",
            search: query
              ? { collection: { work: { search: query, state: "all" } } }
              : { collection: saved["/work"] },
          });
        },
      }
    : undefined;
  const links = (Object.entries(destinations) as [keyof typeof destinations, string][])
    .filter(([to]) => to !== "/more")
    .map(([to, label]) => (
      <Link
        key={to}
        to={to}
        search={{ collection: saved[to] }}
        activeOptions={{ exact: true, includeSearch: false }}
      >
        {label}
      </Link>
    ));
  const navigation = (
    <>
      {links}
      <Link to="/settings">Settings</Link>
    </>
  );
  return (
    <RunCommand.Provider
      value={(action) => {
        setCommand({ action });
        if (
          workspace &&
          !tablet &&
          (route.issue || route.surface || route.review || route.retained) &&
          !route.canvas
        )
          return;
        void navigate({ to: "/", search: {} });
      }}
    >
      <OpenSearch.Provider value={openSearch}>
        <div className="workspace-shell" ref={shell}>
          {(workspace || settings) &&
            (phone ? (
              <>
                <header className="phone-tools">
                  <SearchTrigger />
                  <Link to="/attention">Attention</Link>
                </header>
                <PhoneNavigation
                  shell={shell}
                  saved={saved}
                  more={Boolean(settings || destination === "/github")}
                />
              </>
            ) : tablet ? (
              <details key={path} className="destination-menu">
                <summary>Destinations</summary>
                <nav aria-label="Workspace">{navigation}</nav>
              </details>
            ) : (
              <nav className="destination-rail" aria-label="Workspace">
                <SearchTrigger />
                {navigation}
              </nav>
            ))}
          {hasWorkspace && (
            <div className="workspace-host" hidden={!workspace}>
              <Application
                route={route}
                active={Boolean(workspace)}
                phone={phone}
                palette={palette}
                command={command}
                consumed={consumed}
                destination={destination ?? "/"}
                focusChat={focusChat}
                didFocus={didFocus}
              />
            </div>
          )}
          {!hasWorkspace && palette && <Palette {...palette} />}
          <Outlet />
        </div>
      </OpenSearch.Provider>
    </RunCommand.Provider>
  );
}
