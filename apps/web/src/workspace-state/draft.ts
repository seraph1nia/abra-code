/* oxlint-disable effecttsgo/unstable-api-usage -- One session draft per application registry; Ask actions subscribe only to its setter. */
import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Option } from "effect";

export const workspaceDraft = Atom.family((sessionID: string) => {
  const key = `abra-draft-${sessionID}`;
  return Atom.writable<string, string>(
    (get) =>
      Option.getOrElse(get.self<string>(), () => {
        try {
          return (localStorage.getItem(key) ?? "").slice(0, 32768);
        } catch {
          return "";
        }
      }),
    (context, text) => {
      const value = text.slice(0, 32768);
      context.setSelf(value);
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        // Best-effort persistence cannot discard a mounted draft.
      }
    },
  ).pipe(Atom.keepAlive);
});
export function useWorkspaceDraft(sessionID: string) {
  const [draft, setDraft] = useAtom(workspaceDraft(sessionID));
  return { draft, setDraft };
}
