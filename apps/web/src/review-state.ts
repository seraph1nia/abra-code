import { useSyncExternalStore } from "react";
import { Schema } from "effect";
import {
  ReviewAnswersSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  type ReviewRecord,
  type ReviewAnswers,
} from "@abracode/contracts/web/reviews";

const DraftSchema = Schema.Struct({
  answers: ReviewAnswersSchema,
  pending: Schema.optionalKey(ReviewSubmitSchema),
  receipt: Schema.optionalKey(ReviewReceiptSchema),
});
type Draft = typeof DraftSchema.Type & {
  working?: boolean;
  error?: string;
  errors?: Record<string, string>;
};
function restore(key: string): Draft {
  try {
    return Schema.decodeUnknownSync(DraftSchema)(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return { answers: {} };
  }
}
function createEntry(key: string) {
  let value = restore(key);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const changed = (event: StorageEvent) => {
    if (event.key === key && !value.working) {
      value = restore(key);
      notify();
    }
  };
  function update(next: Partial<Draft>, required = false) {
    const updated = { ...value, ...next };
    let saved = true;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          answers: updated.answers,
          pending: updated.pending,
          receipt: updated.receipt,
        }),
      );
    } catch {
      saved = false;
      if (required)
        updated.error =
          "Cannot retain submission identity in browser storage. Your draft is preserved; enable storage before sending.";
    }
    value = updated;
    notify();
    return saved;
  }
  return {
    read: () => value,
    subscribe: (listener: () => void) => {
      if (!listeners.size) window.addEventListener("storage", changed);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener("storage", changed);
      };
    },
    update,
    change: (id: string, answer: string | readonly string[]) => {
      update({
        answers: { ...value.answers, [id]: answer } as ReviewAnswers,
        errors: {},
        error: undefined,
      });
    },
  };
}
const entries = new Map<string, ReturnType<typeof createEntry>>();
export function useReviewDraft(record: ReviewRecord) {
  const key = `abra-review-${record.session_id}-${record.review.review_id}-${record.revision}-${record.hash}`;
  let store = entries.get(key);
  if (!store) {
    store = createEntry(key);
    entries.set(key, store);
  }
  const state = useSyncExternalStore(store.subscribe, store.read);
  return { state, update: store.update, change: store.change, current: store.read };
}
