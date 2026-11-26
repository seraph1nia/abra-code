import { deferred } from "@abracode/presentation/deferred";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DesktopSplit = deferred(
  () => import("./desktop-split.tsx"),
  "Split view",
  undefined,
  undefined,
  ({ chat, reader }) => (
    <div className="split-fallback">
      {chat}
      {reader}
    </div>
  ),
);

function usePortalHost(className: string) {
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = className;
    return node;
  });
  const focused = useRef<HTMLElement | null>(null);
  const place = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && host.contains(active)) focused.current = active;
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && host.contains(active)) focused.current = active;
      element.append(host);
      if (
        focused.current &&
        host.contains(focused.current) &&
        document.activeElement === document.body
      )
        focused.current.focus({ preventScroll: true });
      focused.current = null;
    },
    [host],
  );
  return [host, place] as const;
}

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
  const [chatHost, mountChat] = usePortalHost("chat-host");
  const [readerHost, mountReader] = usePortalHost("reader-host");
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
        {split ? <DesktopSplit chat={chatPlacement} reader={readerPlacement} /> : chatPlacement}
      </div>
      {!split && readerPlacement}
    </>
  );
}
