import { createComponent, createSignal, For, onCleanup } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
import { type JSX } from "@opentui/solid";
import { ScrollBoxRenderable, TextAttributes, type BoxRenderable } from "@opentui/core";
import { type Context } from "@opencode/plugin/tui/context";

export const box = (props: JSX.IntrinsicElements["box"]) =>
  jsx("box", props as JSX.IntrinsicElements["box"] & Record<string, unknown>);
export function each<T>(values: () => readonly T[], render: (value: T) => JSX.Element) {
  return createComponent(For, {
    get each() {
      return values();
    },
    children: render,
  });
}
export function text(ctx: Context, content: () => string, muted = false) {
  return jsx("text", {
    get content() {
      return content();
    },
    get visible() {
      return content().length > 0;
    },
    get fg() {
      return muted ? ctx.theme.text.muted : ctx.theme.text.base;
    },
    wrapMode: "word",
  });
}
export function actions(children: JSX.Element) {
  return box({ flexDirection: "row", flexWrap: "wrap", columnGap: 1, rowGap: 0, children });
}

/** Focus stays local to this surface; registering buttons never takes chat focus. */
export function buttonGroup(ctx: Context) {
  const buttons: BoxRenderable[] = [];
  const ordered = () => [...buttons].sort((a, b) => a.y - b.y || a.x - b.x);
  const focus = (node?: BoxRenderable) => {
    if (!node) return;
    node.focus();
    let parent = node.parent;
    while (parent) {
      if (parent instanceof ScrollBoxRenderable) {
        if (
          node.y < parent.viewport.y ||
          node.y + node.height > parent.viewport.y + parent.viewport.height
        )
          parent.scrollChildIntoView(node.id);
        break;
      }
      parent = parent.parent;
    }
  };
  return {
    focus: () => focus(ordered()[0]),
    button(
      label: () => string,
      run: () => void,
      selected: () => boolean = () => false,
      wrap = false,
      id?: string,
    ) {
      const [hovered, setHovered] = createSignal(false);
      const [focused, setFocused] = createSignal(false);
      let node: BoxRenderable;
      onCleanup(() => {
        const index = buttons.indexOf(node);
        if (index >= 0) buttons.splice(index, 1);
      });
      const states = () => ({ hovered: hovered(), focused: focused(), selected: selected() });
      return box({
        ref: (value) => {
          node = value;
          buttons.push(value);
        },
        id,
        focusable: true,
        flexShrink: wrap ? 1 : 0,
        width: wrap ? "100%" : undefined,
        paddingX: 1,
        get backgroundColor() {
          return ctx.theme.background.action.secondary.state(states());
        },
        onMouseOver: () => setHovered(true),
        onMouseOut: () => setHovered(false),
        "on:focused": () => setFocused(true),
        "on:blurred": () => setFocused(false),
        onMouseDown(event) {
          if (event.button !== 0) return;
          event.stopPropagation();
          node.focus();
        },
        onMouseUp(event) {
          if (event.button !== 0) return;
          event.stopPropagation();
          run();
        },
        onKeyDown(event) {
          if (event.name === "return" || event.name === "space") {
            event.preventDefault();
            event.stopPropagation();
            run();
          } else if (["tab", "left", "right", "up", "down"].includes(event.name)) {
            event.preventDefault();
            event.stopPropagation();
            const step = event.shift || ["left", "up"].includes(event.name) ? -1 : 1;
            const order = ordered();
            focus(order[(order.indexOf(node) + step + order.length) % order.length]);
          }
        },
        children: jsx("text", {
          get content() {
            return label();
          },
          get fg() {
            return ctx.theme.text.action.secondary.state(states());
          },
          wrapMode: wrap ? "word" : "none",
          attributes: wrap ? TextAttributes.BOLD : 0,
        }),
      });
    },
  };
}
export type Buttons = ReturnType<typeof buttonGroup>;
