import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Equal, Schema } from "effect";
import { ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { appendDraft } from "../workspace-commands.ts";
import { toast } from "../notifications.tsx";
import {
  CapturedSelectionSchema as AttachmentSchema,
  type Submission,
} from "@abracode/contracts/web/workspace-wire";
import { readRetained, writeRetained } from "../retained-input.ts";

export type DraftAttachment = typeof AttachmentSchema.Type;
const DraftSchema = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(32768)),
  attachment: Schema.optionalKey(AttachmentSchema),
  thought: Schema.optionalKey(ThoughtReference),
});
type Draft = typeof DraftSchema.Type;
type Edit =
  | { text: string }
  | { append: string }
  | { attachment: DraftAttachment | undefined }
  | {
      thought: ThoughtReference | undefined;
      consume?: { text: string; start: number; end: number };
    }
  | { clearSent: Submission };
export const workspaceDraft = Atom.family((sessionID: string) => {
  const legacy = `abra-draft-${sessionID}`;
  const key = `abra-draft-v2-${sessionID}`;
  function initial() {
    const saved = readRetained(key, DraftSchema);
    if (saved) return saved;
    try {
      return { text: (localStorage.getItem(legacy) ?? "").slice(0, 32768) };
    } catch {
      return { text: "" };
    }
  }
  const state = Atom.writable<Draft, Draft>(
    () => initial(),
    (ctx, next) => ctx.setSelf(next),
  );
  return Atom.writable<Draft, Edit>(
    (get) => get(state),
    (ctx, edit) => {
      const prior = ctx.get(state);
      if (
        "clearSent" in edit &&
        (prior.text.trim() !== edit.clearSent.text ||
          !Equal.equals(prior.thought, edit.clearSent.thought) ||
          !Equal.equals(prior.attachment?.selection, edit.clearSent.selection))
      )
        return;
      let value: Draft;
      if ("clearSent" in edit) value = { text: "" };
      else if ("append" in edit) {
        const text = appendDraft(prior.text, edit.append);
        if (text === undefined) {
          toast.error("This insertion exceeds the draft limit.");
          return;
        }
        value = { ...prior, text };
      } else if ("text" in edit) value = { ...prior, text: edit.text.slice(0, 32768) };
      else if ("thought" in edit) {
        const { thought: _old, ...rest } = prior;
        if (edit.consume && prior.text === edit.consume.text)
          rest.text = prior.text.slice(0, edit.consume.start) + prior.text.slice(edit.consume.end);
        value = edit.thought ? { ...rest, thought: edit.thought } : rest;
      } else {
        const { attachment: _old, ...rest } = prior;
        value = edit.attachment ? { ...rest, attachment: edit.attachment } : rest;
      }
      ctx.set(state, value);
      if (writeRetained(key, value)) {
        try {
          localStorage.removeItem(legacy);
        } catch {
          /* Best effort migration. */
        }
      }
    },
  );
});
export function useWorkspaceDraft(sessionID: string) {
  return useAtom(workspaceDraft(sessionID));
}
