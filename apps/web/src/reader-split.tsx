import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DesktopSplit = lazy(() => import("./desktop-split.tsx"));

/** Stable hosts keep the transcript, composer and Canvas hubs mounted while panels move. */
export function ReaderSplit({
  chat,
  reader,
  split,
  showChat,
  focusMode = false,
}: {
  chat: ReactNode;
  reader: ReactNode;
  split: boolean;
  showChat: boolean;
  focusMode?: boolean;
}) {
  const [chatHost] = useState(() => {
    const node = document.createElement("div");
    node.className = "chat-host";
    return node;
  });
  const [readerHost] = useState(() => {
    const node = document.createElement("div");
    node.className = "reader-host";
    return node;
  });
  const mountChat = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) element.append(chatHost);
    },
    [chatHost],
  );
  const mountReader = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) element.append(readerHost);
    },
    [readerHost],
  );
  const chatPlacement = <div className="chat-placement" ref={mountChat} />;
  const readerPlacement = <div className="reader-placement" ref={mountReader} />;
  return (
    <>
      {createPortal(chat, chatHost)}
      {createPortal(reader, readerHost)}
      <div
        className={focusMode ? "conversation-panes is-focus" : "conversation-panes"}
        hidden={!showChat}
      >
        {split ? (
          <Suspense
            fallback={
              <div className="split-fallback">
                {chatPlacement}
                {readerPlacement}
              </div>
            }
          >
            <DesktopSplit chat={chatPlacement} reader={readerPlacement} />
          </Suspense>
        ) : (
          chatPlacement
        )}
      </div>
      {!split && readerPlacement}
    </>
  );
}
