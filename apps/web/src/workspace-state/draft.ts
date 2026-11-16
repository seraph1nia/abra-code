import { useEffect, useState } from "react";
export function useWorkspaceDraft(sessionID: string) {
  const draftKey = `abra-draft-${sessionID}`;
  const [draft, setDraft] = useState(() => {
    try {
      return (localStorage.getItem(draftKey) ?? "").slice(0, 32768);
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch {
      /* An unavailable browser store does not discard the mounted draft. */
    }
  }, [draft, draftKey]);
  return { draft, setDraft };
}
