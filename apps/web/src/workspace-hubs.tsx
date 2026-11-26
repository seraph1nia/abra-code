import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { deferred } from "@abracode/presentation/deferred";
import { AttentionPanel } from "./attention-panel-loader.tsx";
import { RecentlyInspected } from "./recently-inspected.tsx";
import type { Destination, WorkspaceSearch } from "./navigation.ts";
import type { ThoughtReference } from "@abracode/contracts/visibility/thoughts";

const WorkFinder = deferred<ComponentProps<typeof import("./work-finder.tsx").WorkFinder>>(
  () => import("./work-finder.tsx").then((module) => ({ default: module.WorkFinder })),
  "Work finder",
  "deferred-panel",
  ({ shown }) => shown,
);
const GithubInbox = deferred<ComponentProps<typeof import("./github-inbox.tsx").GithubInbox>>(
  () => import("./github-inbox.tsx").then((m) => ({ default: m.GithubInbox })),
  "GitHub inbox",
);
const Thoughts = deferred<ComponentProps<typeof import("./thoughts.tsx").Thoughts>>(
  () => import("./thoughts.tsx").then((m) => ({ default: m.Thoughts })),
  "Personal thoughts",
);

export function WorkspaceHubs({
  destination,
  collectionVisible,
  route,
  historyWritable,
  ask,
  discuss,
  ...attentionProps
}: ComponentProps<typeof AttentionPanel> & {
  destination: Destination;
  collectionVisible: boolean;
  route: WorkspaceSearch;
  historyWritable: boolean;
  ask: (text: string) => void;
  discuss: (thought: ThoughtReference) => void;
}) {
  const { workspace, open, inspect, attentionOpen, attention, workAttention } = attentionProps;
  return (
    <div className="canvas-hub-host" hidden={!collectionVisible}>
      <section
        data-scroll-restoration-id={"collection-" + destination}
        className="collection-page"
        hidden={!collectionVisible || attentionOpen}
      >
        {destination === "/work" && (
          <WorkFinder
            shown={collectionVisible}
            workspace={workspace}
            open={open}
            inspect={inspect}
          />
        )}
        {destination === "/github" && collectionVisible && (
          <GithubInbox projects={workspace.projects} open={open} ask={ask} />
        )}
        {destination === "/thoughts" && collectionVisible && <Thoughts discuss={discuss} />}
        {destination === "/more" && (
          <nav aria-label="More destinations" className="more-nav">
            <Link to="/github">GitHub</Link>
            <Link to="/settings">Settings</Link>
          </nav>
        )}
        {collectionVisible && destination === "/work" && route.collection?.section === "recent" && (
          <RecentlyInspected
            writable={historyWritable}
            session={workspace.session_id}
            work={workspace.work.work}
            open={open}
          />
        )}
      </section>
      <div className="collection-page" hidden={!attentionOpen}>
        {!(attention + workAttention.length + (workspace.work.management?.entries.length ?? 0)) && (
          <div className="empty-attention">
            <h2>Attention</h2>
            <p className="muted">No pending attention in the observed workspace.</p>
          </div>
        )}
        {(attentionOpen || workspace.forms.length > 0 || workspace.permissions.length > 0) && (
          <AttentionPanel
            workspace={workspace}
            workAttention={workAttention}
            attention={attention}
            attentionOpen={attentionOpen}
            refresh={attentionProps.refresh}
            open={open}
            inspect={inspect}
          />
        )}
      </div>
    </div>
  );
}
