import type { WorkspaceSnapshot, TranscriptMessage } from "@abracode/contracts/web/contracts";

export type Conversation = {
  session_id: WorkspaceSnapshot["session_id"];
  messages: readonly TranscriptMessage[];
  presentations: NonNullable<WorkspaceSnapshot["presentations"]>;
};
const sameRows = <A>(before: readonly A[], after: readonly A[]) =>
  before.length === after.length && before.every((row, index) => row === after[index]);
function merge<A>(before: readonly A[], next: readonly A[], key: (row: A) => string) {
  const rows = new Map(before.map((row) => [key(row), row]));
  for (const row of next) {
    const prior = rows.get(key(row));
    rows.set(key(row), prior && JSON.stringify(prior) === JSON.stringify(row) ? prior : row);
  }
  const result = [...rows.values()];
  return sameRows(before, result) ? before : result;
}

/** Retain loaded display evidence separately from the authoritative recent window. */
export function retainConversation(
  previous: Conversation | undefined,
  snapshot: WorkspaceSnapshot,
  recent: readonly TranscriptMessage[] = [],
): Conversation {
  const before: Conversation =
    previous?.session_id === snapshot.session_id
      ? previous
      : {
          session_id: snapshot.session_id,
          messages: [],
          presentations: { entries: [], diagnostics: [], truncated: false },
        };
  const prior = new Map(before.messages.map((message) => [message.id, message]));
  const currentIDs = new Set(recent.map((message) => message.id));
  const current = recent.map((message) => {
    const old = prior.get(message.id);
    return old && JSON.stringify(old) === JSON.stringify(message) ? old : message;
  });
  const ordered = [...before.messages.filter((message) => !currentIDs.has(message.id)), ...current];
  const messages = sameRows(before.messages, ordered) ? before.messages : ordered;
  const entries = merge(
    before.presentations.entries,
    snapshot.presentations?.entries ?? [],
    (entry) => JSON.stringify([entry.message_id, entry.tool_call_id, entry.target]),
  );
  const diagnostics = merge(
    before.presentations.diagnostics ?? [],
    snapshot.presentations?.diagnostics ?? [],
    (entry) => JSON.stringify(entry),
  );
  const truncated = before.presentations.truncated || Boolean(snapshot.presentations?.truncated);
  const presentations =
    entries === before.presentations.entries &&
    diagnostics === before.presentations.diagnostics &&
    truncated === before.presentations.truncated
      ? before.presentations
      : { entries, diagnostics, truncated };
  return messages === before.messages && presentations === before.presentations
    ? before
    : { session_id: snapshot.session_id, messages, presentations };
}

export class ConversationRetention {
  constructor(private committed: Conversation) {}
  read() {
    return this.committed;
  }
  commit(conversation: Conversation) {
    this.committed = conversation;
  }
}
