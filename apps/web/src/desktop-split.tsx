import { useEffect, useState, type ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  useGroupRef,
} from "@abracode/presentation/ui/resizable";

const preference = "abra-reader-percent";
let sessionWidth = 39;
function readWidth() {
  try {
    const value = Number(localStorage.getItem(preference));
    if (Number.isFinite(value) && value >= 30 && value <= 55) return value;
  } catch {
    return sessionWidth;
  }
  return 39;
}
export default function DesktopSplit({ chat, reader }: { chat: ReactNode; reader: ReactNode }) {
  const [width, setWidth] = useState(readWidth);
  const ref = useGroupRef();
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === preference || event.key === null) setWidth(readWidth());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (ref.current?.getLayout().reader !== undefined)
      ref.current.setLayout({ chat: 100 - width, reader: width });
  }, [width, ref]);
  return (
    <ResizablePanelGroup
      groupRef={ref}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction || !Number.isFinite(layout.reader)) return;
        const percent = Math.max(30, Math.min(55, layout.reader));
        sessionWidth = percent;
        setWidth(percent);
        try {
          localStorage.setItem(preference, String(percent));
        } catch {
          /* Session-only fallback. */
        }
      }}
    >
      <ResizablePanel id="chat" minSize="45%">
        {chat}
      </ResizablePanel>
      <ResizableHandle aria-label="Chat width" withHandle />
      <ResizablePanel id="reader" defaultSize={width + "%"} minSize="30%" maxSize="55%">
        {reader}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
