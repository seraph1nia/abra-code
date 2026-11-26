import { deferred } from "@abracode/presentation/deferred";
import { OpenSearch } from "./search-trigger.tsx";
import { AsyncResult } from "effect/reactivity";
import { ThoughtSource } from "./thought-source.tsx";
import {
  appendDraft,
  composerCommands,
  slashToken,
  type ComposerCommand,
} from "./workspace-commands.ts";
import { selectionLabel } from "@abracode/contracts/web/resources";
import {
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Submission } from "@abracode/contracts/web/workspace-wire";
import { useAtomValue } from "@effect/atom-react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { ArrowUp, Square } from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { Textarea } from "@abracode/presentation/ui/textarea";
import { memoryEnabledQuery, stopTurn, useWorkspaceCall } from "./data.ts";
import { useWorkspaceDraft } from "./workspace-state/draft.ts";
import { useWorkspaceAdmission } from "./workspace-state/admission.ts";
const ComposerSuggestions = deferred<
  React.ComponentProps<typeof import("@abracode/presentation/ui/search-dialog").ComposerSuggestions>
>(
  () =>
    import("@abracode/presentation/ui/search-dialog").then((module) => ({
      default: module.ComposerSuggestions,
    })),
  "Composer suggestions",
  undefined,
  undefined,
  () => null,
);
export function Composer({
  workspace,
  command,
  consumed,
  pickThought,
  updateDraftLock,
  textareaRef,
  isReady,
  refresh,
  error,
  setError,
  stateError,
  connectionError,
}: {
  workspace: WorkspaceSnapshot;
  command?: { action: ComposerCommand };
  consumed: () => void;
  pickThought: (consume?: { text: string; start: number; end: number }) => void;
  updateDraftLock: (locked: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
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
    thought: input.thought,
    clearSent,
    setDraft,
    refresh,
    setError,
  });
  useLayoutEffect(() => {
    updateDraftLock(!isReady || Boolean(pending) || admitting);
  }, [updateDraftLock, pending, admitting, isReady]);
  const stop = useWorkspaceCall(stopTurn);
  const [stopping, setStopping] = useState(false);

  const localTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? localTextarea;
  const [token, setToken] = useState<ReturnType<typeof slashToken>>();
  const openSearch = useContext(OpenSearch);
  const enabled = useAtomValue(memoryEnabledQuery);
  const memoryAvailable = AsyncResult.isSuccess(enabled) && enabled.value;
  const [highlight, setHighlight] = useState(0);
  const choices = token
    ? composerCommands.filter(
        (c) =>
          (c.id !== "memory" || memoryAvailable) &&
          ("/" + c.id).startsWith(token.token.toLowerCase()),
      )
    : [];
  const handled = useRef<typeof command>(undefined);
  const choose = useCallback(
    (action: ComposerCommand, range?: ReturnType<typeof slashToken>) => {
      if (!isReady || pending || admitting) {
        setError("Wait for the pending submission before editing this draft.");
        return;
      }
      if (action.id === "memory") {
        if (!memoryAvailable || !textarea.current) return;
        if (range) edit({ text: draft.slice(0, range.start) + draft.slice(range.end) });
        openSearch(textarea.current, "memory");
      } else if (action.id === "attach-thought") {
        pickThought(range ? { text: draft, ...range } : undefined);
      } else {
        if (!range) {
          edit({ append: action.text });
          textarea.current?.focus();
          setToken(undefined);
          return;
        }
        const next =
          range && range.end < draft.length
            ? draft.slice(0, range.start) + action.text + draft.slice(range.end)
            : appendDraft(range ? draft.slice(0, range.start) : draft, action.text);
        if (next === undefined || next.length > 32768) {
          setError("This insertion exceeds the draft limit.");
          return;
        }
        edit({ text: next });
        textarea.current?.focus();
      }
      setToken(undefined);
    },
    [
      isReady,
      pending,
      admitting,
      draft,
      edit,
      pickThought,
      setError,
      openSearch,
      memoryAvailable,
      textarea,
    ],
  );
  useEffect(() => {
    if (command && handled.current !== command && isReady) {
      handled.current = command;
      choose(command.action);
      consumed();
    }
  }, [command, consumed, choose, isReady]);
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
        {input.thought && (
          <div className="selection-chip">
            <ThoughtSource reference={input.thought} />
            <Button
              type="button"
              variant="ghost"
              disabled={!isReady || admitting || Boolean(pending)}
              onClick={() => edit({ thought: undefined })}
            >
              Remove thought
            </Button>
          </div>
        )}
        {input.attachment && (
          <div className="selection-chip">
            <details>
              <summary>
                {input.attachment.selection.issue_id} · {selectionLabel(input.attachment.selection)}
              </summary>
              <pre>{input.attachment.excerpt}</pre>
            </details>
            <Button
              type="button"
              variant="ghost"
              disabled={!isReady || admitting || Boolean(pending)}
              onClick={() => edit({ attachment: undefined })}
            >
              Remove selection
            </Button>
          </div>
        )}
        {choices.length > 0 && (
          <ComposerSuggestions
            items={choices}
            highlight={highlight}
            choose={(id) => {
              const action = choices.find((item) => item.id === id);
              if (action) choose(action, token);
            }}
          />
        )}
        <Textarea
          ref={textarea}
          aria-controls={choices.length ? "chat-commands" : undefined}
          aria-activedescendant={choices[highlight] ? "slash-" + choices[highlight].id : undefined}
          onSelect={(event) => {
            if (token && event.currentTarget.selectionStart !== token.end) setToken(undefined);
          }}
          onCompositionStart={() => setToken(undefined)}
          aria-label="Message Abra"
          value={draft}
          onInput={(event) => {
            const inputEvent = event.nativeEvent as InputEvent;
            setDraft(event.currentTarget.value);
            setHighlight(0);
            setToken(
              inputEvent.inputType === "insertText" && !inputEvent.isComposing
                ? slashToken(event.currentTarget.value, event.currentTarget.selectionStart)
                : undefined,
            );
          }}
          onKeyDown={(event) => {
            if (choices.length && !event.nativeEvent.isComposing) {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setToken(undefined);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(
                  (highlight + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
                    choices.length,
                );
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                choose(choices[highlight]!, token);
                return;
              }
            }
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
              : "Message Abra…"
          }
          rows={2}
          maxLength={32768}
          disabled={!isReady || admitting || Boolean(pending)}
        />
        <div className="composer-controls" data-busy={workspace.busy}>
          <span className="muted">{workspace.model ?? "Using the current model"}</span>
          <div>
            {workspace.busy && (
              <NativeSelect
                size="sm"
                aria-label="Message delivery"
                disabled={admitting || !!pending}
                value={pending?.delivery ?? delivery}
                onChange={(event) =>
                  setDelivery(event.target.value === "steer" ? "steer" : "queue")
                }
              >
                <option value="queue">Queue for Abra</option>
                <option value="steer">Steer current Abra turn</option>
              </NativeSelect>
            )}
            {workspace.busy && (
              <Button
                variant="outline"
                type="button"
                aria-label="Stop current Abra turn"
                disabled={!isReady || stopping}
                onClick={async () => {
                  setStopping(true);
                  try {
                    const reply = await stop(workspace.session_id);
                    if (reply._tag === "Failure")
                      setError("Stop could not be confirmed. Refresh the current turn.");
                    else if (!reply.value.stopped)
                      setError("Abra did not confirm an active turn to stop.");
                    else refresh();
                  } finally {
                    setStopping(false);
                  }
                }}
              >
                <Square aria-hidden="true" /> Stop
                <span className="stop-detail"> current Abra turn</span>
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
