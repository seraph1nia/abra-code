import { deliveryOutcomeLines } from "../workflow/delivery-outcome.ts";
import { FeedbackView } from "./feedback-view.ts";
import { CommunicationView } from "./communication-view.ts";
import { Show } from "solid-js";
import { type Context, type PanelInput } from "@opencode/plugin/tui/context";
import { phaseLabel, type WorkView } from "./client.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";
import { badge, workerLinks } from "./work-components.ts";
import { markdown } from "./markdown.ts";
import { DiffView } from "./diff-view.ts";
import { section, stateLabel } from "./presentation.ts";
import { type Tab } from "./view-state.ts";

export function TicketView(
  ctx: Context,
  view: WorkView,
  buttons: Buttons,
  wide: () => boolean,
  panel?: PanelInput,
) {
  const detail = () => view.state.detail!;
  const work = () => detail().work;
  const overview = () =>
    box({
      flexDirection: "column",
      gap: 1,
      children: [
        Show({
          get when() {
            return ["attention", "blocked"].includes(section(work()));
          },
          children: (_shown: unknown) =>
            box({
              flexDirection: "column",
              paddingX: 1,
              border: ["left"],
              get borderColor() {
                return ctx.theme.text.feedback.warning.base;
              },
              children: [
                text(ctx, () => `Next: ${stateLabel(work())}`),
                text(
                  ctx,
                  () =>
                    work().error ??
                    work()
                      .blockers.filter((b) => b !== "Existing execution must be resumed")
                      .join("\n"),
                  true,
                ),
                Show({
                  get when() {
                    return work().supervisor_session_id;
                  },
                  children: (_shown: unknown) =>
                    buttons.button(
                      () => "Talk to Abra ↗",
                      () => {
                        void view.openSession(work().supervisor_session_id!);
                      },
                    ),
                }),
              ],
            }),
        }),
        text(ctx, () => `Ticket status: ${work().issue_status} · Priority ${work().priority}`),
        text(ctx, () => `Workflow phase: ${phaseLabel(work().phase)}`),
        text(
          ctx,
          () =>
            work().outcome
              ? deliveryOutcomeLines(work().outcome!).join("\n")
              : "Delivery evidence unavailable",
          true,
        ),
        text(
          ctx,
          () => {
            const session = work().sessions.find((s) => s.role === work().active_role);
            return session
              ? `Worker activity: ${session.role} · ${view.sessionStatus(session.id)}`
              : "Worker activity: no active worker";
          },
          true,
        ),
        text(
          ctx,
          () =>
            detail().progress
              ? `Implementation tasks: ${detail().progress!.complete}/${detail().progress!.total} complete`
              : "",
          true,
        ),
        text(ctx, () => (work().policy ? `Workflow: ${work().policy}` : ""), true),
        text(
          ctx,
          () =>
            work().operation
              ? `Operation: ${work().operation!.action} · ${work().operation!.status}`
              : "",
          true,
        ),
        text(
          ctx,
          () =>
            work().progress
              ? `Last progress: ${new Date(work().progress!.at).toISOString()} · ${work().progress!.summary}`
              : "",
          true,
        ),
        text(
          ctx,
          () =>
            work().command_wait
              ? `Command deadline: ${new Date(work().command_wait!.deadline_at).toISOString()}`
              : "",
          true,
        ),
        text(
          ctx,
          () =>
            work().delivery_wait
              ? `Recheck: ${new Date(work().delivery_wait!.next_check_at).toISOString()} · ${work().delivery_wait!.owner}`
              : "",
          true,
        ),
        each(
          () => work().decisions ?? [],
          (d) =>
            text(
              ctx,
              () =>
                `Question [${d.key}] · ${d.owner}: ${d.question}\nResolve through Abra; generation ${d.generation}.`,
            ),
        ),
        each(
          () => work().waits ?? [],
          (w) =>
            text(
              ctx,
              () =>
                `Wait [${w.key}] · ${w.status} · ${w.owner}: ${w.condition}\nClears on ${w.kind}: ${w.reference}; expires ${new Date(w.expires_at).toISOString()}`,
              true,
            ),
        ),
        each(
          () =>
            work().attention?.filter((a) => !["handled", "superseded"].includes(a.status)) ?? [],
          (a) =>
            text(
              ctx,
              () =>
                `Attention: ${a.code.replaceAll("_", " ")} · ${a.status}\n${a.evidence}\n${a.disposition ?? "Supervisor disposition needed"}`,
              true,
            ),
        ),
        text(
          ctx,
          () =>
            work().capacity_wait
              ? `Capacity: ${work().capacity_wait!.reasons.join("; ")}\nConsumed by: ${work().capacity_wait!.consuming.join(", ")}`
              : "",
          true,
        ),
        markdown(ctx, () => detail().description),
      ],
    });
  const plan = () =>
    box({
      flexDirection: "column",
      gap: 1,
      children: [
        text(ctx, () =>
          work().policy && work().policy !== "full-openspec"
            ? work().policy === "research-only"
              ? "Research contract and report"
              : "Lightweight scope"
            : detail().change
              ? `Change: ${detail().change}`
              : "No OpenSpec change yet",
        ),
        text(ctx, () => (detail().archive ? `Archived: ${detail().archive}` : ""), true),
        text(ctx, () =>
          work().policy && work().policy !== "full-openspec"
            ? ""
            : `Planning artifacts: ${detail().artifacts.filter((a) => a.status === "done").length}/${detail().artifacts.length} written`,
        ),
        each(
          () => detail().artifacts.map((a) => a.id),
          (id) =>
            text(
              ctx,
              () => {
                const a = detail().artifacts.find((a) => a.id === id)!;
                return `${a.id}: ${a.status} · ${a.path}`;
              },
              true,
            ),
        ),
        text(
          ctx,
          () =>
            detail().progress
              ? `Implementation tasks: ${detail().progress!.complete}/${detail().progress!.total} · ${detail().progress!.remaining} remaining`
              : "",
          true,
        ),
        Show({
          get when() {
            return !!detail().documents?.length;
          },
          children: (_shown: unknown) =>
            buttons.button(
              () => "Choose document",
              () => {
                void view.chooseDocument();
              },
            ),
        }),
        Show({
          get when() {
            return work().report_available;
          },
          children: (_shown: unknown) =>
            actions([
              buttons.button(
                () => "Open retained report",
                () => view.loadReport(),
              ),
              buttons.button(
                () => "Show scope",
                () => view.showScope(),
              ),
            ]),
        }),
        text(
          ctx,
          () =>
            work().policy_summary
              ? `Approval: scope/plan ${work().policy_summary!.plan_approval ? "required" : "standing"} · merge ${work().policy_summary!.merge_approval ? "required" : "standing"}\nDelivery: ${work().policy_summary!.merge_method} · CI ${work().policy_summary!.ci_policy} · repair budget ${work().policy_summary!.repair_rounds}`
              : "",
          true,
        ),
        each(
          () => work().scope_history ?? [],
          (s) => text(ctx, () => `Scope revision ${s.revision}: ${s.goal}`, true),
        ),
        each(
          () => work().rounds ?? [],
          (r) =>
            text(
              ctx,
              () =>
                `Round ${r.ordinal} · ${r.source} · ${r.finding_count} findings\n${r.instructions}${r.archive_path ? `\nPrior archive: ${r.archive_path}` : ""}`,
              true,
            ),
        ),
        text(
          ctx,
          () =>
            view.state.document_path === "@report"
              ? `Report: ${work().report?.report_id ?? "retained"}`
              : (view.state.document_path ??
                (detail().proposal ? (work().scope ? "Scope contract" : "proposal.md") : "")),
          true,
        ),
        text(
          ctx,
          () =>
            view.state.document_error ??
            (view.state.document_path && !view.state.document ? "Loading document…" : ""),
          true,
        ),
        each(
          () => [view.state.document_path ?? "@scope"],
          () =>
            markdown(ctx, () =>
              view.state.document_path
                ? (view.state.document?.content ?? "")
                : (detail().proposal ?? ""),
            ),
        ),
        each(
          () => detail().errors,
          (error) => text(ctx, () => `Unavailable: ${error}`, true),
        ),
      ],
    });
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      text(ctx, () => work().title),
      text(ctx, () => `${work().repository_id ?? "unregistered"} · ${work().issue_id}`, true),
      badge(ctx, work),
      actions(
        (
          [
            ["overview", "Overview"],
            ["plan", "Plan"],
            ["diff", "Diff"],
            ["workers", "Workers"],
            ["feedback", "Feedback"],
            ["communication", "Communication"],
          ] as const
        ).map(([id, label]) =>
          buttons.button(
            () => label,
            () => view.setTab(id),
            () => view.state.tab === id,
          ),
        ),
      ),
      each(
        () => [view.state.tab],
        (tab: Tab) =>
          tab === "overview"
            ? overview()
            : tab === "plan"
              ? plan()
              : tab === "diff"
                ? DiffView(ctx, view, buttons, wide, panel)
                : tab === "feedback"
                  ? FeedbackView(ctx, view, buttons)
                  : tab === "communication"
                    ? CommunicationView(ctx, view, buttons)
                    : workerLinks(ctx, view, work, buttons),
      ),
      text(
        ctx,
        () =>
          view.state.tab === "workers" && !work().sessions.length ? "No worker sessions yet" : "",
        true,
      ),
    ],
  });
}
