import { createEffect, createMemo, onCleanup } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
import { type MarkdownRenderable } from "@opentui/core";
import { generateSyntax } from "@opencode/theme/tui";
import { type Context } from "@opencode/plugin/tui/context";

export function markdown(ctx: Context, content: () => string) {
  let node: MarkdownRenderable;
  const syntax = createMemo(() => {
    const style = generateSyntax(ctx.theme);
    onCleanup(() => style.destroy());
    return style;
  });
  // OpenTUI applies Markdown style changes during the next render pass.
  createEffect(() => {
    node.syntaxStyle = syntax();
    node.fg = ctx.theme.text.base;
    node.requestRender();
  });
  return jsx("markdown", {
    ref: (value: MarkdownRenderable) => {
      node = value;
    },
    width: "100%",
    flexShrink: 0,
    get content() {
      return content();
    },
    get visible() {
      return content().length > 0;
    },
    syntaxStyle: syntax(),
    conceal: true,
    streaming: false,
  });
}
