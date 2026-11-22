import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DesktopSplit = lazy(() => import("./desktop-split.tsx"));

/** One stable host keeps the native form, transcript and composer mounted while panels move. */
export function ReaderSplit({
  chat,
  reader,
  split,
  showChat,
}: {
  chat: ReactNode;
  reader: ReactNode;
  split: boolean;
  showChat: boolean;
}) {
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = "chat-host";
    return node;
  });
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) {
        element.append(host);
      }
    },
    [host],
  );
  const placement = <div className="chat-placement" ref={mount} />;
  return (
    <>
      {createPortal(chat, host)}
      <div className="conversation-panes" hidden={!showChat}>
        {split ? (
          <Suspense fallback={placement}>
            <DesktopSplit chat={placement} reader={reader} />
          </Suspense>
        ) : (
          placement
        )}
      </div>
      {!split && reader}
    </>
  );
}
