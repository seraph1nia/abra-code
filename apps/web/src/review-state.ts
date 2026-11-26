import { useCallback, useContext, useEffect } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Schema } from "effect";
import {
  ReviewAnswersSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  type ReviewRecord,
  type ReviewAnswers,
} from "@abracode/contracts/web/reviews";
import { readRetained, writeRetained } from "./retained-input.ts";

const DraftSchema = Schema.Struct({
  answers: ReviewAnswersSchema,
  pending: Schema.optionalKey(ReviewSubmitSchema),
  receipt: Schema.optionalKey(ReviewReceiptSchema),
});
type Retained = typeof DraftSchema.Type;
type Draft = Retained & {
  unsaved?: boolean;
  working?: boolean;
  error?: string;
  errors?: Record<string, string>;
};
const localDraft = Atom.family((key: string) =>
  Atom.make<Draft>(readRetained(key, DraftSchema) ?? { answers: {} }).pipe(
    Atom.setIdleTTL("30 seconds"),
  ),
);

export function useReviewDraft({
  session_id,
  revision,
  hash,
  review: { review_id },
}: ReviewRecord) {
  const registry = useContext(RegistryContext);
  const key = `abra-review-${session_id}-${review_id}-${revision}-${hash}`;
  const local = localDraft(key);
  const valid = useCallback(
    (value: Retained) => {
      for (const identity of [value.pending, value.receipt])
        if (
          identity &&
          (identity.review_id !== review_id ||
            identity.revision !== revision ||
            identity.hash !== hash)
        )
          return false;
      return true;
    },
    [review_id, revision, hash],
  );
  const draft = useAtomValue(local);
  const state = valid(draft) ? draft : { answers: {} };
  const current = useCallback((): Draft => {
    const value = registry.get(local);
    return valid(value) ? value : { answers: {} };
  }, [registry, local, valid]);
  useEffect(() => {
    const restore = () => {
      const previous = registry.get(local);
      if (previous.working) return;
      const value = readRetained(key, DraftSchema);
      if (value && !valid(value)) return;
      const restored = value ?? { answers: {} };
      // A storage event already changed the backing store. Writing it back
      // would echo the event to other tabs and start duplicate receipt reads.
      registry.set(
        local,
        previous.unsaved ? { ...restored, answers: previous.answers, unsaved: true } : restored,
      );
    };
    const receive = (event: StorageEvent) => {
      if (event.key === key) restore();
    };
    restore();
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [registry, key, local, valid]);
  const update = useCallback(
    (next: Partial<Draft>, required = false) => {
      const { answers, pending, receipt, ...ephemeral } = { ...current(), ...next };
      const retained: Retained = {
        answers,
        ...(pending && { pending }),
        ...(receipt && { receipt }),
      };
      // Admission needs confirmation of durable identity before issuing the request.
      const persisted = writeRetained(key, retained);
      if (!persisted && required) {
        ephemeral.working = false;
        ephemeral.error =
          "Cannot retain submission identity in browser storage. Your draft is preserved; enable storage before sending.";
      }
      registry.set(local, { ...retained, ...ephemeral, unsaved: !persisted });
      return persisted;
    },
    [registry, current, key, local],
  );
  const change = useCallback(
    (id: string, answer: string | readonly string[]) => {
      update({
        answers: { ...current().answers, [id]: answer } as ReviewAnswers,
        errors: {},
        error: undefined,
      });
    },
    [current, update],
  );
  return { state, update, change, current };
}
