import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
export function useTranscriptViewport(
  messages: readonly TranscriptMessage[],
  loadingHistory: boolean,
  layoutKey: string,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const historyAnchor = useRef<{ height: number; top: number } | undefined>(undefined);
  const viewAnchor = useRef<{ element: HTMLElement; offset: number } | undefined>(undefined);
  const rememberPosition = useCallback(() => {
    const container = scroller.current;
    if (!container?.clientHeight) return;
    // Read actual geometry: a programmatic/browser scroll can precede onScroll delivery.
    nearBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (nearBottom.current) return;
    if (viewAnchor.current?.element.isConnected) return;
    const top = container.getBoundingClientRect().top;
    const element = [...container.querySelectorAll<HTMLElement>("[data-native-message-id]")].find(
      (element) => element.getBoundingClientRect().bottom > top,
    );
    if (element)
      viewAnchor.current = { element, offset: element.getBoundingClientRect().top - top };
  }, []);
  function restorePosition() {
    const container = scroller.current,
      anchor = viewAnchor.current;
    if (container?.clientHeight && anchor?.element.isConnected && !historyAnchor.current)
      container.scrollTop +=
        anchor.element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        anchor.offset;
  }
  const bottom = useRef<HTMLDivElement>(null);
  const lastID = messages.at(-1)?.id;
  const lastTextLength = messages.at(-1)?.text.length;
  const firstID = messages[0]?.id;
  useEffect(() => {
    if (nearBottom.current && !historyAnchor.current)
      bottom.current?.scrollIntoView({ block: "end" });
  }, [lastID, lastTextLength]);
  useEffect(() => {
    if (!transcript.current) return;
    const observer = new ResizeObserver(() => {
      restorePosition();
      if (nearBottom.current && !historyAnchor.current)
        bottom.current?.scrollIntoView({ block: "end" });
    });
    observer.observe(transcript.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    restorePosition();
  }, [layoutKey]);
  useLayoutEffect(() => {
    const container = scroller.current,
      anchor = historyAnchor.current;
    if (container && anchor && !loadingHistory) {
      container.scrollTop = anchor.top + container.scrollHeight - anchor.height;
      historyAnchor.current = undefined;
    }
  }, [firstID, loadingHistory]);
  const onScroll = () => {
    const element = scroller.current;
    if (element?.clientHeight)
      nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };
  const beforeHistory = () => {
    viewAnchor.current = undefined;
    if (scroller.current)
      historyAnchor.current = {
        height: scroller.current.scrollHeight,
        top: scroller.current.scrollTop,
      };
  };
  const onReadingIntent = () => {
    viewAnchor.current = undefined;
  };
  return {
    scroller,
    transcript,
    bottom,
    onScroll,
    beforeHistory,
    rememberPosition,
    onReadingIntent,
  };
}
