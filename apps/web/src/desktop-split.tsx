import { useEffect, useState, type ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  useGroupRef,
} from "@abracode/presentation/ui/resizable";

const preference = "abra-reader-percent";
const defaultWidth = 58;
const minWidth = 30;
const maxWidth = 70;
let sessionWidth = defaultWidth;

function readWidth() {
  try {
    const value = Number(localStorage.getItem(preference));
    if (Number.isFinite(value) && value >= minWidth && value <= maxWidth) return value;
  } catch {
    return sessionWidth;
  }
  return defaultWidth;
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
        const percent = Math.max(minWidth, Math.min(maxWidth, layout.reader));
        sessionWidth = percent;
        setWidth(percent);
        try {
          localStorage.setItem(preference, String(percent));
        } catch {
          /* Session-only fallback. */
        }
      }}
    >
      <ResizablePanel id="chat" minSize="30%">
        {chat}
      </ResizablePanel>
      <ResizableHandle aria-label="Chat width" withHandle />
      <ResizablePanel
        id="reader"
        defaultSize={width + "%"}
        minSize={minWidth + "%"}
        maxSize={maxWidth + "%"}
      >
        {reader}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
