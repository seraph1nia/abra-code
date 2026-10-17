import { jsx } from "@opentui/solid/jsx-runtime";
import { type KeyEvent } from "@opentui/core";
import { Show } from "solid-js";
import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";
import { ordered, section, sections } from "./presentation.ts";
import { issueRow } from "./work-components.ts";

export function WorkHome(ctx: Context, view: WorkView, buttons: Buttons) {
  const all = () => view.state.snapshot?.work ?? [];
  const filtered = () =>
    ordered(
      all().filter(
        (w) =>
          (!view.state.repository || w.repository_id === view.state.repository) &&
          `${w.title} ${w.issue_id} ${w.repository_id ?? ""}`
            .toLowerCase()
            .includes(view.state.query.toLowerCase()),
      ),
    );
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      text(
        ctx,
        () =>
          `Work · ${all().filter((w) => w.issue_status !== "closed").length} open · ${view.state.snapshot?.closed_total ?? 0} closed`,
      ),
      actions([
        buttons.button(
          () => view.state.repository || "All repositories",
          () => {
            void view.chooseRepository();
          },
        ),
        buttons.button(
          () => "Find ticket",
          () => {
            void view.chooseIssue();
          },
        ),
      ]),
      jsx("input", {
        width: "100%",
        height: 1,
        placeholder: "Search titles, IDs and repositories…",
        get value() {
          return view.state.query;
        },
        onInput: view.setQuery,
        onKeyDown: (event: KeyEvent) => {
          if (event.name !== "escape") event.stopPropagation();
        },
      }),
      text(ctx, () => `${filtered().length} of ${all().length} loaded tickets`, true),
      each(
        () => sections,
        (group) => {
          const values = () => filtered().filter((w) => section(w) === group.id);
          const collapsed = () => view.state.collapsed.includes(group.id);
          return Show({
            get when() {
              return values().length > 0;
            },
            children: (_shown: unknown) =>
              box({
                flexDirection: "column",
                children: [
                  buttons.button(
                    () => `${collapsed() ? "▸" : "▾"} ${group.label} · ${values().length}`,
                    () => view.toggleSection(group.id),
                  ),
                  Show({
                    get when() {
                      return !collapsed();
                    },
                    children: (_shown: unknown) =>
                      each(
                        () => values().map((w) => w.issue_id),
                        (id) =>
                          issueRow(ctx, view, () => all().find((w) => w.issue_id === id)!, buttons),
                      ),
                  }),
                  Show({
                    get when() {
                      return (
                        group.id === "done" &&
                        !collapsed() &&
                        (view.state.snapshot?.closed_total ?? 0) > 50
                      );
                    },
                    children: (_shown: unknown) =>
                      actions([
                        buttons.button(
                          () => "Newer closed",
                          () => {
                            void view.closedPage(view.state.closedPage - 1);
                          },
                        ),
                        text(
                          ctx,
                          () =>
                            `Page ${view.state.closedPage + 1} / ${Math.ceil((view.state.snapshot?.closed_total ?? 0) / 50)}`,
                          true,
                        ),
                        buttons.button(
                          () => "Older closed",
                          () => {
                            void view.closedPage(view.state.closedPage + 1);
                          },
                        ),
                      ]),
                  }),
                ],
              }),
          });
        },
      ),
      text(
        ctx,
        () =>
          !view.state.loading && !all().length
            ? "No open work"
            : !filtered().length
              ? "No matching work. Clear search or change repository."
              : "",
        true,
      ),
    ],
  });
}
