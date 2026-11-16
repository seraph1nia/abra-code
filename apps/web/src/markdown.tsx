import type { StreamdownProps } from "streamdown";
import { deferred } from "./deferred.tsx";
export type MarkdownProps = Omit<StreamdownProps, "children"> & { content: string };
export const Markdown = deferred<MarkdownProps>(
  () => import("./markdown-renderer.tsx"),
  "Markdown",
);
