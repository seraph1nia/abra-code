import { Show, createSignal } from "solid-js";
import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";
import { communicationLabel } from "./presentation.ts";
import { requiresResponse } from "../workflow/message-contracts.ts";

export function CommunicationView(ctx: Context, view: WorkView, buttons: Buttons) {
  const page = () => view.state.messages;
  const work = () => view.state.detail!.work;
  const sender = (session: string) =>
    work().sessions.find((s) => s.id === session)?.role ??
    (session === work().supervisor_session_id ? "Abra" : session);
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      text(
        ctx,
        () =>
          view.state.messages_error ??
          (view.state.messages_loading ? "Loading communication…" : ""),
        true,
      ),
      text(
        ctx,
        () =>
          page()
            ? `${page()!.outstanding} unanswered · ${page()!.total} retained messages\nNative observations at ${page()!.observed_at}. Admission does not establish acknowledgement or an answer.`
            : "No loaded communication",
        true,
      ),
      actions([
        buttons.button(() => "Refresh communication", view.reloadMessages),
        buttons.button(
          () => "Earlier messages",
          () => view.messagesPage(Math.max(0, (page()?.offset ?? 0) - 20)),
        ),
        buttons.button(
          () => "Later messages",
          () => {
            if (page()?.next_offset !== undefined) view.messagesPage(page()!.next_offset!);
          },
        ),
        buttons.button(
          () => "Questions and blockers",
          () => view.setTab("overview"),
        ),
        buttons.button(
          () => "Talk to Abra ↗",
          () => {
            if (work().supervisor_session_id) void view.openSession(work().supervisor_session_id!);
          },
        ),
      ]),
      each(
        () => page()?.entries.map((e) => e.record.request_id) ?? [],
        (id) => {
          const entry = () => page()!.entries.find((e) => e.record.request_id === id)!;
          const record = () => entry().record;
          const [expanded, setExpanded] = createSignal(false);
          return box({
            flexDirection: "column",
            gap: 1,
            children: [
              buttons.button(
                () => {
                  const r = record();
                  return `${expanded() ? "▾" : "▸"} ${sender(r.sender_session_id)} → ${r.type === "finding" ? (r.destination?.role ?? "Abra") : r.role} · ${r.type === "finding" ? "finding" : (r.kind ?? "request")}\n${communicationLabel(r)} · ${r.created_at}`;
                },
                () => setExpanded(!expanded()),
                () => false,
                true,
              ),
              text(
                ctx,
                () => {
                  const r = record();
                  if (r.type === "finding") return "";
                  const incident = entry().escalation;
                  return `Required: ${r.response ?? "none"} · recovery ${r.response_recovery ? "1 of 1" : "0 of 1"}${r.response_recovery ? ` (${r.response_recovery.status}; native ${entry().recovery_native ?? "unavailable"})` : ""}\nNative state: ${entry().native_state ?? "unavailable"}${entry().native_outcome ? ` · outcome ${entry().native_outcome}` : ""}${requiresResponse(r) ? `\nResponse remains outstanding${incident ? ` · escalation ${incident.status}` : ""}. Inspect the original request through Abra before explicitly retrying or resuming.` : ""}`;
                },
                true,
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
                      text(ctx, () => {
                        const r = record();
                        return `Request ${id} · generation ${r.generation}\n${r.body ?? "Original controller request retained; inspect through Abra"}${r.type !== "finding" ? `\nCurrent native lookup: ${entry().native ?? "unavailable"}${r.acknowledged_at ? `\nAcknowledged ${r.acknowledged_at}` : ""}${r.reply ? `\nAnswer ${r.reply.at}: ${r.reply.body}` : ""}` : ""}`;
                      }),
                      text(
                        ctx,
                        () => {
                          const r = record(),
                            evidence = r.type === "finding" ? r.evidence : r.reply?.evidence;
                          return evidence?.length ? `Evidence: ${JSON.stringify(evidence)}` : "";
                        },
                        true,
                      ),
                      text(ctx, () => {
                        const d = entry().decision;
                        return d
                          ? `Existing decision ${d.key} · ${d.status} · owner ${d.owner}\n${d.question}\n${d.owner === "user" ? "Human answer required through Abra's native form" : "Abra or an eligible scoped lead may answer from evidence"}. ${d.status === "open" ? "The response obligation remains a worker checkpoint blocker." : "Retained decision history."}`
                          : "";
                      }),
                      text(
                        ctx,
                        () => {
                          const escalation = entry().escalation;
                          return escalation
                            ? `Escalation ${escalation.id} · ${escalation.status}\n${escalation.evidence}${escalation.disposition ? `\n${escalation.disposition}` : ""}`
                            : "";
                        },
                        true,
                      ),
                      actions([
                        buttons.button(
                          () => "Inspect sender",
                          () => {
                            const r = record();
                            if (work().sessions.some((s) => s.id === r.sender_session_id))
                              void view.inspectWorker(r.sender_session_id);
                          },
                        ),
                        buttons.button(
                          () => "Inspect recipient",
                          () => {
                            const r = record();
                            if (r.type !== "finding")
                              void view.inspectWorker(r.recipient_session_id);
                          },
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
