import { Outlet, useMatch } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
  return (
    <div className="workspace-shell" ref={shell}>
      {phone && (workspace || settings) && (
        <PhoneNavigation shell={shell} route={route} settings={Boolean(settings)} />
      )}
      {(workspace || visited) && (
        <div className="workspace-host" hidden={!workspace}>
          <Application route={route} active={Boolean(workspace)} phone={phone} />
        </div>
      )}
      <Outlet />
    </div>
  );
}
