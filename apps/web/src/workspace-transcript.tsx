import { useContext, useMemo, useState, type ComponentProps } from "react";
import { Button } from "@abracode/presentation/ui/button";
import { deferred } from "@abracode/presentation/deferred";
import type { useWorkspace } from "./use-workspace.ts";
import type { useTranscriptViewport } from "./workspace-state/viewport.ts";
import type { Inspect } from "@abracode/presentation/cards";
import { groupByMessage, unattachedSurfaces } from "./workspace-state/use-transcript-scroll.ts";
import { RunCommand, composerCommands } from "./workspace-commands.ts";
import { TranscriptData } from "./presentation/tool-context.ts";
import { MessageContent, emptyAttachments, emptyDiagnostics } from "./message-content.tsx";
const RetainedSurfaces = deferred<
  ComponentProps<typeof import("./presentation/attachments.tsx").RetainedSurfaces>
>(
  () =>
    import("./presentation/attachments.tsx").then((module) => ({
      default: module.RetainedSurfaces,
    })),
  "Retained presentation",
);

export function WorkspaceTranscript({
  view,
  viewport,
  inspect,
}: {
  view: ReturnType<typeof useWorkspace>;
  viewport: ReturnType<typeof useTranscriptViewport>;
  inspect: Inspect;
}) {
  const { workspace, presentations, messages, hasHistory, loadingHistory, loadHistory } = view;
  const { scroller, transcript, bottom } = viewport;
  const [retainedViews, setRetainedViews] = useState(false);
  const runCommand = useContext(RunCommand);
  const transcriptData = useMemo(
    () => ({ work: workspace.work.work, forms: workspace.forms }),
    [workspace.work.work, workspace.forms],
  );
  const otherViews = unattachedSurfaces(workspace.surfaces, presentations.entries, messages);
  const attachmentIndex = useMemo(
    () => groupByMessage(presentations.entries),
    [presentations.entries],
  );
  const thoughtReceipts = useMemo(
    () =>
      new Map(workspace.receipts.filter((r) => r.thought).map((r) => [String(r.message_id), r])),
    [workspace.receipts],
  );
  const diagnosticIndex = useMemo(
    () => groupByMessage(presentations.diagnostics),
    [presentations.diagnostics],
  );
  return (
    <div
      className="conversation-scroll"
      ref={scroller}
      onScroll={viewport.onScroll}
      onWheel={viewport.onReadingIntent}
      onPointerDownCapture={viewport.onReadingIntent}
      onKeyDownCapture={viewport.onReadingIntent}
    >
      <div className="transcript" ref={transcript} role="log" aria-label="Conversation with Abra">
        {hasHistory && (
          <Button
            variant="ghost"
            className="load-history"
            disabled={loadingHistory}
            onClick={() => void loadHistory(viewport.beforeHistory)}
          >
            {loadingHistory ? "Loading…" : "Load earlier messages"}
          </Button>
        )}
        {!messages.length && (
          <section className="welcome">
            <span className="brand-mark welcome-mark" aria-hidden="true">
              a
            </span>
            <h2>Abra</h2>
            <p className="muted">
              Your persistent supervisor. Coordinate tasks, review plans and diffs, or open any hub
              in the Canvas beside this thread.
            </p>
            {!workspace.projects.length && (
              <div className="welcome-actions">
                <Button variant="outline" onClick={() => runCommand(composerCommands[0])}>
                  Add a project
                </Button>
              </div>
            )}
          </section>
        )}
        <TranscriptData.Provider value={transcriptData}>
          {messages.map((message) => (
            <MessageContent
              key={message.id}
              thoughtReceipt={thoughtReceipts.get(message.id)}
              message={message}
              inspect={inspect}
              attachments={attachmentIndex.get(message.id) ?? emptyAttachments}
              diagnostics={diagnosticIndex.get(message.id) ?? emptyDiagnostics}
            />
          ))}
        </TranscriptData.Provider>
        {presentations.truncated && (
          <output className="muted">
            Presentation references exceed this conversation page's coverage. Retained task reports
            remain available through inspection.
          </output>
        )}
        {otherViews.length > 0 && (
          <details
            className="retained-views"
            open={retainedViews}
            onToggle={(event) => setRetainedViews(event.currentTarget.open)}
          >
            <summary>Other retained views ({otherViews.length})</summary>
            <p className="muted">
              These layouts have no matching message in the loaded conversation.
            </p>
            {retainedViews && (
              <RetainedSurfaces entries={otherViews} work={workspace.work.work} inspect={inspect} />
            )}
          </details>
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}
