import { Show } from "solid-js";
import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";

/** Lead sessions are inspected here; only the parent Abra has a conversation link. */
export function LeadView(ctx: Context, view: WorkView, buttons: Buttons) {
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      text(ctx, () => `Project leads · ${view.state.snapshot?.leads?.length ?? 0}`),
      each(
        () => view.state.snapshot?.lead_diagnostics ?? [],
        (diagnostic) => text(ctx, () => `Lead record unavailable: ${diagnostic}`, true),
      ),
      each(
        () => view.state.snapshot?.leads?.map((lead) => lead.id) ?? [],
        (id) => {
          const lead = () => view.state.snapshot!.leads!.find((lead) => lead.id === id)!;
          const expanded = () => view.state.lead_id === id;
          return box({
            flexDirection: "column",
            children: [
              buttons.button(
                () =>
                  `${expanded() ? "▾" : "▸"} ${id} · ${lead().state} · ${lead().repositories.join(", ")} · ${lead().outstanding_count} outstanding · ${lead().pending_proposals.length} proposals`,
                () => view.selectLead(expanded() ? undefined : id),
              ),
              Show({
                get when() {
                  return expanded();
                },
                children: (_shown: unknown) =>
                  box({
                    flexDirection: "column",
                    gap: 1,
                    paddingLeft: 2,
                    children: [
                      text(
                        ctx,
                        () =>
                          `${lead().enabled ? "Enabled" : "Disabled"} · session ${lead().session_available ? "available" : "unavailable"}\n${lead().session_id} · registration ${lead().revision}\nObserved ${lead().observed_at}`,
                        true,
                      ),
                      text(
                        ctx,
                        () =>
                          lead().latest_outcome
                            ? `Latest outcome: ${lead().latest_outcome}`
                            : "No retained outcome yet",
                        true,
                      ),
                      text(
                        ctx,
                        () =>
                          `${lead().requests.length} of ${lead().outstanding_count} outstanding requests shown · ${lead().request_count} total. Ask Abra for full retained history.`,
                        true,
                      ),
                      each(
                        () => lead().requests,
                        (request) =>
                          text(
                            ctx,
                            () =>
                              `${request.request_id} · ${request.issue_id} · ${request.status}\n${request.question}`,
                            true,
                          ),
                      ),
                      text(
                        ctx,
                        () =>
                          lead().pending_proposals.length
                            ? `Proposals awaiting Abra: ${lead().pending_proposals.join(", ")}`
                            : "",
                        true,
                      ),
                      actions([
                        buttons.button(
                          () => "Talk to Abra ↗",
                          () => {
                            void view.openSession(lead().parent_session_id);
                          },
                        ),
                        ...lead().assigned_work.map((issue) =>
                          buttons.button(
                            () => `Open ${issue}`,
                            () => view.show(issue),
                          ),
                        ),
                      ]),
                    ],
                  }),
              }),
            ],
          });
        },
      ),
    ],
  });
}
