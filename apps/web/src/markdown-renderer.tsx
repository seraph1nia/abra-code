import { Streamdown } from "streamdown";
import type { MarkdownProps } from "./markdown.tsx";
/** Use the same upstream renderer directly, isolated from the optional Copilot web UI. */
export default function MarkdownRenderer({ content, ...props }: MarkdownProps) {
  return <Streamdown {...props}>{content}</Streamdown>;
}
