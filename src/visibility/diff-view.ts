import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
import { type DiffRenderable } from "@opentui/core";
import { generateSyntax } from "@opencode/theme/tui";
import { type Context, type PanelInput } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, text, type Buttons } from "./controls.ts";

function patch(ctx: Context, view: WorkView, wide: () => boolean) {
  let node: DiffRenderable;
  const syntax = createMemo(() => {
    const value = generateSyntax(ctx.theme);
    onCleanup(() => value.destroy());
    return value;
  });
  createEffect(() => {
    node.syntaxStyle = syntax();
    node.addedBg = ctx.theme.diff.background.added;
    node.removedBg = ctx.theme.diff.background.removed;
    node.contextBg = ctx.theme.diff.background.context;
    node.addedSignColor = ctx.theme.diff.text.added;
    node.removedSignColor = ctx.theme.diff.text.removed;
    node.fg = ctx.theme.text.base;
    node.requestRender();
  });
  return jsx("diff", {
    ref: (value: DiffRenderable) => {
      node = value;
    },
    width: "100%",
    flexShrink: 0,
    showLineNumbers: true,
    syncScroll: true,
    wrapMode: "word",
    get diff() {
      return view.state.diff?.patch ?? "";
    },
    get view() {
      return wide() ? view.state.diff_view : "unified";
    },
    get filetype() {
      return view.state.diff_file?.split(".").at(-1);
    },
    syntaxStyle: syntax(),
  });
}
export function DiffView(
  ctx: Context,
  view: WorkView,
  buttons: Buttons,
  wide: () => boolean,
  panel?: PanelInput,
) {
  const data = () => view.state.diff;
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      actions([
        buttons.button(
          () => "All ticket changes",
          () => view.setDiffScope("all"),
          () => view.state.diff_scope === "all",
        ),
        buttons.button(
          () => "Uncommitted only",
          () => view.setDiffScope("uncommitted"),
          () => view.state.diff_scope === "uncommitted",
        ),
        buttons.button(() => "Reload diff ↻", view.reloadDiff),
      ]),
      text(
        ctx,
        () => (view.state.diff_loading ? "Loading diff…" : (view.state.diff_error ?? "")),
        true,
      ),
      text(ctx, () => {
        const diff = data();
        if (!diff) return "";
        return `${diff.files.length}${diff.limited ? "+" : ""} changed files · +${diff.files.reduce((n, f) => n + f.additions, 0)} −${diff.files.reduce((n, f) => n + f.deletions, 0)}${diff.files.some((f) => f.limited) ? " · some statistics unavailable" : ""}`;
      }),
      text(
        ctx,
        () =>
          data()?.base
            ? `Base ${data()!.base!.slice(0, 12)} → ${data()?.historical ? data()!.head!.slice(0, 12) : "current worktree"}`
            : "",
        true,
      ),
      text(
        ctx,
        () =>
          data()
            ? `Read ${data()!.at} · ${data()?.historical ? "retained commits" : view.state.diff_scope === "all" ? "committed + staged + unstaged + untracked" : "staged + unstaged + untracked"}`
            : "",
        true,
      ),
      Show({
        get when() {
          return !!data()?.files.length;
        },
        children: (_shown: unknown) =>
          actions([
            buttons.button(
              () => "Choose file",
              () => {
                void view.chooseDiffFile();
              },
            ),
            buttons.button(
              () => "Unified",
              () => view.setDiffView("unified"),
              () => !wide() || view.state.diff_view === "unified",
            ),
            Show({
              get when() {
                return wide();
              },
              children: (_shown: unknown) =>
                buttons.button(
                  () => "Split",
                  () => view.setDiffView("split"),
                  () => view.state.diff_view === "split",
                ),
            }),
            ...(panel
              ? [
                  buttons.button(
                    () => (panel.presentation === "fullscreen" ? "Restore panel" : "Expand diff"),
                    panel.toggleFullscreen,
                  ),
                ]
              : []),
          ]),
      }),
      text(ctx, () => data()?.file ?? ""),
      text(ctx, () => data()?.message ?? "", true),
      text(
        ctx,
        () =>
          data()?.limited
            ? "File list limited to 500 entries. Narrow the change set for full inspection."
            : "",
        true,
      ),
      Show({
        get when() {
          return !!data()?.patch;
        },
        children: (_shown: unknown) => patch(ctx, view, wide),
      }),
    ],
  });
}
