import { createEffect, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
import { InputRenderable, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { type Context, type PanelInput } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, buttonGroup, text } from "./controls.ts";
import { WorkHome } from "./home.ts";
import { TicketView } from "./detail-view.ts";
export { Sidebar } from "./sidebar.ts";

/** Shared fixed navigation shell for native session panels and full-page routes. */
export function WorkPanel(ctx: Context, view: WorkView, panel?: PanelInput) {
  const buttons = buttonGroup(ctx);
  const [width, setWidth] = createSignal(0);
  let root: BoxRenderable;
  let scroll: ScrollBoxRenderable;
  let previousKey = untrack(view.scrollKey);
  let restoreScroll: number | undefined;
  createEffect(
    on(
      view.scrollKey,
      (key) => {
        if (!scroll) return;
        view.saveScrollAt(previousKey, scroll.scrollTop);
        previousKey = key;
        restoreScroll = view.state.scroll[key] ?? 0;
        ctx.renderer.requestRender();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    if (scroll) view.saveScrollAt(previousKey, scroll.scrollTop);
  });
  createEffect(() => {
    if (panel?.focused) buttons.focus();
  });
  ctx.keymap.layer(() => ({
    target: () => root,
    enabled: () =>
      !ctx.renderer.currentFocusedEditor &&
      !(ctx.renderer.currentFocusedRenderable instanceof InputRenderable),
    commands: [
      {
        id: "abracode.panel.back",
        title: "Work back",
        bind: "escape",
        run: () => {
          if (!view.state.selected && !view.state.history.length && panel) panel.close();
          else view.back();
        },
      },
      {
        id: "abracode.panel.home",
        title: "Work home",
        bind: "h",
        run: () => {
          view.overview();
          buttons.focus();
        },
      },
    ],
  }));
  return box({
    ref: (value) => {
      root = value;
    },
    width: "100%",
    height: "100%",
    minHeight: 0,
    onSizeChange: () => setWidth(root.width),
    renderAfter: () => {
      if (
        restoreScroll === undefined ||
        (view.state.selected && !view.state.detail) ||
        (view.state.tab === "diff" && view.state.diff_loading)
      )
        return;
      const position = restoreScroll;
      restoreScroll = undefined;
      queueMicrotask(() => {
        if (!scroll.isDestroyed) scroll.scrollTop = position;
      });
    },
    flexDirection: "column",
    padding: 1,
    gap: 1,
    children: [
      text(ctx, () => `AbraCode / ${view.state.selected ?? "Work"}`),
      actions([
        buttons.button(() => "⌂ Home", view.overview),
        buttons.button(() => "← Back", view.back),
        buttons.button(
          () => "Refresh ↻",
          () => {
            void view.refresh();
          },
        ),
      ]),
      text(
        ctx,
        () =>
          view.state.error
            ? "Connection unavailable · showing last snapshot"
            : view.state.snapshot?.at
              ? `Observed ${view.state.snapshot.at}`
              : "Waiting for work snapshot",
        true,
      ),
      text(
        ctx,
        () =>
          view.state.resource_error ??
          (view.state.detail_error ? `Details unavailable: ${view.state.detail_error}` : ""),
        true,
      ),
      jsx("scrollbox", {
        ref: (value: ScrollBoxRenderable) => {
          scroll = value;
        },
        flexGrow: 1,
        minHeight: 0,
        width: "100%",
        scrollX: false,
        children: box({
          flexDirection: "column",
          gap: 1,
          children: Show({
            get when() {
              return !!view.state.selected;
            },
            get fallback() {
              return WorkHome(ctx, view, buttons);
            },
            children: (_shown: unknown) =>
              Show({
                get when() {
                  return !!view.state.detail;
                },
                fallback: text(
                  ctx,
                  () => (view.state.detail_error ? "Refresh to retry details" : "Loading ticket…"),
                  true,
                ),
                children: (_shown: unknown) =>
                  TicketView(ctx, view, buttons, () => width() >= 100, panel),
              }),
          }),
        }),
      }),
      actions([
        ...(panel
          ? [buttons.button(() => "Close panel", panel.close)]
          : [
              buttons.button(() => "OpenCode home", view.openCodeHome),
              Show({
                get when() {
                  return view.state.return_session;
                },
                children: (_shown: unknown) =>
                  buttons.button(
                    () => "Return to session ↗",
                    () => {
                      void view.openSession(view.state.return_session!);
                    },
                  ),
              }),
            ]),
        text(
          ctx,
          () =>
            `${ctx.keymap.shortcuts("abracode.panel.back").join(" / ")} Back · ${ctx.keymap.shortcuts("abracode.panel.home").join(" / ")} Home · Tab / ← →`,
          true,
        ),
      ]),
    ],
  });
}
