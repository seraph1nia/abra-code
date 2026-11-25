import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createElement, Fragment, type ReactNode } from "react";
import { catalogHttpUrl } from "@abracode/contracts/web/catalog";

const parser = new MarkdownIt({ html: false, linkify: false }).disable(["image", "table"]);
const elements = new Set([
  "p",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "s",
  "a",
]);
function renderTokens(tokens: Token[], inlineParagraph: boolean): ReactNode[] {
  const root: ReactNode[] = [];
  const stack: {
    tag: string;
    attrs: Record<string, string>;
    children: ReactNode[];
    key: number;
  }[] = [];
  const append = (node: ReactNode) => (stack.at(-1)?.children ?? root).push(node);
  for (const [key, token] of tokens.entries()) {
    if (token.nesting === 1) {
      const tag = token.hidden || (inlineParagraph && token.tag === "p") ? "" : token.tag;
      const attrs: Record<string, string> = {};
      if (tag === "a") {
        const href = catalogHttpUrl(token.attrGet("href") ?? "")?.href;
        if (href) Object.assign(attrs, { href, target: "_blank", rel: "noopener noreferrer" });
      }
      if (tag === "ol" && token.attrGet("start")) attrs.start = token.attrGet("start")!;
      stack.push({ tag, attrs, key, children: [] });
    } else if (token.nesting === -1) {
      const frame = stack.pop()!;
      const tag =
        elements.has(frame.tag) && (frame.tag !== "a" || frame.attrs.href) ? frame.tag : Fragment;
      append(createElement(tag, { ...frame.attrs, key: frame.key }, ...frame.children));
    } else if (token.type === "inline") {
      for (const node of renderTokens(token.children ?? [], false)) append(node);
    } else if (token.type === "code_inline") append(<code key={key}>{token.content}</code>);
    else if (token.type === "code_block" || token.type === "fence")
      append(
        <pre key={key}>
          <code>{token.content}</code>
        </pre>,
      );
    else if (token.type === "hardbreak") append(<br key={key} />);
    else if (token.type === "softbreak") append("\n");
    else if (token.type === "hr") append(<hr key={key} />);
    else append(token.content);
  }
  return root;
}

export function A2uiMarkdown({ markdown }: { markdown: string }) {
  const tokens = parser.parse(markdown, {});
  return <>{renderTokens(tokens, tokens.length === 3 && tokens[0]?.type === "paragraph_open")}</>;
}
