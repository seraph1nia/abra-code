import { useState } from "react";
import { Streamdown } from "streamdown";
import type { MarkdownProps } from "./markdown.tsx";

/** Streamdown's static Markdown processor retains its initial tree across
 * equal-length edits. Give each observed revision its own processor. */
function StaticMarkdown({ content, ...props }: MarkdownProps) {
  const [previous, setPrevious] = useState({ content, revision: 0 });
  if (previous.content !== content) setPrevious({ content, revision: previous.revision + 1 });
  return (
    <Streamdown {...props} mode="static" key={previous.revision}>
      {content}
    </Streamdown>
  );
}
export default function MarkdownRenderer({ content, ...props }: MarkdownProps) {
  return props.mode === "static" ? (
    <StaticMarkdown {...props} content={content} />
  ) : (
    <Streamdown {...props}>{content}</Streamdown>
  );
}
