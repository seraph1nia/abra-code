import { text } from "../../../src/visibility/controls.ts";
import { SessionId } from "../../../src/identities.ts";
import { Plugin } from "@opencode/plugin/tui";
import { createComponent, Show } from "solid-js";
import { createWorkView } from "../../../src/visibility/client.ts";
import { Sidebar, WorkPanel } from "../../../src/visibility/ui.ts";

export default Plugin.define({
  id: "abracode",
  setup(ctx) {
    const view = createWorkView(ctx);
    const footers = ["home.footer.status", "prompt.footer.status"].map((slot) =>
      ctx.ui.slot({
        append: slot as "home.footer.status" | "prompt.footer.status",
        render: () => text(ctx, () => "AbraCode · Talk to Abra", true),
      }),
    );
    const sidebar = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => Sidebar(ctx, view, () => SessionId.make(input.sessionID)),
    });
    const panel = ctx.ui.slot({
      append: "session.panel",
      render: (input) =>
        createComponent(Show, {
          keyed: true,
          get when() {
            return input.name === "abracode.work";
          },
          children: () => WorkPanel(ctx, view, input),
        }),
    });
    const route = ctx.ui.router.register({ name: "work", render: () => WorkPanel(ctx, view) });
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "abracode.work",
          title: "Browse AbraCode work",
          group: "AbraCode",
          palette: true,
          slash: { name: "abra" },
          run: view.overview,
        },
        {
          id: "abracode.find",
          title: "Find AbraCode ticket",
          group: "AbraCode",
          palette: true,
          slash: { name: "abra-find" },
          run: () => view.chooseIssue(),
        },
        {
          id: "abracode.sessions",
          title: "Inspect a worker",
          group: "AbraCode",
          palette: true,
          slash: { name: "abra-session" },
          run: () => view.chooseSession(),
        },
        {
          id: "abracode.refresh",
          title: "Refresh AbraCode work",
          group: "AbraCode",
          palette: true,
          slash: { name: "abra-refresh" },
          run: () => view.refresh(),
        },
        {
          id: "abracode.spec",
          title: "View selected OpenSpec change",
          group: "AbraCode",
          palette: true,
          slash: { name: "abra-spec" },
          run: async () => {
            if (view.state.selected) view.show(view.state.selected);
            else await view.chooseIssue();
            if (view.state.selected) view.setTab("plan");
          },
        },
      ],
    }));
    return async () => {
      await view.dispose();
      for (const footer of footers) footer();
      sidebar();
      panel();
      route();
    };
  },
});
