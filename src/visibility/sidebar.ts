import { type SessionId } from "../identities.ts";
import { createSignal, onCleanup, Show } from "solid-js";
import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { box, buttonGroup, each, text } from "./controls.ts";
import { issueRow } from "./work-components.ts";
import { needsAttention, ordered, section } from "./presentation.ts";

export function Sidebar(ctx: Context, view: WorkView, sessionID: () => SessionId) {
  const buttons = buttonGroup(ctx);
  const work = () => view.state.snapshot?.work ?? [];
  const current = () => work().find((w) => w.sessions.some((s) => s.id === sessionID()));
  const attention = () => ordered(work().filter(needsAttention));
  const [height, setHeight] = createSignal(ctx.renderer.height);
  const resize = () => setHeight(ctx.renderer.height);
  ctx.renderer.on("resize", resize);
  onCleanup(() => ctx.renderer.off("resize", resize));
  const visible = () => {
    const active = current();
    const candidates = ordered(work().filter((w) => section(w) !== "done"));
    const ranked = [...attention(), ...candidates.filter((w) => !needsAttention(w))];
    const limit = Math.max(1, Math.min(3, Math.floor((height() - 18) / 10)));
    return (active ? [active, ...ranked.filter((w) => w.issue_id !== active.issue_id)] : ranked)
      .slice(0, limit)
      .map((w) => w.issue_id);
  };
  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "abracode.sidebar",
        title: "Focus AbraCode sidebar",
        group: "AbraCode",
        palette: true,
        slash: { name: "abra-sidebar" },
        run: buttons.focus,
      },
    ],
  }));
  return box({
    flexDirection: "column",
    marginTop: 1,
    gap: 1,
    children: [
      text(ctx, () => "AbraCode"),
      buttons.button(() => "⌂ Work home", view.overview),
      text(
        ctx,
        () =>
          view.state.loading
            ? "Loading work…"
            : `${work().filter((w) => w.issue_status !== "closed").length} open · ${attention().length} need you`,
        true,
      ),
      text(ctx, () => (view.state.error ? "Connection unavailable · last snapshot" : ""), true),
      each(visible, (id) => {
        const item = () => work().find((w) => w.issue_id === id)!;
        return box({
          flexDirection: "column",
          children: [
            text(
              ctx,
              () =>
                current()?.issue_id === id
                  ? "CURRENT TICKET"
                  : needsAttention(item())
                    ? "NEEDS YOU"
                    : "WORK",
              true,
            ),
            issueRow(ctx, view, item, buttons, true),
            Show({
              get when() {
                return current()?.issue_id === id && item().supervisor_session_id;
              },
              children: (_shown: unknown) =>
                buttons.button(
                  () => "Talk to Abra ↗",
                  () => {
                    void view.openSession(item().supervisor_session_id!);
                  },
                ),
            }),
          ],
        });
      }),
      text(ctx, () => (!view.state.loading && !work().length ? "No open work" : ""), true),
      text(
        ctx,
        () =>
          work().length > visible().length
            ? `Showing ${visible().length} · view all in Work home`
            : "",
        true,
      ),
      buttons.button(
        () => "Refresh ↻",
        () => {
          void view.refresh();
        },
      ),
      text(ctx, () => "/abra · Work home", true),
    ],
  });
}
