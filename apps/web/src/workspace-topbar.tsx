import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Expand, Minimize2, PanelRight } from "@abracode/presentation/icons";
import { SearchTrigger } from "./search-trigger.tsx";
import { destinations, type Destination, type WorkspaceSearch } from "./navigation.ts";

export function WorkspaceTopbar({
  destination,
  busy,
  connectionError,
  wide,
  activeWorkCount,
  totalAttention,
  desktopCanvasOpen,
  desktopExpanded,
  showExpand,
  lastInspection,
  setExpanded,
}: {
  destination: Destination;
  busy: boolean;
  connectionError: string;
  wide: boolean;
  activeWorkCount: number;
  totalAttention: number;
  desktopCanvasOpen: boolean;
  desktopExpanded: boolean;
  showExpand: boolean;
  lastInspection?: WorkspaceSearch;
  setExpanded: (expanded: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" search={{}} className="brand-home-link" onClick={() => setExpanded(false)}>
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          <span className="brand-name">AbraCode</span>
        </Link>
        <span className="topbar-sep" aria-hidden="true" />
        <h1 className="topbar-heading">{destinations[destination]}</h1>
        {connectionError || busy ? (
          <output
            className={connectionError ? "telemetry-pill is-warning" : "telemetry-pill is-running"}
          >
            <span className="telemetry-dot" aria-hidden="true" />
            {connectionError ? "Reconnecting" : "Abra is working"}
          </output>
        ) : (
          <span className="telemetry-pill is-ready" aria-hidden="true">
            <span className="telemetry-dot" />
            Connected
          </span>
        )}
      </div>
      <div className="topbar-center">
        <SearchTrigger />
      </div>
      <div className="topbar-end">
        {wide && (
          <>
            <Link
              to="/work"
              search={{ collection: { section: "capacity" } }}
              className="telemetry-pill is-interactive"
              onClick={() => setExpanded(false)}
            >
              <span className="telemetry-dot" aria-hidden="true" />
              <span>
                {activeWorkCount} active {activeWorkCount === 1 ? "task" : "tasks"}
              </span>
            </Link>
            {totalAttention > 0 && (
              <Link
                to="/attention"
                search={{}}
                className="telemetry-pill is-attention is-interactive"
                onClick={() => setExpanded(false)}
              >
                <Bell aria-hidden="true" />
                <span>{totalAttention} pending</span>
              </Link>
            )}
            <fieldset className="layout-mode-group" aria-label="Workspace layout">
              <button
                type="button"
                className={!desktopCanvasOpen ? "layout-mode-btn is-active" : "layout-mode-btn"}
                onClick={() => {
                  setExpanded(false);
                  void navigate({ to: "/", search: {} });
                }}
              >
                Chat
              </button>
              <button
                type="button"
                className={
                  desktopCanvasOpen && !desktopExpanded
                    ? "layout-mode-btn is-active"
                    : "layout-mode-btn"
                }
                onClick={() => {
                  setExpanded(false);
                  if (!desktopCanvasOpen) {
                    if (lastInspection) void navigate({ to: "/", search: lastInspection });
                    else void navigate({ to: "/work", search: {} });
                  }
                }}
              >
                <PanelRight aria-hidden="true" />
                Split
              </button>
              {showExpand && (
                <button
                  type="button"
                  className={desktopExpanded ? "layout-mode-btn is-active" : "layout-mode-btn"}
                  aria-label={desktopExpanded ? "Show chat beside canvas" : "Expand canvas"}
                  onClick={() => setExpanded(!desktopExpanded)}
                >
                  {desktopExpanded ? (
                    <Minimize2 aria-hidden="true" />
                  ) : (
                    <Expand aria-hidden="true" />
                  )}
                </button>
              )}
            </fieldset>
          </>
        )}
      </div>
    </header>
  );
}
