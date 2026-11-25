import { useId, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { Markdown } from "../markdown.tsx";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { orderedParts } from "@abracode/contracts/web/transcript";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { SessionCard, type Inspect } from "@abracode/presentation/cards";
import { SectionCard } from "@abracode/presentation/cockpit";
import { ToolObservation } from "./tools.tsx";

export function SessionsPanel({ work, inspect }: { work: WebWorkItem; inspect: Inspect }) {
  const route = useSearch({ from: "__root__" });
  const [page, setPage] = useState(0);
  const selectId = useId();
  const target = route.resource?.action === "open_session" ? route.resource.session_id : undefined;
  const selected =
    target ??
    work.sessions.find((session) => session.role === work.active_role)?.id ??
    work.sessions.at(-1)?.id;
  if (!work.sessions.length && !target)
    return <p className="muted">No worker sessions retained.</p>;
  return (
    <div className="inspector-stack">
      <p className="muted">
        Worker inspection is read-only. Give instructions to Abra in the main conversation.
      </p>
      <div className="inspector-stack" aria-label="Retained worker sessions">
        {work.sessions.slice(page * 8, (page + 1) * 8).map((session) => (
          <RequestState key={session.id} query={queries.worker(work.issue_id, session.id)}>
            {(observation) => (
              <SessionCard session={observation} issue={work.issue_id} inspect={inspect} />
            )}
          </RequestState>
        ))}
      </div>
      {work.sessions.length > 8 && (
        <nav aria-label="Worker summary pages" className="button-row">
          <Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>
            Previous sessions
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={(page + 1) * 8 >= work.sessions.length}
            onClick={() => setPage(page + 1)}
          >
            Next sessions
          </Button>
        </nav>
      )}
      {selected && (
        <SectionCard
          title="Worker transcript"
          actions={
            <div className="session-select-inline">
              <label htmlFor={selectId} className="sr-only">
                Read-only worker session
              </label>
              <NativeSelect
                id={selectId}
                size="sm"
                value={selected}
                onChange={(event) => {
                  const session = work.sessions.find((s) => s.id === event.target.value);
                  if (session)
                    inspect({
                      action: "open_session",
                      issue_id: work.issue_id,
                      session_id: session.id,
                    });
                }}
              >
                {target && !work.sessions.some((s) => s.id === target) && (
                  <option value={target}>Retained session · {target}</option>
                )}
                {work.sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.role} · {session.id}
                  </option>
                ))}
              </NativeSelect>
            </div>
          }
        >
          <WorkerTranscript key={selected} work={work} session={selected} inspect={inspect} />
        </SectionCard>
      )}
    </div>
  );
}

function WorkerTranscript({
  work,
  session,
  inspect,
}: {
  work: WebWorkItem;
  session: string;
  inspect: Inspect;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  return (
    <section aria-label="Read-only worker transcript" className="inspector-stack">
      <RequestState query={queries.workerHistory(work.issue_id, session, cursors.at(-1))}>
        {(page) => (
          <>
            <p className="muted">
              Observed {new Date(page.observed_at).toLocaleString()} · Bounded native message page
            </p>
            {!page.messages.length && (
              <p className="muted">
                No visible messages in this native page. Earlier messages may still be available.
              </p>
            )}
            {page.messages.map((message) => (
              <article
                key={message.id}
                className="worker-message"
                data-worker-message-id={message.id}
              >
                <header>
                  <strong>
                    {message.role === "assistant"
                      ? "Worker"
                      : message.role === "user"
                        ? "Assignment or follow-up"
                        : "Native notice"}
                  </strong>{" "}
                  <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time>
                </header>
                {orderedParts(message).map((part, index) =>
                  part.type === "text" ? (
                    <Markdown key={index} content={part.text} mode="static" className="prose" />
                  ) : (
                    (() => {
                      const tool = message.tools?.find((tool) => tool.id === part.tool_id);
                      return tool ? (
                        <ToolObservation
                          key={tool.id}
                          messageID={message.id}
                          tool={tool}
                          inspect={inspect}
                          work={[work]}
                          attachments={[]}
                        />
                      ) : null;
                    })()
                  ),
                )}
                {message.limited && (
                  <output className="muted">
                    This message contains bounded excerpts. Omitted content is not reconstructed.
                  </output>
                )}
              </article>
            ))}
            <nav aria-label="Worker transcript pages" className="button-row">
              <Button
                variant="outline"
                size="sm"
                disabled={!page.older}
                onClick={() => {
                  if (page.older) setCursors([...cursors, page.older]);
                }}
              >
                Earlier worker messages
              </Button>
              {cursors.length > 1 && (
                <Button variant="outline" size="sm" onClick={() => setCursors([undefined])}>
                  Latest worker messages
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length <= 1}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                Newer worker messages
              </Button>
            </nav>
          </>
        )}
      </RequestState>
    </section>
  );
}
