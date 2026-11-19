import { readRetained, writeRetained } from "./retained-input.ts";
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
function createEntry(key: string, { review: { review_id }, revision, hash }: ReviewRecord) {
  function restore(): Draft {
    const draft = readRetained(key, DraftSchema);
    const matches = (value: NonNullable<Draft["receipt"] | Draft["pending"]>) =>
      value.review_id === review_id && value.revision === revision && value.hash === hash;
    if (
      !draft ||
      (draft.pending && !matches(draft.pending)) ||
      (draft.receipt && !matches(draft.receipt))
    )
      return { answers: {} };
    return draft;
  }
  let value = restore();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const changed = (event: StorageEvent) => {
    if (event.key === key && !value.working) {
      value = restore();
      notify();
    }
  };
  function update(next: Partial<Draft>, required = false) {
    const updated = { ...value, ...next };
    const saved = writeRetained(key, {
      answers: updated.answers,
      pending: updated.pending,
      receipt: updated.receipt,
    });
    if (!saved && required)
      updated.error =
        "Cannot retain submission identity in browser storage. Your draft is preserved; enable storage before sending.";
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
    store = createEntry(key, record);
    entries.set(key, store);
  }
  const state = useSyncExternalStore(store.subscribe, store.read);
  return { state, update: store.update, change: store.change, current: store.read };
}
