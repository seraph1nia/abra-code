import { jsx } from "@opentui/solid/jsx-runtime";
import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { type WorkItem } from "./protocol.ts";
import { section, stateLabel } from "./presentation.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";
export { needsAttention } from "./presentation.ts";

export function badge(ctx: Context, item: () => WorkItem, limit = 160) {
  const kind = () => {
    const group = section(item());
    return group === "attention" || group === "blocked"
      ? "warning"
      : group === "done"
        ? "success"
        : "info";
  };
  return jsx("text", {
    get content() {
      const label = stateLabel(item());
      return `${section(item()) === "attention" ? "! " : ""}${label.slice(0, limit)}${label.length > limit ? "…" : ""}`;
    },
    get fg() {
      return ctx.theme.text.feedback[kind()].base;
    },
    wrapMode: "word",
  });
}
export function workerLinks(ctx: Context, view: WorkView, item: () => WorkItem, buttons: Buttons) {
  return each(
    () => item().sessions.map((s) => s.id),
    (id) =>
      box({
        flexDirection: "column",
        marginBottom: 1,
        children: [
          actions([
            text(
              ctx,
              () => `${item().sessions.find((s) => s.id === id)?.role} · ${view.sessionStatus(id)}`,
            ),
            buttons.button(
              () => "Inspect worker",
              () => {
                void view.inspectWorker(id);
              },
            ),
          ]),
          text(ctx, () => view.state.activity[id] ?? "", true),
          text(
            ctx,
            () =>
              view.state.worker_id !== id
                ? ""
                : view.state.worker_loading
                  ? "Loading worker evidence…"
                  : (view.state.worker_error ?? ""),
            true,
          ),
          text(
            ctx,
            () =>
              view.state.worker_id === id && view.state.worker
                ? `${view.state.worker.note}\nModel: ${view.state.worker.model?.providerID ?? view.state.worker.configured_model?.providerID ?? "unavailable"}/${view.state.worker.model?.id ?? view.state.worker.configured_model?.id ?? "unavailable"}\n${(view.state.worker.recent_messages ?? []).map((message) => `${message.type}: ${message.text ?? "[no retained text]"}`).join("\n")}`
                : "",
            true,
          ),
        ],
      }),
  );
}
export function issueRow(
  ctx: Context,
  view: WorkView,
  item: () => WorkItem,
  buttons: Buttons,
  compact = false,
) {
  return box({
    flexDirection: "column",
    border: compact ? [] : ["bottom"],
    get borderColor() {
      return ctx.theme.border.base;
    },
    children: [
      buttons.button(
        () =>
          compact && item().title.length > 80 ? item().title.slice(0, 80) + "…" : item().title,
        () => view.show(item().issue_id),
        () => view.state.selected === item().issue_id,
        true,
        `abracode.ticket:${compact ? "sidebar" : "home"}:${item().issue_id}`,
      ),
      badge(ctx, item, compact ? 60 : 160),
      text(
        ctx,
        () =>
          `${item().repository_id ?? "unregistered"} · ${item().issue_id}${compact ? "" : ` · P${item().priority}`}`,
        true,
      ),
      ...(compact
        ? []
        : [
            text(
              ctx,
              () => {
                if (item().issue_status === "closed")
                  return item().closed_at ? `Closed ${item().closed_at}` : "";
                const session = item().sessions.find((s) => s.role === item().active_role);
                return session ? `Worker: ${session.role} · ${view.sessionStatus(session.id)}` : "";
              },
              true,
            ),
          ]),
    ],
  });
}
