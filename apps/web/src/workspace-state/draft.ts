/* oxlint-disable effecttsgo/unstable-api-usage -- One session draft per application registry. */
import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Equal, Schema } from "effect";
import { ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { createContext } from "react";
import {
  CapturedSelectionSchema as AttachmentSchema,
  type Submission,
} from "@abracode/contracts/web/workspace-wire";
import { readRetained, writeRetained } from "../retained-input.ts";

export type DraftAttachment = typeof AttachmentSchema.Type;
export const PrepareSurfaceMessage = createContext<((text: string) => void) | undefined>(undefined);
export const AttachSelection = createContext<(attachment: DraftAttachment) => void>(() => {});
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
  | { thought: ThoughtReference | undefined }
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
  const state = Atom.make<Draft>(initial()).pipe(Atom.keepAlive);
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
      else if ("append" in edit) value = { ...prior, text: [prior.text, edit.append].filter(Boolean).join("\n").slice(0, 32768) };
      else if ("text" in edit) value = { ...prior, text: edit.text.slice(0, 32768) };
      else if ("thought" in edit) {
        const { thought: _old, ...rest } = prior;
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
  ).pipe(Atom.keepAlive);
});
export function useWorkspaceDraft(sessionID: string) {
  return useAtom(workspaceDraft(sessionID));
}
