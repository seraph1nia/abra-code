import { useEffect, useLayoutEffect, useRef } from "react";
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
  function rememberPosition() {
    const container = scroller.current;
    if (!container || nearBottom.current) return;
    const top = container.getBoundingClientRect().top;
    const element = [...container.querySelectorAll<HTMLElement>("[data-native-message-id]")].find(
      (element) => element.getBoundingClientRect().bottom > top,
    );
    if (element)
      viewAnchor.current = { element, offset: element.getBoundingClientRect().top - top };
  }
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nearBottom.current && !historyAnchor.current)
      bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.at(-1)?.id, messages.at(-1)?.text.length]);
  useEffect(() => {
    if (!transcript.current) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current && !historyAnchor.current)
        bottom.current?.scrollIntoView({ block: "end" });
    });
    observer.observe(transcript.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const container = scroller.current,
      anchor = viewAnchor.current;
    if (container && anchor?.element.isConnected)
      container.scrollTop +=
        anchor.element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        anchor.offset;
    viewAnchor.current = undefined;
  }, [layoutKey]);
  useLayoutEffect(() => {
    const container = scroller.current,
      anchor = historyAnchor.current;
    if (container && anchor && !loadingHistory) {
      container.scrollTop = anchor.top + container.scrollHeight - anchor.height;
      historyAnchor.current = undefined;
    }
  }, [messages[0]?.id, loadingHistory]);
  const onScroll = () => {
    const element = scroller.current;
    if (element)
      nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };
  const beforeHistory = () => {
    if (scroller.current)
      historyAnchor.current = {
        height: scroller.current.scrollHeight,
        top: scroller.current.scrollTop,
      };
  };
  return { scroller, transcript, bottom, onScroll, beforeHistory, rememberPosition };
}
