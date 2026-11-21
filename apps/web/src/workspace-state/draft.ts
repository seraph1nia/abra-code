/* oxlint-disable effecttsgo/unstable-api-usage -- One session draft per application registry. */
import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Equal, Schema } from "effect";
import { createContext } from "react";
import {
  CapturedSelectionSchema as AttachmentSchema,
  type Submission,
} from "@abracode/contracts/web/workspace-wire";
import { readRetained, writeRetained } from "../retained-input.ts";

export type DraftAttachment = typeof AttachmentSchema.Type;
export const AttachSelection = createContext<(attachment: DraftAttachment) => void>(() => {});
const DraftSchema = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(32768)),
  attachment: Schema.optionalKey(AttachmentSchema),
});
type Draft = typeof DraftSchema.Type;
type Edit =
  | { text: string }
  | { attachment: DraftAttachment | undefined }
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
          !Equal.equals(prior.attachment?.selection, edit.clearSent.selection))
      )
        return;
      const value: Draft =
        "clearSent" in edit
          ? { text: "" }
          : "text" in edit
            ? { ...prior, text: edit.text.slice(0, 32768) }
            : edit.attachment
              ? { ...prior, attachment: edit.attachment }
              : { text: prior.text };
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
