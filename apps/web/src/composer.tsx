import { selectionLabel } from "@abracode/contracts/web/resources";
import { useCallback, useState } from "react";
import type { Submission } from "@abracode/contracts/web/workspace-wire";
/* oxlint-disable effecttsgo/unstable-api-usage -- Composer owns draft/admission subscriptions independently of transcript presentation. */
import { useAtom } from "@effect/atom-react";
import { Exit } from "effect";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { ArrowUp, Square } from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";
import { Textarea } from "@abracode/presentation/ui/textarea";
import { stopMutation } from "./data.ts";
import { requestError } from "./request-state.tsx";
import { useWorkspaceDraft } from "./workspace-state/draft.ts";
import { useWorkspaceAdmission } from "./workspace-state/admission.ts";
export function Composer({
  workspace,
  isReady,
  refresh,
  error,
  setError,
  stateError,
  connectionError,
}: {
  workspace: WorkspaceSnapshot;
  isReady: boolean;
  refresh: () => void;
  error: string;
  setError: (text: string) => void;
  stateError: string;
  connectionError: string;
}) {
  const [input, edit] = useWorkspaceDraft(workspace.session_id);
  const [delivery, setDelivery] = useState<Submission["delivery"]>("queue");
  const draft = input.text;
  const setDraft = (text: string) => edit({ text });
  const clearSent = useCallback((sent: Submission) => edit({ clearSent: sent }), [edit]);
  const { pending, admitting, send } = useWorkspaceAdmission({
    workspace,
    isReady,
    delivery: workspace.busy ? delivery : "queue",
    draft,
    selection: input.attachment?.selection,
    clearSent,
    setDraft,
    refresh,
    setError,
  });
  const [stopResult, stop] = useAtom(stopMutation, { mode: "promiseExit" });
  return (
    <footer className="composer-area">
      {(error || stateError || connectionError || workspace.work_unavailable) && (
        <div role="alert" className="error-banner">
          {error || stateError || connectionError || workspace.work_unavailable}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              refresh();
            }}
          >
            Refresh
          </Button>
        </div>
      )}
      {pending && (
        <div className="submission-status">
          <span>
            {admitting
              ? "Submitting with a retained identity…"
              : "Submission awaiting confirmation"}
          </span>
          {!admitting && (
            <Button
              variant="ghost"
              onClick={() => {
                void send(pending);
              }}
            >
              Reconcile submission
            </Button>
          )}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && !admitting && isReady && draft.trim()) void send();
        }}
      >
        {input.attachment && (
          <div className="selection-chip">
            <details>
              <summary>
                {input.attachment.selection.issue_id} · {selectionLabel(input.attachment.selection)}
              </summary>
              <pre>{input.attachment.excerpt}</pre>
            </details>
            <Button type="button" variant="ghost" onClick={() => edit({ attachment: undefined })}>
              Remove selection
            </Button>
          </div>
        )}
        <Textarea
          aria-label="Message Abra"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            workspace.busy
              ? delivery === "steer"
                ? "Steer the current Abra turn…"
                : "Queue a message for Abra…"
              : "Ask Abra to explore, plan, or build…"
          }
          rows={2}
          maxLength={32768}
          disabled={!isReady || admitting || Boolean(pending)}
        />
        <div className="composer-controls">
          <span className="muted">{workspace.model ?? "Using the current model"}</span>
          <div>
            {workspace.busy && (
              <select
                aria-label="Message delivery"
                disabled={admitting || !!pending}
                value={pending?.delivery ?? delivery}
                onChange={(event) =>
                  setDelivery(event.target.value === "steer" ? "steer" : "queue")
                }
              >
                <option value="queue">Queue for Abra</option>
                <option value="steer">Steer current Abra turn</option>
              </select>
            )}
            {workspace.busy && (
              <Button
                variant="outline"
                type="button"
                disabled={stopResult.waiting}
                onClick={() => {
                  void stop({ payload: {} }).then((result) => {
                    if (Exit.isSuccess(result)) refresh();
                    else setError(requestError(result.cause));
                  });
                }}
              >
                <Square aria-hidden="true" /> Stop current Abra turn
              </Button>
            )}
            <Button
              type="submit"
              aria-label="Send message"
              className="send-button"
              disabled={!isReady || admitting || !draft.trim() || Boolean(pending)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
      <p className="composer-caption">
        Connected to the main Abra thread · Work continues when you close this page
      </p>
    </footer>
  );
}
