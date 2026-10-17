import { type Context } from "@opencode/plugin/tui/context";
import { type WorkView } from "./client.ts";
import { actions, box, each, text, type Buttons } from "./controls.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";

/** Read-only, lazy evidence. Buttons request exact controller tools through the central Supervisor. */
export function FeedbackView(ctx: Context, view: WorkView, buttons: Buttons) {
  const page = () => view.state.feedback;
  const work = () => view.state.detail!.work;
  const request = (kind: string, finding?: string) => {
    const value = page();
    if (!value?.head) return;
    void view.requestControl("abra_work_pr_action", {
      issue_id: value.issue_id,
      generation: value.generation,
      expected_head: value.head,
      kind,
      ...(finding ? { finding_id: finding } : {}),
    });
  };
  const external = (action: string, response?: string) => {
    const value = page(),
      run = value?.external_validation;
    if (!value || !run) return;
    void view.requestControl("abra_work_validation", {
      issue_id: value.issue_id,
      generation: value.generation,
      expected_head: run.submitted_head,
      action,
      ...(response ? { response, gate_digest: value.external_gate_digest } : {}),
    });
  };
  return box({
    flexDirection: "column",
    gap: 1,
    children: [
      text(
        ctx,
        () =>
          view.state.feedback_error ??
          (view.state.feedback_loading ? "Loading retained feedback…" : ""),
        true,
      ),
      text(
        ctx,
        () => {
          const p = work().policy_summary;
          return p
            ? `Quality: ${p.quality?.profile ?? "custom"}${p.quality ? ` · ${p.quality.source} · resolver ${p.quality.resolver_version}` : ""}${p.quality && Object.keys(p.quality.overrides).length ? ` · custom overrides ${JSON.stringify(p.quality.overrides)}` : ""}\nCI ${p.ci_policy} · repairs ${work().rounds?.length ?? 0}/${p.repair_rounds} · diagnostic turns ${work().attention_turns ?? 0}/${p.diagnostic_turns}\nPublication ${p.publication ?? "ready"} · reviewers ${p.reviewers?.request ?? "manual"} · replies ${p.discussion?.replies ?? "manual"} · resolution ${p.discussion?.resolve_threads ?? "manual"}\nCI reruns ${work().feedback_summary?.reruns ?? 0}/${p.ci_retry?.max_reruns ?? 0} · validation ${p.validation?.engine ?? "native"} · runs ${work().external_summary?.runs ?? 0}/${p.validation?.max_runs ?? 1}`
            : "";
        },
        true,
      ),
      text(ctx, () => {
        const o = page()?.observation;
        return o
          ? `PR ${o.pr}\nAssessed head ${o.head}\n${o.complete ? "Complete observation" : "Unconfirmed observation"} at ${new Date(o.observed_at).toISOString()} · recheck ${new Date(o.next_check_at).toISOString()}${Date.now() > o.next_check_at ? " · stale" : ""}${o.error ? `\n${o.error}` : ""}`
          : "No retained PR observation; opening this view does not poll GitHub.";
      }),
      actions([
        ...(work().policy_summary?.validation?.engine === "no-mistakes" &&
        work().implementation_head
          ? ["preflight", "setup"].map((action) =>
              buttons.button(
                () => `External ${action}…`,
                () => {
                  void view.requestControl("abra_work_validation", {
                    issue_id: work().issue_id,
                    generation: work().generation,
                    expected_head:
                      page()?.external_validation?.submitted_head ?? work().implementation_head,
                    action,
                  });
                },
              ),
            )
          : []),
        buttons.button(() => "Refresh evidence", view.reloadFeedback),
        buttons.button(
          () => "Suggest reviewers…",
          () => {
            void view.requestControl("abra_work_reviewers", { issue_id: work().issue_id });
          },
        ),
        buttons.button(
          () => "Mark ready…",
          () => request("ready"),
        ),
        buttons.button(
          () => "Request configured reviewers…",
          () => request("reviewers"),
        ),
      ]),
      each(
        () => page()?.findings ?? [],
        (f) =>
          box({
            flexDirection: "column",
            gap: 1,
            children: [
              text(
                ctx,
                () =>
                  `${f.kind} · ${f.blocking ? "blocking" : "advisory"} · ${f.disposition?.status ?? "unclassified"}${f.author ? ` · ${f.author}` : ""}\n${diagnosticText(f.text, 8192)}`,
              ),
              text(
                ctx,
                () =>
                  `Revision ${f.id}\n${f.url ?? ""}${f.original_head ? `\nOriginal head ${f.original_head}` : ""}${f.path ? ` · ${f.path}` : ""}${f.thread_id ? `\nThread ${f.resolved ? "resolved" : "open"} · can resolve ${!!f.can_resolve}` : ""}${f.disposition ? `\nAssessed on ${f.disposition.head}: ${f.disposition.reason}` : ""}${f.evidence_unavailable ? `\nDetails unavailable: ${f.evidence_unavailable}` : ""}${f.logs ? `\n${diagnosticText(f.logs, 32768)}` : ""}`,
                true,
              ),
              actions([
                ...(f.disposition?.status === "addressed"
                  ? [
                      buttons.button(
                        () => "Reply with evidence…",
                        () => request("reply", f.id),
                      ),
                      ...(f.thread_id
                        ? [
                            buttons.button(
                              () => "Resolve thread…",
                              () => request("resolve", f.id),
                            ),
                          ]
                        : []),
                    ]
                  : []),
                ...(f.kind === "check" && f.disposition?.status === "transient"
                  ? [
                      buttons.button(
                        () => "Rerun failed jobs…",
                        () => request("rerun", f.id),
                      ),
                    ]
                  : []),
              ]),
            ],
          }),
      ),
      each(
        () => page()?.actions ?? [],
        (a) =>
          box({
            flexDirection: "column",
            children: [
              text(
                ctx,
                () =>
                  `GitHub ${a.kind} · ${a.status} · ${a.authority}${a.schema_version === 2 ? `\nSubmission ${a.submission.stage}${a.preflight ? ` · ${a.preflight.retryable ? "preflight retry" : "preflight refused"}: ${a.preflight.reason}` : ""}` : ""}\nHead ${a.head}${a.result ? `\n${a.result}` : ""}${a.form_id ? `\nApproval ${a.form_id}` : ""}`,
                true,
              ),
              ...(["running", "uncertain", "prepared"].includes(a.status)
                ? [
                    buttons.button(
                      () => `Reconcile ${a.kind}…`,
                      () => {
                        const value = page();
                        if (value?.head)
                          void view.requestControl("abra_work_pr_action", {
                            issue_id: value.issue_id,
                            generation: value.generation,
                            expected_head: value.head,
                            kind: a.kind,
                            action_id: a.id,
                          });
                      },
                    ),
                  ]
                : []),
            ],
          }),
      ),
      each(
        () => page()?.history ?? [],
        (f) =>
          text(
            ctx,
            () =>
              `Prior revision ${f.id} · ${f.disposition?.status ?? "unclassified"}\n${diagnosticText(f.text, 8192)}`,
            true,
          ),
      ),
      each(
        () => (page()?.external_validation ? [page()!.external_validation!] : []),
        (r) =>
          box({
            flexDirection: "column",
            gap: 1,
            children: [
              text(
                ctx,
                () =>
                  `External run ${r.launch?.run_id ?? "launch unconfirmed"} · ${r.status}\nCustody ${r.custody} · submitted ${r.submitted_head}${r.adoption ? `\nAdopted ${r.adoption.head}` : ""}${r.error ? `\n${r.error}` : ""}`,
              ),
              text(
                ctx,
                () =>
                  r.observation?.gate
                    ? `Answer owner: user · gate ${r.observation.gate.step}\n${r.observation.gate.summary ?? ""}\n${r.observation.gate.findings.map((f) => `${f.id}: ${f.description}`).join("\n")}`
                    : "",
                true,
              ),
              each(
                () => r.responses,
                (response) =>
                  text(
                    ctx,
                    () =>
                      `Gate response ${response.step} ${response.action} · ${response.status} · form ${response.form_id}`,
                    true,
                  ),
              ),
              actions([
                ...(r.observation?.gate
                  ? [
                      buttons.button(
                        () => "Approve gate…",
                        () => external("respond", "approve"),
                      ),
                      buttons.button(
                        () => "Request bounded fix…",
                        () => external("respond", "fix"),
                      ),
                      buttons.button(
                        () => "Skip gate with decision…",
                        () => external("respond", "skip"),
                      ),
                    ]
                  : []),
                buttons.button(
                  () => "Inspect/adopt custody…",
                  () => external("adopt"),
                ),
                buttons.button(
                  () => "Abort and recover custody…",
                  () => external("abort"),
                ),
              ]),
            ],
          }),
      ),
      each(
        () => page()?.external_history ?? [],
        (r) =>
          text(
            ctx,
            () =>
              `Prior external run ${r.launch?.run_id ?? r.nonce} · ${r.status} · custody ${r.custody}`,
            true,
          ),
      ),
      actions([
        buttons.button(
          () => "← Previous evidence page",
          () => view.feedbackPage((page()?.page ?? 0) - 1),
        ),
        text(
          ctx,
          () =>
            `Page ${(page()?.page ?? 0) + 1} · ${page()?.finding_total ?? 0} findings · ${page()?.history_total ?? 0} prior revisions · ${page()?.action_total ?? 0} actions`,
          true,
        ),
        buttons.button(
          () => "Next evidence page →",
          () => {
            const p = page();
            if (
              p &&
              ((p.page + 1) * 20 < Math.max(p.finding_total, p.history_total, p.action_total) ||
                p.page + 1 < p.external_history_total)
            )
              view.feedbackPage(p.page + 1);
          },
        ),
      ]),
    ],
  });
}
